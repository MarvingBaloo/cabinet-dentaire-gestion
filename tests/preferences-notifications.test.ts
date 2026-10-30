import { CanalNotification, TypeNotification } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { instantCabinet } from '@/lib/dates'
import { prisma } from '@/server/db/client'
import { cleIdempotence, emettre, traiterLot } from '@/server/notifications/file'
import { demanderAcces, verifierAcces } from '@/server/services/acces-patient'
import { enregistrerPreferences, preferencesDuPatient } from '@/server/services/preferences-notifications'
import { definirTransporteur, type Message } from '@/server/sms/envoi'

// Ce que ces tests cherchent à prouver (phase 4, lot 5b, D44), dans l'ordre du
// brief :
//   - défaut sans ligne `PreferenceNotification` : tout est envoyé
//   - rappels désactivés → RAPPEL_J2 ABANDONNEE, sans appel fournisseur, mais
//     CONFIRMATION_RESERVATION (TRANSACTIONNEL) envoyée quand même
//   - non-essentiels désactivés → CRENEAU_LIBERE ABANDONNEE (et l'`EnvoiListeAttente`
//     associé passe ABANDONNE), mais RAPPEL_H3 envoyée quand même
//   - la préférence d'un autre numéro reste sans effet
//   - un jeton invalide est refusé, en lecture comme en écriture
//   - chaque écriture de préférence est auditée, sans le numéro complet
//
// Comme `notifications-file.test.ts` : un transporteur d'essai qui capture les
// appels, jamais de mock de base — tout passe par de vraies lignes Prisma.

const SUFFIXE = Date.now()
const IP = `198.51.100.${(SUFFIXE + 41) % 200}`

const TEL_A = `+3365555${String(SUFFIXE).slice(-4)}`
const TEL_B = `+3366666${String(SUFFIXE).slice(-4)}`
const TEL_EMAIL = `+3367777${String(SUFFIXE).slice(-4)}`

let siteId: string
let praticienId: string
let motifId: string

const cree = {
  praticiens: [] as string[],
  motifs: [] as string[],
}

let dernierCode = ''
const appels: Message[] = []
const transporteurEssai = {
  nom: 'essai',
  async envoyer(m: Message) {
    appels.push(m)
    dernierCode = /(\d{6})/.exec(m.texte)?.[1] ?? ''
    return { ok: true as const, reference: 'essai' }
  },
}

/** Les appels reçus pour CE numéro précisément. */
function appelsPour(dest: string): Message[] {
  return appels.filter((m) => m.destinataire === dest)
}

/** Ouvre une fenêtre d'accès patient, comme le ferait le parcours complet (D23). */
async function ouvrirFenetre(tel: string) {
  const demande = await demanderAcces(tel, IP)
  if (demande.etat !== 'code_envoye') throw new Error(demande.etat)
  const verif = await verifierAcces(tel, dernierCode)
  if (verif.etat !== 'ouvert') throw new Error(verif.etat)
  return verif.jeton
}

/** Un instant garanti dans la fenêtre d'envoi (8h-21h, America/Guadeloupe). */
const midiOuvert = instantCabinet('2026-01-05', '12:00') as Date

let compteurCles = 0
function cleUnique(etiquette: string): string {
  compteurCles += 1
  return cleIdempotence([etiquette, String(SUFFIXE), String(compteurCles)])
}

