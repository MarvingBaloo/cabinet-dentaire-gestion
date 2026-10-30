import { CanalNotification, RoleName, TypeNotification } from '@prisma/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { amorcerModelesMessages } from '@/server/db/amorcer-modeles-messages'
import { prisma } from '@/server/db/client'
import { modeleParDefaut } from '@/lib/modeles-messages'
import { rendreMessage } from '@/server/notifications/messages'
import {
  ModeleMessageInvalideError,
  enregistrerModeleMessage,
  listerModelesMessages,
  reinitialiserModeleMessage,
} from '@/server/services/modeles-messages'

// Ce que ces tests cherchent à prouver (lot 5a), contre la base de test :
//   - `enregistrerModeleMessage` refuse sans la permission `notifications:modeles`
//     (la secrétaire, comme le reste de son rôle, ne l'a pas)
//   - le praticien simple ne l'a pas non plus : la configuration revient à l'administrateur (Q4)
//   - un champ inconnu ou indisponible est refusé, la base n'est pas modifiée
//   - un enregistrement valide écrit la ligne ET une entrée d'audit
//   - `rendreMessage` lit le modèle en base, puis retombe sur le défaut du
//     code une fois la ligne supprimée (`reinitialiserModeleMessage`)
//   - le seed (`amorcerModelesMessages`) n'écrase JAMAIS un modèle modifié
//
// « L'action » du brief de session est testée au niveau du SERVICE qu'elle
// appelle, comme partout ailleurs dans ce dépôt (aucun test n'invoque une
// fonction `'use server'` directement : `exigerContexte()` y lit les cookies
// de la requête, absents sous Vitest). Le renvoi de la saisie en cas de refus
// est une mécanique de `src/server/actions/modeles-messages.ts` identique,
// champ pour champ, à celle déjà éprouvée de `motifs-patient.ts` — rien de
// nouveau à y revérifier.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let ctxSecretaire: AuthContext
let ctxAdmin: AuthContext
let ctxPraticien: AuthContext

