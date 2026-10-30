import { CanalNotification, RoleName, SiteCode, StatutRendezVous, TypeNotification } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { demarrerConnexion } from '@/server/auth/connexion'
import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { amorcerModelesMessages } from '@/server/db/amorcer-modeles-messages'
import { prisma } from '@/server/db/client'
import { listerRendezVous, listerRendezVousConsolide } from '@/server/queries/agenda'
import { listerPostes } from '@/server/queries/postes'
import { compterJournal, lireActiviteRecente } from '@/server/queries/tableau-bord'
import { listerUtilisateurs } from '@/server/queries/users'
import {
  ReserveAuPraticienError,
  annulerRendezVous,
  creerRendezVous,
  validerAnnulation,
} from '@/server/services/agenda'
import {
  ModeleMessageInvalideError,
  enregistrerModeleMessage,
  reinitialiserModeleMessage,
} from '@/server/services/modeles-messages'
import { creerMotifPatient, modifierMotifPatient, supprimerMotifPatient } from '@/server/services/motifs-patient'
import { debloquerPatient } from '@/server/services/patients'
import { desactiverPoste, nommerPoste } from '@/server/services/postes'
import {
  DesactivationDeSoiError,
  changerTelephone,
  creerUtilisateur,
  desactiverUtilisateur,
  reactiverUtilisateur,
  reinitialiserMfa,
} from '@/server/services/users'
import { definirTransporteur, type Message } from '@/server/sms/envoi'
import { creerUtilisateurSchema } from '@/server/validation/user'

// La batterie du rôle ADMINISTRATEUR (21/10/2026) : le compte qui administre le cabinet — comptes, postes,
// journal, modèles de messages, menu des patients, déblocage, les deux cabinets — et ce qui lui reste fermé :
// se désactiver lui-même, l'urgence et le hors-horaires sur l'agenda d'un praticien (D69), le journal en écriture.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }
const MOT_DE_PASSE = 'Un-mot-de-passe-solide-2026'
const h = (jour: string, heure: string) => new Date(`2027-09-${jour}T${heure}:00Z`)
let ip = 0
const origine = () => ({ ipAddress: `192.0.2.${(SUFFIXE + ip++) % 250}`, userAgent: 'vitest' })

let siteMG: string
let siteGP: string
let ctxAdmin: AuthContext
let ctxSecretaire: AuthContext
let praticienId: string
let fauteuilId: string
let motifId: string
let patientId: string
const cree = { plages: [] as string[], postes: [] as string[], menu: [] as string[] }

const sms: Message[] = []
definirTransporteur({
  nom: 'essai',
  async envoyer(m: Message) {
    sms.push(m)
    return { ok: true as const, reference: 'essai' }
  },
})

async function compte(roles: RoleName[], cle: string, sites: string[]) {
  const ids = await prisma.role.findMany({ where: { name: { in: roles } }, select: { id: true } })
  const u = await prisma.user.create({
    data: {
      email: `role-admin-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: ids.map((r) => ({ roleId: r.id })) },
      sites: { create: sites.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  })
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error(`Contexte introuvable : ${cle}`)
  return ctx
}

/** Ce que l'écran envoie : la saisie passe par le schéma du formulaire, comme en vrai. */
const saisieCompte = (cle: string, roles: RoleName[], telephone = '0690 11 22 33') =>
  creerUtilisateurSchema.parse({
    email: `nouveau-${cle}-${SUFFIXE}@test.local`,
    nom: `Nouvelle${SUFFIXE}`,
    prenom: cle,
    motDePasse: MOT_DE_PASSE,
    telephoneMobile: telephone,
    roles,
    siteIds: [siteMG],
  })

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id
  ctxAdmin = await compte([RoleName.ADMIN], 'admin', [siteMG])
  ctxSecretaire = await compte([RoleName.SECRETAIRE], 'secretaire', [siteMG])
  motifId = (
    await prisma.motifConsultation.create({
      data: { libelle: `Soin admin ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc', ordre: 9400 },
      select: { id: true },
    })
  ).id
  praticienId = (
    await prisma.praticien.create({
      data: { nom: `Admin${SUFFIXE}`, prenom: 'Dr', couleur: '#0078cc' },
      select: { id: true },
    })
  ).id
  await prisma.praticienMotif.create({ data: { praticienId, motifId, dureeMinutes: 30 } })
  fauteuilId = (
    await prisma.fauteuil.create({ data: { siteId: siteMG, nom: `Fauteuil admin ${SUFFIXE}` }, select: { id: true } })
  ).id
  for (const jour of ['06', '07', '08']) {
    const p = await prisma.plageDePresence.create({
      data: { praticienId, siteId: siteMG, fauteuilId, debut: h(jour, '12:00'), fin: h(jour, '21:00') },
      select: { id: true },
    })
    cree.plages.push(p.id)
  }
  patientId = (
    await prisma.patient.create({
      data: {
        nom: `Sanction${SUFFIXE}`,
        prenom: 'Zoé',
        telephone: '+590690990022',
        manquements: 3,
        reservationBloquee: true,
      },
      select: { id: true },
    })
  ).id
})

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { rendezVous: { praticienId } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: cree.plages } } })
  await prisma.fauteuil.deleteMany({ where: { id: fauteuilId } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId } })
  await prisma.praticien.deleteMany({ where: { OR: [{ id: praticienId }, { nom: `Nouvelle${SUFFIXE}` }] } })
  await prisma.motifPatient.deleteMany({ where: { id: { in: cree.menu } } })
  await prisma.patient.deleteMany({ where: { id: patientId } })
  await prisma.motifConsultation.deleteMany({ where: { id: motifId } })
  await prisma.workstation.updateMany({ where: { id: { in: cree.postes } }, data: { actif: false } })
  await prisma.modeleMessage.deleteMany({ where: { type: TypeNotification.RAPPEL_J2, canal: CanalNotification.SMS } })
  await amorcerModelesMessages(prisma)
})