beforeAll(async () => {
  definirTransporteur(transporteurEssai)

  siteId = (await prisma.site.findFirstOrThrow({ select: { id: true } })).id

  const p = await prisma.praticien.create({
    data: { nom: `Preferences${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Acte preferences ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)

  // Un `Patient` réel pour chaque numéro : `demanderAcces` n'envoie un SMS
  // réel — donc un code qu'on puisse relire — que pour un numéro connu (D8).
  await prisma.patient.create({ data: { nom: `Preferences${SUFFIXE}`, prenom: 'A', telephone: TEL_A } })
  await prisma.patient.create({ data: { nom: `Preferences${SUFFIXE}`, prenom: 'B', telephone: TEL_B } })
  await prisma.patient.create({
    data: {
      nom: `Preferences${SUFFIXE}`,
      prenom: 'Email',
      telephone: TEL_EMAIL,
      email: `preferences-test-${SUFFIXE}@example.invalid`,
    },
  })
})

beforeEach(async () => {
  appels.length = 0
  await prisma.accesPatient.deleteMany({ where: { ipAddress: IP } })
})

afterAll(async () => {
  await prisma.envoiListeAttente.deleteMany({ where: { praticienId } })
  await prisma.inscriptionListeAttente.deleteMany({ where: { motifId } })
  await prisma.accesPatient.deleteMany({ where: { telephone: { in: [TEL_A, TEL_B, TEL_EMAIL] } } })
  await prisma.notification.deleteMany({ where: { destinataire: { in: [TEL_A, TEL_B, TEL_EMAIL] } } })
  await prisma.preferenceNotification.deleteMany({ where: { destinataire: { in: [TEL_A, TEL_B, TEL_EMAIL] } } })
  // `audit_log` est append-only (02_audit_append_only.sql) : le rôle applicatif
  // n'a pas le DROP/DELETE, et ce n'est pas une fuite de ce test — les lignes
  // qu'il écrit restent, comme documenté dans CLAUDE.md (« npm test »).
  await prisma.patient.deleteMany({ where: { telephone: { in: [TEL_A, TEL_B, TEL_EMAIL] } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.$disconnect()
})

describe('préférences — défaut sans ligne enregistrée', () => {
  it('rend rappels et non-essentiels activés, et le worker envoie tout', async () => {
    const jeton = await ouvrirFenetre(TEL_A)
    // Le code d'accès envoyé par `ouvrirFenetre` figure aussi dans `appels` :
    // on l'écarte avant de compter les envois du worker, sans quoi TOUT test
    // en compterait un de trop.
    appels.length = 0

    const etat = await preferencesDuPatient(jeton)
    expect(etat.etat).toBe('chargees')
    if (etat.etat !== 'chargees') return
    expect(etat.preferences.sms).toEqual({ rappels: true, nonEssentiels: true })
    // Aucune fiche de ce numéro ne porte d'e-mail : rien à proposer sur ce canal.
    expect(etat.preferences.email).toBeNull()

    const cle = cleUnique('DEFAUT_RAPPEL')
    await emettre(prisma, {
      type: TypeNotification.RAPPEL_J2,
      canal: CanalNotification.SMS,
      destinataire: TEL_A,
      texte: 'Rappel de test',
      planifiePour: midiOuvert,
      cle,
    })
    await traiterLot(midiOuvert)

    const relue = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })
    expect(relue.statut).toBe('ENVOYEE')
    expect(appelsPour(TEL_A)).toHaveLength(1)
  })
})

describe('préférences — rappels désactivés', () => {
  it('abandonne RAPPEL_J2 sans appeler le fournisseur, mais envoie CONFIRMATION_RESERVATION', async () => {
    const jeton = await ouvrirFenetre(TEL_A)
    appels.length = 0

    const r = await enregistrerPreferences(jeton, { sms: { rappels: false, nonEssentiels: true } }, IP)
    expect(r.etat).toBe('enregistre')

    const etat = await preferencesDuPatient(jeton)
    if (etat.etat !== 'chargees') throw new Error('inattendu')
    expect(etat.preferences.sms).toEqual({ rappels: false, nonEssentiels: true })

    const cleRappel = cleUnique('RAPPELS_OFF_RAPPEL')
    const cleConfirmation = cleUnique('RAPPELS_OFF_CONFIRMATION')

    await emettre(prisma, {
      type: TypeNotification.RAPPEL_J2,
      canal: CanalNotification.SMS,
      destinataire: TEL_A,
      texte: 'Rappel de test',
      planifiePour: midiOuvert,
      cle: cleRappel,
    })
    await emettre(prisma, {
      type: TypeNotification.CONFIRMATION_RESERVATION,
      canal: CanalNotification.SMS,
      destinataire: TEL_A,
      texte: 'Confirmation de test',
      planifiePour: midiOuvert,
      cle: cleConfirmation,
    })

    const resultat = await traiterLot(midiOuvert)
    expect(resultat.abandonnees).toBeGreaterThanOrEqual(1)

    const rappel = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cleRappel } })
    expect(rappel.statut).toBe('ABANDONNEE')
    expect(rappel.derniereErreur).toMatch(/désabonné/i)

    const confirmation = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cleConfirmation } })
    expect(confirmation.statut).toBe('ENVOYEE')

    // Aucun appel fournisseur pour le rappel abandonné : seule la confirmation
    // a réellement été envoyée.
    expect(appelsPour(TEL_A)).toHaveLength(1)
    expect(appelsPour(TEL_A)[0]?.texte).toBe('Confirmation de test')
  })
})

describe('préférences — non-essentiels désactivés', () => {
  it('abandonne CRENEAU_LIBERE (et son EnvoiListeAttente), mais envoie RAPPEL_H3', async () => {
    const jeton = await ouvrirFenetre(TEL_A)
    appels.length = 0

    // Écrase la préférence posée par le test précédent : rappels réactivés,
    // non-essentiels coupés cette fois.
    const r = await enregistrerPreferences(jeton, { sms: { rappels: true, nonEssentiels: false } }, IP)
    expect(r.etat).toBe('enregistre')

    const etat = await preferencesDuPatient(jeton)
    if (etat.etat !== 'chargees') throw new Error('inattendu')
    expect(etat.preferences.sms).toEqual({ rappels: true, nonEssentiels: false })

    // Un créneau libéré réel, encore à venir et encore libre : sinon le
    // vérificateur de pertinence de la liste d'attente abandonnerait la ligne
    // avant même que la préférence soit consultée.
    const debut = new Date(midiOuvert.getTime() + 10 * 24 * 3_600_000)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    const inscription = await prisma.inscriptionListeAttente.create({
      data: {
        telephone: TEL_A,
        motifId,
        siteId,
        praticienId: null,
        expiresAt: new Date(midiOuvert.getTime() + 60 * 24 * 3_600_000),
      },
      select: { id: true },
    })
    const envoi = await prisma.envoiListeAttente.create({
      data: { inscriptionId: inscription.id, creneauDebut: debut, creneauFin: fin, praticienId, siteId, motifId },
      select: { id: true },
    })

    const cleCreneau = cleUnique('NON_ESSENTIELS_OFF_CRENEAU')
    const cleRappelH3 = cleUnique('NON_ESSENTIELS_OFF_RAPPEL_H3')

    await emettre(prisma, {
      type: TypeNotification.CRENEAU_LIBERE,
      canal: CanalNotification.SMS,
      destinataire: TEL_A,
      texte: 'Une place se libère',
      envoiListeAttenteId: envoi.id,
      siteId,
      planifiePour: midiOuvert,
      cle: cleCreneau,
    })
    await emettre(prisma, {
      type: TypeNotification.RAPPEL_H3,
      canal: CanalNotification.SMS,
      destinataire: TEL_A,
      texte: 'Rappel H-3',
      planifiePour: midiOuvert,
      cle: cleRappelH3,
    })

    await traiterLot(midiOuvert)

    const creneau = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cleCreneau } })
    expect(creneau.statut).toBe('ABANDONNEE')
    expect(creneau.derniereErreur).toMatch(/désabonné/i)

    const envoiRelu = await prisma.envoiListeAttente.findUniqueOrThrow({ where: { id: envoi.id } })
    expect(envoiRelu.statut).toBe('ABANDONNE')

    const rappelH3 = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cleRappelH3 } })
    expect(rappelH3.statut).toBe('ENVOYEE')

    expect(appelsPour(TEL_A)).toHaveLength(1)
    expect(appelsPour(TEL_A)[0]?.texte).toBe('Rappel H-3')
  })
})

describe('préférences — sans effet sur un autre numéro', () => {
  it('la préférence de TEL_A ne bloque rien pour TEL_B', async () => {
    // TEL_A porte, depuis les tests précédents, rappels désactivés puis
    // réactivés (dernier état : rappels=true, nonEssentiels=false). TEL_B,
    // lui, n'a jamais eu de ligne : son rappel doit partir normalement.
    const cle = cleUnique('AUTRE_NUMERO')
    await emettre(prisma, {
      type: TypeNotification.RAPPEL_J2,
      canal: CanalNotification.SMS,
      destinataire: TEL_B,
      texte: 'Rappel pour un autre numéro',
      planifiePour: midiOuvert,
      cle,
    })
    await traiterLot(midiOuvert)

    const relue = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })
    expect(relue.statut).toBe('ENVOYEE')
    expect(appelsPour(TEL_B)).toHaveLength(1)
  })
})

describe('préférences — jeton invalide', () => {
  it('refuse la lecture', async () => {
    const etat = await preferencesDuPatient('jeton-inventé')
    expect(etat.etat).toBe('fenetre_expiree')
  })

  it('refuse l’écriture, sans créer de ligne', async () => {
    const avant = await prisma.preferenceNotification.count({ where: { destinataire: TEL_B } })
    const r = await enregistrerPreferences(
      'jeton-inventé',
      { sms: { rappels: false, nonEssentiels: false } },
      IP,
    )
    expect(r.etat).toBe('fenetre_expiree')
    const apres = await prisma.preferenceNotification.count({ where: { destinataire: TEL_B } })
    expect(apres).toBe(avant)
  })
})

describe('préférences — écriture auditée', () => {
  it('écrit une ligne audit_log, sans jamais le numéro complet', async () => {
    const jeton = await ouvrirFenetre(TEL_B)

    const r = await enregistrerPreferences(jeton, { sms: { rappels: false, nonEssentiels: true } }, IP)
    expect(r.etat).toBe('enregistre')

    const ligne = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'PREFERENCES_NOTIFICATION_MODIFIEES', ipAddress: IP },
      orderBy: { occurredAt: 'desc' },
    })
    expect(ligne.entityType).toBe('preference_notification')
    expect(ligne.metadata).toMatchObject({ smsRappels: false, smsNonEssentiels: true, emailModifie: false })
    expect(JSON.stringify(ligne.metadata)).not.toContain(TEL_B)
  })
})

describe('préférences — canal e-mail', () => {
  it('n’apparaît que si une fiche patient du numéro porte un e-mail', async () => {
    const jeton = await ouvrirFenetre(TEL_EMAIL)

    const etat = await preferencesDuPatient(jeton)
    if (etat.etat !== 'chargees') throw new Error('inattendu')
    expect(etat.preferences.email).not.toBeNull()
    expect(etat.preferences.email?.adresse).toBe(`preferences-test-${SUFFIXE}@example.invalid`)
    expect(etat.preferences.email).toMatchObject({ rappels: true, nonEssentiels: true })
  })
})