async function creerContexte(role: RoleName, prenom: string): Promise<AuthContext> {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `modeles-msg-${prenom.toLowerCase()}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom,
      passwordHash: 'x',
      roles: { create: { roleId: r.id } },
    },
    select: { id: true },
  })
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error(`contexte ${role} introuvable`)
  return ctx
}

beforeAll(async () => {
  ctxSecretaire = await creerContexte(RoleName.SECRETAIRE, 'Secretaire')
  ctxAdmin = await creerContexte(RoleName.ADMIN, 'Admin')
  ctxPraticien = await creerContexte(RoleName.PRATICIEN, 'Praticien')
})

// Aucune suppression de compte : le journal d'audit les référence et refuse
// de les lâcher (même comportement que `tests/patients.test.ts`).

/** Revient au défaut après chaque test qui a pu modifier un modèle réel —
 *  ces types sont partagés avec d'autres suites (reservation-publique,
 *  agenda, rappels...) qui lisent `rendreMessage` sur la même base de test. */
async function remettreADefaut(type: TypeNotification, canal: CanalNotification) {
  await prisma.modeleMessage.deleteMany({ where: { type, canal } })
  await amorcerModelesMessages(prisma)
}

afterEach(async () => {
  await remettreADefaut(TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS)
  await remettreADefaut(TypeNotification.RAPPEL_J2, CanalNotification.SMS)
  await remettreADefaut(TypeNotification.ANNULATION_CABINET, CanalNotification.SMS)
})

describe('garde de permission', () => {
  it('refuse la secrétaire — notifications:modeles ne fait pas partie de son rôle', async () => {
    await expect(
      enregistrerModeleMessage(ctxSecretaire, {
        type: TypeNotification.RAPPEL_J2,
        canal: CanalNotification.SMS,
        sujet: null,
        corps: 'Texte de test.',
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError)

    await expect(listerModelesMessages(ctxSecretaire)).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  it('refuse le praticien simple — la configuration revient à l’administrateur (Q4)', async () => {
    await expect(
      enregistrerModeleMessage(ctxPraticien, {
        type: TypeNotification.RAPPEL_J2,
        canal: CanalNotification.SMS,
        sujet: null,
        corps: 'Texte de test court.',
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError)
  })
})

describe('validation rejouée côté service', () => {
  it('refuse {motif} et laisse la base intacte', async () => {
    const avant = await prisma.modeleMessage.findUnique({
      where: {
        type_canal: { type: TypeNotification.CONFIRMATION_RESERVATION, canal: CanalNotification.SMS },
      },
    })

    await expect(
      enregistrerModeleMessage(ctxAdmin, {
        type: TypeNotification.CONFIRMATION_RESERVATION,
        canal: CanalNotification.SMS,
        sujet: null,
        corps: 'RDV le {date}, motif : {motif}.',
      }),
    ).rejects.toBeInstanceOf(ModeleMessageInvalideError)

    const apres = await prisma.modeleMessage.findUnique({
      where: {
        type_canal: { type: TypeNotification.CONFIRMATION_RESERVATION, canal: CanalNotification.SMS },
      },
    })
    expect(apres?.corps).toBe(avant?.corps)
  })
})

describe('enregistrement et audit', () => {
  it('enregistre le modèle et écrit une ligne d’audit UPDATE', async () => {
    const texte = `Texte de test enregistré ${SUFFIXE}.`

    await enregistrerModeleMessage(ctxAdmin, {
      type: TypeNotification.RAPPEL_J2,
      canal: CanalNotification.SMS,
      sujet: null,
      corps: texte,
    })

    const enBase = await prisma.modeleMessage.findUnique({
      where: { type_canal: { type: TypeNotification.RAPPEL_J2, canal: CanalNotification.SMS } },
    })
    expect(enBase?.corps).toBe(texte)
    expect(enBase?.modifieParId).toBe(ctxAdmin.userId)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'UPDATE', entityType: 'modele_message', actorId: ctxAdmin.userId },
      orderBy: { occurredAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(audit?.entityId).toBe(`${TypeNotification.RAPPEL_J2}:${CanalNotification.SMS}`)
  })

  it('la liste rend le modèle modifié avec parDefaut=false', async () => {
    await enregistrerModeleMessage(ctxAdmin, {
      type: TypeNotification.RAPPEL_J2,
      canal: CanalNotification.SMS,
      sujet: null,
      corps: 'Encore un texte de test.',
    })

    const lignes = await listerModelesMessages(ctxAdmin)
    const ligne = lignes.find((l) => l.type === TypeNotification.RAPPEL_J2 && l.canal === CanalNotification.SMS)
    expect(ligne?.parDefaut).toBe(false)
    expect(ligne?.corps).toBe('Encore un texte de test.')
  })
})

describe('rendreMessage retombe sur le défaut une fois le modèle supprimé', () => {
  it('lit le modèle en base, puis le défaut du code après réinitialisation', async () => {
    await enregistrerModeleMessage(ctxAdmin, {
      type: TypeNotification.CONFIRMATION_RESERVATION,
      canal: CanalNotification.SMS,
      sujet: null,
      corps: 'Texte personnalisé du cabinet pour {prenom}.',
    })

    const donnees = {
      debut: new Date(),
      siteNom: 'Cabinet de Marie-Galante',
      prenom: 'Camille',
    }

    const rendu1 = await rendreMessage(prisma, TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS, donnees)
    expect(rendu1.texte).toBe('Texte personnalisé du cabinet pour Camille.')

    await reinitialiserModeleMessage(ctxAdmin, TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS)

    const rendu2 = await rendreMessage(prisma, TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS, donnees)
    expect(rendu2.texte).toContain('Cabinet de Marie-Galante')
    expect(rendu2.texte).toMatch(/enregistré\. Pour le gérer : \S+\/mes-rendez-vous$/)
    expect(rendu2.texte).not.toContain('Texte personnalisé')
  })
})

describe('le seed n’écrase jamais un modèle modifié', () => {
  it('amorcerModelesMessages laisse un modèle déjà modifié intact', async () => {
    const texteCabinet = `Texte du cabinet — ne pas écraser ${SUFFIXE}.`

    await enregistrerModeleMessage(ctxAdmin, {
      type: TypeNotification.ANNULATION_CABINET,
      canal: CanalNotification.SMS,
      sujet: null,
      corps: texteCabinet,
    })

    // Peu importe combien de lignes `amorcerModelesMessages` crée ailleurs
    // (selon ce que le reste de la suite a déjà touché sur `cabinet_test`) :
    // l'invariant testé est que CETTE ligne, déjà modifiée, n'est pas reprise.
    await amorcerModelesMessages(prisma)

    const apres = await prisma.modeleMessage.findUnique({
      where: { type_canal: { type: TypeNotification.ANNULATION_CABINET, canal: CanalNotification.SMS } },
    })
    expect(apres?.corps).toBe(texteCabinet)
  })
})

describe('un modèle jamais modifié suit le défaut du code', () => {
  it('amorcerModelesMessages remet au défaut une ligne semée que personne n’a touchée', async () => {
    await prisma.modeleMessage.update({
      where: { type_canal: { type: TypeNotification.RAPPEL_J2, canal: CanalNotification.EMAIL } },
      data: { corps: 'Ancien texte par défaut.', modifieParId: null },
    })

    await amorcerModelesMessages(prisma)

    const apres = await prisma.modeleMessage.findUniqueOrThrow({
      where: { type_canal: { type: TypeNotification.RAPPEL_J2, canal: CanalNotification.EMAIL } },
    })
    expect(apres.corps).toBe(modeleParDefaut(TypeNotification.RAPPEL_J2, CanalNotification.EMAIL).corps)
  })
})