// ─── 1. Le rôle ─────────────────────────────────────────────────────────────

describe('1. L’administrateur porte tous les droits et voit les deux cabinets', () => {
  it('les 36 droits du référentiel, et la portée globale', async () => {
    expect(ctxAdmin.permissions.size).toBe(await prisma.permission.count())
    expect(ctxAdmin.porteeGlobale).toBe(true)
  })

  it('l’agenda regroupé des deux cabinets lui est ouvert', async () => {
    await expect(
      listerRendezVousConsolide(ctxAdmin, { debut: h('06', '04:00'), fin: h('07', '04:00') }),
    ).resolves.toBeDefined()
    await expect(
      listerRendezVous(ctxAdmin, { debut: h('06', '04:00'), fin: h('07', '04:00') }, { siteId: siteGP }),
    ).resolves.toBeDefined()
  })
})

// ─── 2. Les comptes ─────────────────────────────────────────────────────────

describe('2. Il crée le compte d’une nouvelle assistante, qui peut se connecter dès lundi', () => {
  let nouvelle: string

  it('sans numéro de mobile, le formulaire refuse : sans lui, aucun code de connexion ne pourrait partir', () => {
    const r = creerUtilisateurSchema.safeParse({
      email: `sans-numero-${SUFFIXE}@test.local`,
      nom: 'X',
      prenom: 'Y',
      motDePasse: MOT_DE_PASSE,
      roles: [RoleName.ASSISTANTE],
      siteIds: [],
    })
    expect(r.success).toBe(false)
  })

  it('le numéro tapé « 0690 11 22 33 » est enregistré au format international, et le code part vers lui', async () => {
    const u = await creerUtilisateur(ctxAdmin, saisieCompte('Lina', [RoleName.ASSISTANTE]))
    nouvelle = u.id
    const enBase = await prisma.user.findUniqueOrThrow({ where: { id: nouvelle } })
    expect(enBase.telephoneMobile).toBe('+590690112233')

    sms.length = 0
    const r = await demarrerConnexion(`nouveau-Lina-${SUFFIXE}@test.local`, MOT_DE_PASSE, origine())
    expect(r.etat).toBe('mfa_requis')
    expect(sms.map((m) => m.destinataire)).toEqual(['+590690112233'])
  })

  it('un compte praticien reçoit aussi sa fiche d’agenda', async () => {
    const u = await creerUtilisateur(ctxAdmin, saisieCompte('Paul', [RoleName.PRATICIEN], '0690 11 22 44'))
    expect(await prisma.praticien.findUnique({ where: { userId: u.id } })).not.toBeNull()
  })

  it('Lina change de téléphone : il enregistre le nouveau numéro, ses sessions tombent, le code part vers le nouveau', async () => {
    await prisma.session.create({
      data: {
        userId: nouvelle,
        sessionToken: `essai-${SUFFIXE}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        mfaValidatedAt: new Date(),
        ipAddress: '127.0.0.1',
      },
    })
    await changerTelephone(ctxAdmin, nouvelle, '+590690556677')
    expect(await prisma.session.count({ where: { userId: nouvelle, revokedAt: null } })).toBe(0)
    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxAdmin.userId, entityId: nouvelle, action: 'UPDATE' },
      orderBy: { id: 'desc' },
    })
    expect(JSON.stringify(trace.metadata)).not.toContain('556677')

    sms.length = 0
    expect((await demarrerConnexion(`nouveau-Lina-${SUFFIXE}@test.local`, MOT_DE_PASSE, origine())).etat).toBe(
      'mfa_requis',
    )
    expect(sms.map((m) => m.destinataire)).toEqual(['+590690556677'])
  })

  it('téléphone perdu : « réinitialiser » efface le numéro ; il en enregistre un nouveau, et elle se reconnecte', async () => {
    await reinitialiserMfa(ctxAdmin, nouvelle)
    expect((await demarrerConnexion(`nouveau-Lina-${SUFFIXE}@test.local`, MOT_DE_PASSE, origine())).etat).toBe(
      'numero_manquant',
    )
    await changerTelephone(ctxAdmin, nouvelle, '+590690889900')
    expect((await demarrerConnexion(`nouveau-Lina-${SUFFIXE}@test.local`, MOT_DE_PASSE, origine())).etat).toBe(
      'mfa_requis',
    )
  })

  it('elle part : il désactive son compte, qui ne se connecte plus ; puis il le réactive', async () => {
    await desactiverUtilisateur(ctxAdmin, nouvelle)
    expect((await demarrerConnexion(`nouveau-Lina-${SUFFIXE}@test.local`, MOT_DE_PASSE, origine())).etat).toBe(
      'compte_desactive',
    )
    await reactiverUtilisateur(ctxAdmin, nouvelle)
    expect((await demarrerConnexion(`nouveau-Lina-${SUFFIXE}@test.local`, MOT_DE_PASSE, origine())).etat).toBe(
      'mfa_requis',
    )
  })

  it('il ne peut pas désactiver son propre compte, même en appelant la fonction directement', async () => {
    await expect(desactiverUtilisateur(ctxAdmin, ctxAdmin.userId)).rejects.toBeInstanceOf(DesactivationDeSoiError)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ctxAdmin.userId } })).actif).toBe(true)
  })

  it('il lit la liste du personnel', async () => {
    expect((await listerUtilisateurs(ctxAdmin)).map((u) => u.id)).toContain(nouvelle)
  })
})

// ─── 3. Postes, journal ─────────────────────────────────────────────────────

describe('3. Les postes de travail et le journal', () => {
  it('il nomme le poste de l’accueil, le rattache à Marie-Galante, puis désactive un ancien poste', async () => {
    const poste = await prisma.workstation.create({
      data: { nom: `PC-${SUFFIXE}`, secretHash: `essai-${SUFFIXE}` },
      select: { id: true },
    })
    cree.postes.push(poste.id)
    await nommerPoste(ctxAdmin, poste.id, { nom: `Accueil ${SUFFIXE}`, siteId: siteMG })
    const lu = (await listerPostes(ctxAdmin)).find((p) => p.id === poste.id)
    expect(lu).toMatchObject({ nom: `Accueil ${SUFFIXE}` })
    await desactiverPoste(ctxAdmin, poste.id)
    expect((await prisma.workstation.findUniqueOrThrow({ where: { id: poste.id } })).actif).toBe(false)
  })

  it('il lit le journal ; personne, lui compris, ne peut le modifier (c’est la base qui refuse)', async () => {
    expect((await lireActiviteRecente(ctxAdmin, 20)).length).toBeGreaterThan(0)
    // Les pages se suivent sans se chevaucher (Marving, 29/10) : la 2ᵉ commence où la 1ʳᵉ s'arrête.
    const [deuxPages, page1, page2] = await Promise.all([
      lireActiviteRecente(ctxAdmin, 10),
      lireActiviteRecente(ctxAdmin, 5),
      lireActiviteRecente(ctxAdmin, 5, 5),
    ])
    expect([...page1, ...page2].map((l) => l.id)).toEqual(deuxPages.map((l) => l.id))
    const { total, refus } = await compterJournal(ctxAdmin)
    expect(total).toBeGreaterThanOrEqual(refus)
    await expect(prisma.auditLog.deleteMany({ where: { actorId: ctxAdmin.userId } })).rejects.toThrow()
    await expect(
      prisma.auditLog.updateMany({ where: { actorId: ctxAdmin.userId }, data: { succeeded: false } }),
    ).rejects.toThrow()
  })
})

// ─── 4. Messages, menu, déblocage ───────────────────────────────────────────

describe('4. Modèles de SMS, menu des patients, déblocage', () => {
  it('il modifie le rappel J-2, puis le remet par défaut ; un champ inconnu est refusé', async () => {
    // Plus court que le défaut : un texte qui coûterait un troisième SMS est refusé, et c'est voulu.
    await enregistrerModeleMessage(ctxAdmin, {
      type: TypeNotification.RAPPEL_J2,
      canal: CanalNotification.SMS,
      corps: '{cabinet} : RDV le {date} à {heure}. À bientôt.',
    } as never)
    expect(
      (await prisma.modeleMessage.findUniqueOrThrow({ where: { type_canal: { type: 'RAPPEL_J2', canal: 'SMS' } } }))
        .corps,
    ).toContain('À bientôt.')
    await expect(
      enregistrerModeleMessage(ctxAdmin, {
        type: TypeNotification.RAPPEL_J2,
        canal: CanalNotification.SMS,
        corps: 'Bonjour {inconnu}',
      } as never),
    ).rejects.toBeInstanceOf(ModeleMessageInvalideError)
    await reinitialiserModeleMessage(ctxAdmin, TypeNotification.RAPPEL_J2, CanalNotification.SMS)
    expect(await prisma.modeleMessage.count({ where: { type: 'RAPPEL_J2', canal: 'SMS' } })).toBe(0)
  })

  it('il ajoute une entrée au menu de réservation en ligne, la renomme, puis la supprime', async () => {
    const entree = await creerMotifPatient(ctxAdmin, { libelle: `Blanchiment ${SUFFIXE}`, motifId, ordre: 9400 })
    cree.menu.push(entree.id)
    await modifierMotifPatient(ctxAdmin, { id: entree.id, libelle: `Éclaircissement ${SUFFIXE}` })
    expect((await prisma.motifPatient.findUniqueOrThrow({ where: { id: entree.id } })).libelle).toBe(
      `Éclaircissement ${SUFFIXE}`,
    )
    await supprimerMotifPatient(ctxAdmin, entree.id)
    expect(await prisma.motifPatient.findUnique({ where: { id: entree.id } })).toBeNull()
  })

  it('il débloque Zoé, sanctionnée après trois absences : elle peut de nouveau réserver en ligne', async () => {
    await debloquerPatient(ctxAdmin, { id: patientId })
    const zoe = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } })
    expect(zoe.reservationBloquee).toBe(false)
    expect(zoe.debloqueLe).not.toBeNull()
  })
})

// ─── 5. Agenda ──────────────────────────────────────────────────────────────

describe('5. L’agenda : il tranche toutes les demandes, mais pas d’urgence sur l’agenda d’un praticien (D69)', () => {
  const rdv = async (heure: string) =>
    (
      await prisma.rendezVous.create({
        data: {
          patientId,
          praticienId,
          siteId: siteMG,
          fauteuilId,
          motifId,
          debut: h('07', heure),
          fin: h('07', heure.replace(':00', ':30')),
          statut: 'CONFIRME',
        },
        select: { id: true },
      })
    ).id

  it('il valide la demande d’annulation transmise par la secrétaire, quel que soit le praticien', async () => {
    const id = await rdv('13:00')
    await annulerRendezVous(ctxSecretaire, { id })
    expect((await validerAnnulation(ctxAdmin, { id })).statut).toBe(StatutRendezVous.ANNULE)
  })

  it('« Annuler » posé par l’administrateur qui n’est pas le praticien du rendez-vous n’est qu’une demande', async () => {
    const id = await rdv('14:00')
    expect((await annulerRendezVous(ctxAdmin, { id })).statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
  })

  it('pas d’urgence sur planning plein ni de hors-horaires dans l’agenda d’un praticien', async () => {
    await rdv('15:00')
    const base = {
      patientId,
      praticienId,
      motifId,
      siteId: siteMG,
      debut: h('07', '15:00'),
      surbooking: true,
      horsHoraire: false,
    }
    await expect(creerRendezVous(ctxAdmin, base)).rejects.toBeInstanceOf(ReserveAuPraticienError)
    await expect(
      creerRendezVous(ctxAdmin, { ...base, surbooking: false, horsHoraire: true, debut: h('07', '22:30') }),
    ).rejects.toBeInstanceOf(ReserveAuPraticienError)
  })
})
