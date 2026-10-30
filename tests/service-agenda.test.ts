import { RoleName, SiteCode, StatutRendezVous } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { dansLaFenetreEnvoi, instantCabinet, prochainHuitHeures } from '@/lib/dates'
import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { PorteeSiteError } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import { traiterLot } from '@/server/notifications/file'
// Enregistre le vérificateur de MODIFICATION_RENDEZ_VOUS : sans lui, la file enverrait un message périmé.
import '@/server/notifications/rappels'
import {
  ActeNonPratiqueError,
  AnnulationDejaDemandeeError,
  AnnulationReserveeAuPraticienError,
  AucuneAnnulationEnAttenteError,
  CreneauRefuseError,
  ReserveAuPraticienError,
  annulerRendezVous,
  changerStatut,
  creerPatient,
  creerRendezVous,
  deplacerRendezVous,
  dupliquerRendezVous,
  refuserAnnulation,
  validerAnnulation,
  RetourImpossibleError,
} from '@/server/services/agenda'
import { definirTransporteur, type Message } from '@/server/sms/envoi'

// Ce que ces tests éprouvent, et que le domaine seul ne peut pas montrer :
//   - les règles métier tiennent une fois branchées sur la vraie base
//   - la réservation concurrente est rattrapée par le moteur (D12)
//   - chaque écriture laisse sa trace, dans sa transaction (D9)
//   - surbooking et hors-horaires restent au praticien, même avec agenda:create
//
// Les règles elles-mêmes sont couvertes sans base par domaine-agenda.test.ts.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let siteMG: string
let siteGP: string
let ctxSecretaire: AuthContext
// Le compte PRATICIEN dont le `Praticien` (`praticienId`) porte le `userId` :
// c'est LUI le praticien traitant des rendez-vous posés dans ce fichier, celui
// dont l'annulation est directe (D17, retournée le 2026-09-23). Un compte
// PRATICIEN sans ce lien — `ctxAutrePraticien` — sert à éprouver le cas
// contraire : « un autre praticien ».
let ctxPraticien: AuthContext
let ctxAutrePraticien: AuthContext
let ctxAdmin: AuthContext
let praticienId: string
let motifOrdinaire: string
let motifUrgence: string
let patientId: string
// Lot 6 (glisser-déposer) : un second fauteuil, pour prouver qu'un
// déplacement PEUT changer de colonne quand la présence du praticien l'y
// couvre à l'heure visée, et est refusé sinon.
let fauteuilOriginalId: string
let fauteuilGlisserId: string

const cree: {
  rdv: string[]
  plages: string[]
  praticiens: string[]
  patients: string[]
  motifs: string[]
  fauteuils: string[]
} = {
  rdv: [], plages: [], praticiens: [], patients: [], motifs: [], fauteuils: [],
}

/** Le transporteur SMS est remplacé : on ne fait pas payer un fournisseur pour
 *  une suite de tests, et il faut pouvoir vérifier qu'AUCUN SMS ne part à la
 *  demande, et qu'UN SEUL part à la validation (D17, retournée le 2026-09-23). */
let smsEnvoyes: Message[] = []
definirTransporteur({
  nom: 'essai',
  async envoyer(m: Message) {
    smsEnvoyes.push(m)
    return { ok: true as const, reference: 'essai' }
  },
})

const h = (jour: string, heure: string) => new Date(`2027-04-${jour}T${heure}:00Z`)

async function compte(role: RoleName, cle: string, sites: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `svc-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test', prenom: cle, passwordHash: 'x',
      roles: { create: { roleId: r.id } },
      sites: { create: sites.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  })
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error(`Contexte introuvable : ${cle}`)
  return ctx
}

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id

  ctxSecretaire = await compte(RoleName.SECRETAIRE, 'sec', [siteMG])
  ctxPraticien = await compte(RoleName.PRATICIEN, 'prat', [siteMG])
  ctxAutrePraticien = await compte(RoleName.PRATICIEN, 'prat2', [siteMG])
  ctxAdmin = await compte(RoleName.ADMIN, 'admin', [siteMG])

  // Lié à `ctxPraticien` par `userId` : c'est ce lien, et lui seul, qui fait de
  // `ctxPraticien` le praticien TRAITANT des rendez-vous de ce fichier (D16 —
  // chercher l'existant avant de créer ne s'applique pas ici : la fixture crée
  // volontairement les deux ensemble).
  const p = await prisma.praticien.create({
    data: { nom: 'Service', prenom: 'Test', couleur: '#0078cc', userId: ctxPraticien.userId },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  // Un second praticien, réel, mais SANS rapport avec `praticienId` : c'est lui
  // qui prouve qu'« un autre praticien » ne peut ni annuler directement, ni
  // valider une demande qui n'est pas la sienne.
  const autre = await prisma.praticien.create({
    data: { nom: 'Confrere', prenom: 'Test', couleur: '#0078cc', userId: ctxAutrePraticien.userId },
    select: { id: true },
  })
  cree.praticiens.push(autre.id)

  for (const [cle, urgence] of [['ordinaire', false], ['urgence', true]] as const) {
    const m = await prisma.motifConsultation.create({
      data: {
        libelle: `Test ${cle} ${SUFFIXE}`,
        dureeIndicative: 30, couleur: '#0078cc', estUrgence: urgence, ordre: 9000,
      },
      select: { id: true },
    })
    cree.motifs.push(m.id)
    if (urgence) motifUrgence = m.id
    else motifOrdinaire = m.id
  }

  // Le praticien pratique l'acte ordinaire en 40 minutes — pas 30 : la durée
  // vient du couple, pas du motif.
  await prisma.praticienMotif.create({
    data: { praticienId, motifId: motifOrdinaire, dureeMinutes: 40 },
  })
  await prisma.praticienMotif.create({
    data: { praticienId, motifId: motifUrgence, dureeMinutes: 20 },
  })

  // Un fauteuil propre à ce fichier, jamais le « Fauteuil 1 » partagé : les dates
  // ci-dessous sont fixes, et une exécution interrompue avant l'afterAll y laissait
  // ses plages — le passage suivant échouait alors en entier sur la contrainte
  // d'exclusion du fauteuil.
  const fauteuil = await prisma.fauteuil.create({
    data: { siteId: siteMG, nom: `Fauteuil service ${SUFFIXE}` },
    select: { id: true },
  })
  cree.fauteuils.push(fauteuil.id)
  fauteuilOriginalId = fauteuil.id
  // Deux journées de présence : le 05 pour les règles, le 07 pour la
  // concurrence et le journal — sans quoi ces tests se disputeraient les
  // créneaux des précédents et échoueraient selon l'ordre d'exécution.
  // Le 06 reste volontairement vide : c'est le jour « praticien absent ».
  // Le 08 est réservé aux manquements : ils comptent des points sur un patient,
  // et se disputer un créneau avec un autre test fausserait le compte.
  for (const jour of ['05', '07', '08']) {
    const plage = await prisma.plageDePresence.create({
      data: {
        praticienId, siteId: siteMG, fauteuilId: fauteuil.id,
        debut: h(jour, '11:30'), fin: h(jour, '21:00'),
      },
      select: { id: true },
    })
    cree.plages.push(plage.id)
  }

  // Le 09, plus large (7h-21h), est réservé à la demande, la validation et le
  // refus d'annulation (D17, retournée le 2026-09-23) : une bonne dizaine de
  // rendez-vous y sont posés, chacun sur son propre créneau.
  const plage09 = await prisma.plageDePresence.create({
    data: {
      praticienId, siteId: siteMG, fauteuilId: fauteuil.id,
      debut: h('09', '07:00'), fin: h('09', '21:00'),
    },
    select: { id: true },
  })
  cree.plages.push(plage09.id)

  const patient = await creerPatient(ctxSecretaire, {
    nom: 'Dupont', prenom: 'Jean', telephone: '0590112233',
  })
  patientId = patient.id
  cree.patients.push(patient.id)

  // Lot 6 (glisser-déposer) : un second fauteuil sur le même site.
  const fauteuilGlisser = await prisma.fauteuil.create({
    data: { siteId: siteMG, nom: `Fauteuil glisser ${SUFFIXE}` },
    select: { id: true },
  })
  fauteuilGlisserId = fauteuilGlisser.id
  cree.fauteuils.push(fauteuilGlisser.id)

  // Le 10 : deux présences contiguës du même praticien, sur deux fauteuils
  // différents — la frontière à midi permet d'éprouver un déplacement qui
  // change de colonne (matin → fauteuil d'origine, après-midi → le second).
  const plage10Matin = await prisma.plageDePresence.create({
    data: {
      praticienId, siteId: siteMG, fauteuilId: fauteuil.id,
      debut: h('10', '09:00'), fin: h('10', '12:00'),
    },
    select: { id: true },
  })
  const plage10ApresMidi = await prisma.plageDePresence.create({
    data: {
      praticienId, siteId: siteMG, fauteuilId: fauteuilGlisser.id,
      debut: h('10', '12:00'), fin: h('10', '18:00'),
    },
    select: { id: true },
  })
  cree.plages.push(plage10Matin.id, plage10ApresMidi.id)

  // Le 11 : réservé au redimensionnement (poignée basse, lot 6).
  const plage11 = await prisma.plageDePresence.create({
    data: {
      praticienId, siteId: siteMG, fauteuilId: fauteuil.id,
      debut: h('11', '07:00'), fin: h('11', '21:00'),
    },
    select: { id: true },
  })
  cree.plages.push(plage11.id)

  // Le 12 : réservé au conflit lors d'un déplacement par glisser (lot 6).
  const plage12 = await prisma.plageDePresence.create({
    data: {
      praticienId, siteId: siteMG, fauteuilId: fauteuil.id,
      debut: h('12', '07:00'), fin: h('12', '21:00'),
    },
    select: { id: true },
  })
  cree.plages.push(plage12.id)

  // Le 14 : réservé au SMS de déplacement et au retour en arrière (23/10).
  const plage14 = await prisma.plageDePresence.create({
    data: {
      praticienId, siteId: siteMG, fauteuilId: fauteuil.id,
      debut: h('14', '07:00'), fin: h('14', '21:00'),
    },
    select: { id: true },
  })
  cree.plages.push(plage14.id)
})

beforeEach(() => {
  smsEnvoyes = []
})

afterAll(async () => {
  // Doit précéder la suppression des rendez-vous : `Notification.rendezVous`
  // est `onDelete: Restrict` (phase 4, lot 3) — un rendez-vous qui a émis une
  // notification (validerAnnulation, D37) ne peut plus être détruit tant que
  // sa ligne de notification existe encore.
  await prisma.notification.deleteMany({ where: { rendezVous: { praticienId: { in: cree.praticiens } } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: cree.plages } } })
  // Après les rendez-vous et les présences : `Fauteuil` est `onDelete: Restrict`
  // sur les deux (lot 6, second fauteuil créé pour le glisser-déposer).
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
})

const base = (heure: string, motifId = motifOrdinaire, jour = '05') => ({
  patientId, praticienId, motifId, siteId: siteMG,
  debut: h(jour, heure), surbooking: false, horsHoraire: false,
})

describe('création d’un rendez-vous', () => {
  it('la durée vient du couple praticien × motif, pas du motif', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('13:00'))
    cree.rdv.push(rdv.id)

    // 40 minutes sur le couple, alors que le motif en annonce 30.
    expect((rdv.fin.getTime() - rdv.debut.getTime()) / 60_000).toBe(40)
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)
  })

  it('refuse un acte que le praticien ne pratique pas', async () => {
    const autre = await prisma.praticien.create({
      data: { nom: 'Sans', prenom: 'Acte', couleur: '#000000' },
      select: { id: true },
    })
    cree.praticiens.push(autre.id)

    await expect(
      creerRendezVous(ctxSecretaire, { ...base('15:00'), praticienId: autre.id }),
    ).rejects.toThrow(ActeNonPratiqueError)
  })

  it('refuse quand le praticien n’est pas présent ce jour-là', async () => {
    await expect(
      creerRendezVous(ctxSecretaire, { ...base('13:00'), debut: h('06', '13:00') }),
    ).rejects.toThrow(CreneauRefuseError)
  })

  it('refuse un créneau déjà pris, avec un motif lisible', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('16:00'))
    cree.rdv.push(rdv.id)

    await expect(creerRendezVous(ctxSecretaire, base('16:20'))).rejects.toThrow(
      /fauteuil est déjà occupé|praticien a déjà un rendez-vous/i,
    )
  })

  it('refuse un site hors de la portée de l’appelant', async () => {
    await expect(
      creerRendezVous(ctxSecretaire, { ...base('17:00'), siteId: siteGP }),
    ).rejects.toThrow(PorteeSiteError)
  })
})

describe('privilèges réservés au praticien', () => {
  it('la secrétaire ne peut pas poser un surbooking, malgré agenda:create', async () => {
    // Ce n'est pas une permission mais une règle métier : un droit de création
    // ne doit pas emporter avec lui le pouvoir de passer outre les conflits.
    expect(ctxSecretaire.permissions.has('agenda:create')).toBe(true)
    await expect(
      creerRendezVous(ctxSecretaire, { ...base('18:00'), surbooking: true }),
    ).rejects.toThrow(ReserveAuPraticienError)
  })

  it('la secrétaire ne peut pas poser hors horaires', async () => {
    await expect(
      creerRendezVous(ctxSecretaire, { ...base('18:00'), horsHoraire: true }),
    ).rejects.toThrow(ReserveAuPraticienError)
  })

  it('le praticien, lui, glisse son urgence sur un créneau occupé', async () => {
    const occupe = await creerRendezVous(ctxSecretaire, base('19:00'))
    cree.rdv.push(occupe.id)

    const urgence = await creerRendezVous(ctxPraticien, {
      ...base('19:10', motifUrgence),
      surbooking: true,
    })
    cree.rdv.push(urgence.id)
    expect(urgence.id).toBeTruthy()
  })
})

// D17, retournée le 2026-09-23 : l'accueil ne prononce plus l'annulation, il la
// demande. Ce que ces tests éprouvent, et qu'une relecture ne montre pas :
//   - le praticien TRAITANT (celui du rendez-vous) garde l'annulation directe
//   - tout autre appelant — accueil, confrère, administrateur non praticien —
//     ne fait plus que demander, et seuls le praticien traitant ou un
//     administrateur tranchent
//   - le SMS ne part jamais à la demande, une seule fois à la validation
//   - un refus restaure le statut D'AVANT LA DEMANDE, pas une valeur par défaut
//   - le créneau reste occupé tant que la demande est en attente
describe('annulation', () => {
  it('le praticien du rendez-vous annule directement — inchangé pour lui', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('07:00', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)

    const resultat = await annulerRendezVous(ctxPraticien, { id: rdv.id })
    expect(resultat.statut).toBe(StatutRendezVous.ANNULE)

    const apres = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: { statut: true, statutAvantAnnulation: true, annulationDemandeeParId: true },
    })
    expect(apres.statut).toBe(StatutRendezVous.ANNULE)
    expect(apres.statutAvantAnnulation).toBeNull()
    expect(apres.annulationDemandeeParId).toBeNull()
    // Le patient est prévenu comme à la validation d'une demande (Marving, 21/10 ; D27 ne le faisait pas) :
    // un SMS d'annulation part par la file, vidée ici pour ne pas le laisser au test suivant.
    await traiterLot(instantCabinet('2027-04-09', '12:00') as Date)
    expect(smsEnvoyes).toHaveLength(1)

    // Le créneau est réutilisable : c'est tout l'intérêt de ne pas effacer.
    const repris = await creerRendezVous(ctxSecretaire, base('07:00', motifOrdinaire, '09'))
    cree.rdv.push(repris.id)
    expect(repris.id).not.toBe(rdv.id)
  })

  it("la secrétaire ne fait plus qu'une DEMANDE — elle n'annule plus, pas ANNULE, pas de SMS", async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('07:45', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)

    const resultat = await annulerRendezVous(ctxSecretaire, { id: rdv.id })
    expect(resultat.statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
    expect(resultat.statut).not.toBe(StatutRendezVous.ANNULE)

    const apres = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: {
        statut: true,
        statutAvantAnnulation: true,
        annulationDemandeeParId: true,
        annulationDemandeeLe: true,
      },
    })
    expect(apres.statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
    expect(apres.statutAvantAnnulation).toBe(StatutRendezVous.A_CONFIRMER)
    expect(apres.annulationDemandeeParId).toBe(ctxSecretaire.userId)
    expect(apres.annulationDemandeeLe).not.toBeNull()
    expect(smsEnvoyes).toHaveLength(0)
  })

  it('un AUTRE praticien que celui du rendez-vous est traité comme l’accueil : il demande', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('08:30', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)

    const resultat = await annulerRendezVous(ctxAutrePraticien, { id: rdv.id })
    expect(resultat.statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
  })

  it("la secrétaire ne peut pas valider une demande — elle n'a que le droit de la poser", async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('09:15', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)
    await annulerRendezVous(ctxSecretaire, { id: rdv.id })

    await expect(validerAnnulation(ctxSecretaire, { id: rdv.id })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )
  })

  it("un autre praticien ne peut pas valider une demande qui n'est pas la sienne", async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('10:00', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)
    await annulerRendezVous(ctxSecretaire, { id: rdv.id })

    // Il PORTE pourtant la permission `agenda:valider` : c'est la
    // règle métier du service, pas la matrice, qui doit le refuser.
    await expect(validerAnnulation(ctxAutrePraticien, { id: rdv.id })).rejects.toBeInstanceOf(
      AnnulationReserveeAuPraticienError,
    )
  })

  it('le praticien du rendez-vous valide : ANNULE, auteur cabinet, 0 manquement, un SMS part', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('10:45', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)
    await annulerRendezVous(ctxSecretaire, { id: rdv.id })

    const resultat = await validerAnnulation(ctxPraticien, { id: rdv.id })
    expect(resultat.statut).toBe(StatutRendezVous.ANNULE)

    const apres = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: {
        statut: true,
        statutAvantAnnulation: true,
        annulationDemandeeParId: true,
        manquementCompte: true,
      },
    })
    expect(apres.statut).toBe(StatutRendezVous.ANNULE)
    expect(apres.statutAvantAnnulation).toBeNull()
    expect(apres.annulationDemandeeParId).toBeNull()
    // D21 inchangé : le cabinet qui annule ne coûte rien au patient.
    expect(apres.manquementCompte).toBe(false)

    // Depuis la file de notifications (phase 4, lot 3, D37) : `validerAnnulation`
    // n'envoie plus de SMS de façon synchrone, elle émet une ligne — c'est le
    // worker (ici, `traiterLot` appelé directement) qui l'envoie réellement.
    // `2027-04-09` est postérieur à la date réelle d'exécution des tests :
    // toujours après le `planifiePour` par défaut de l'émission (l'instant
    // réel de l'appel), jamais avant.
    await traiterLot(instantCabinet('2027-04-09', '12:00') as Date)

    expect(smsEnvoyes).toHaveLength(1)
    expect(smsEnvoyes[0]?.destinataire).toBe('0590112233')
  })

  it('un administrateur peut aussi valider, même sans être le praticien du rendez-vous', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('11:30', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)
    await annulerRendezVous(ctxSecretaire, { id: rdv.id })

    const resultat = await validerAnnulation(ctxAdmin, { id: rdv.id })
    expect(resultat.statut).toBe(StatutRendezVous.ANNULE)
  })

  it('un refus restaure le statut d’AVANT LA DEMANDE, intact — pas la valeur par défaut', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('12:15', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)
    // Le rendez-vous a déjà avancé dans le parcours avant la demande : le
    // refus doit retrouver CE statut, pas retomber sur A_CONFIRMER.
    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.CONFIRME })
    await annulerRendezVous(ctxSecretaire, { id: rdv.id })

    const resultat = await refuserAnnulation(ctxPraticien, {
      id: rdv.id,
      raison: 'patient prévenu par erreur',
    })
    expect(resultat.statut).toBe(StatutRendezVous.CONFIRME)

    const apres = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: {
        statut: true,
        statutAvantAnnulation: true,
        annulationDemandeeParId: true,
        manquementCompte: true,
      },
    })
    expect(apres.statut).toBe(StatutRendezVous.CONFIRME)
    expect(apres.statutAvantAnnulation).toBeNull()
    expect(apres.annulationDemandeeParId).toBeNull()
    expect(apres.manquementCompte).toBe(false)
    // Un refus ne prévient jamais le patient : rien ne lui est jamais arrivé.
    expect(smsEnvoyes).toHaveLength(0)
  })

  it('une demande déjà tranchée ne se valide, ni ne se refuse, une seconde fois', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('13:00', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)
    await annulerRendezVous(ctxSecretaire, { id: rdv.id })
    await validerAnnulation(ctxPraticien, { id: rdv.id })

    await expect(validerAnnulation(ctxPraticien, { id: rdv.id })).rejects.toBeInstanceOf(
      AucuneAnnulationEnAttenteError,
    )
    await expect(refuserAnnulation(ctxPraticien, { id: rdv.id })).rejects.toBeInstanceOf(
      AucuneAnnulationEnAttenteError,
    )
  })

  it('une demande déjà en attente ne se redemande pas, et le menu de statut ordinaire la laisse intacte', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('13:45', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)
    await annulerRendezVous(ctxSecretaire, { id: rdv.id })

    await expect(annulerRendezVous(ctxSecretaire, { id: rdv.id })).rejects.toBeInstanceOf(
      AnnulationDejaDemandeeError,
    )
    await expect(
      changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.CONFIRME }),
    ).rejects.toBeInstanceOf(AnnulationDejaDemandeeError)
  })

  it("le menu de statut ordinaire redirige aussi vers la demande, pour qui n'est pas le praticien", async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('14:30', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)

    const resultat = await changerStatut(ctxSecretaire, {
      id: rdv.id,
      statut: StatutRendezVous.ANNULE,
    })
    expect(resultat.statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
  })

  it('demande, validation et refus laissent chacun leur trace au journal', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('15:15', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)
    await annulerRendezVous(ctxSecretaire, { id: rdv.id })
    await refuserAnnulation(ctxPraticien, { id: rdv.id })

    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: { entityId: rdv.id, action: 'ANNULATION_DEMANDEE', actorId: ctxSecretaire.userId },
      }),
    ).resolves.toBeTruthy()

    const refus = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: rdv.id, action: 'ANNULATION_REFUSEE', actorId: ctxPraticien.userId },
    })
    expect(refus.metadata).toMatchObject({ statutRestaure: StatutRendezVous.A_CONFIRMER })

    // La validation aussi, sur un second rendez-vous.
    const rdv2 = await creerRendezVous(ctxSecretaire, base('16:00', motifOrdinaire, '09'))
    cree.rdv.push(rdv2.id)
    await annulerRendezVous(ctxSecretaire, { id: rdv2.id })
    await validerAnnulation(ctxPraticien, { id: rdv2.id })

    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: { entityId: rdv2.id, action: 'ANNULATION_VALIDEE', actorId: ctxPraticien.userId },
      }),
    ).resolves.toBeTruthy()
  })

  it('un créneau en attente de décision reste occupé : impossible d’y poser un autre rendez-vous', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('16:45', motifOrdinaire, '09'))
    cree.rdv.push(rdv.id)
    await annulerRendezVous(ctxSecretaire, { id: rdv.id })

    await expect(
      creerRendezVous(ctxSecretaire, base('16:45', motifOrdinaire, '09')),
    ).rejects.toBeInstanceOf(CreneauRefuseError)
  })
})

describe('déplacement', () => {
  it('un décalage de quelques minutes ne se heurte pas à lui-même', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('20:00'))
    cree.rdv.push(rdv.id)

    const deplace = await deplacerRendezVous(ctxSecretaire, {
      id: rdv.id,
      debut: h('05', '20:05'),
    })
    expect(deplace.debut).toEqual(h('05', '20:05'))
    // La durée est conservée quand on ne la redonne pas.
    expect((deplace.fin.getTime() - deplace.debut.getTime()) / 60_000).toBe(40)
  })
})

// Le 23/10 : le patient est prévenu quand le cabinet déplace son rendez-vous, cinq minutes après — le temps du
// « Annuler » du glisser-déposer, qui le remet en place sans rien envoyer.
describe('déplacement par le cabinet : le patient est prévenu, sauf retour en arrière', () => {
  // Six minutes plus tard — ou, la nuit, le matin suivant : aucun SMS ne part entre 21 h et 8 h (D29). Joué le soir,
  // le message attendait le matin et le test le croyait perdu.
  const dansSixMinutes = () => {
    const t = new Date(Date.now() + 6 * 60_000)
    return dansLaFenetreEnvoi(t) ? t : prochainHuitHeures(t)
  }
  const modifications = (rdvId: string) =>
    prisma.notification.findMany({ where: { rendezVousId: rdvId, type: 'MODIFICATION_RENDEZ_VOUS' } })

  it('l’heure change : un SMS est prévu cinq minutes plus tard, puis part avec la nouvelle heure', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('08:00', motifOrdinaire, '14'))
    cree.rdv.push(rdv.id)
    await deplacerRendezVous(ctxSecretaire, { id: rdv.id, debut: h('14', '08:30') })

    const [n] = await modifications(rdv.id)
    expect(n?.rendezVousDebut).toEqual(h('14', '08:30'))
    const delai = n!.planifiePour.getTime() - n!.createdAt.getTime()
    expect(delai).toBeGreaterThan(4.5 * 60_000)
    expect(delai).toBeLessThan(5.5 * 60_000)

    await traiterLot(dansSixMinutes())
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n!.id } })).statut).toBe('ENVOYEE')
  })

  it('« Annuler » juste après : retour à la place d’avant, et aucun SMS ne part', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('10:00', motifOrdinaire, '14'))
    cree.rdv.push(rdv.id)
    await deplacerRendezVous(ctxSecretaire, { id: rdv.id, debut: h('14', '11:00') })
    await deplacerRendezVous(ctxSecretaire, { id: rdv.id, debut: h('14', '10:00') }, { retourArriere: true })

    expect((await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id } })).debut).toEqual(h('14', '10:00'))
    const lignes = await modifications(rdv.id)
    expect(lignes).toHaveLength(1) // celle du premier déplacement, aucune pour le retour
    await traiterLot(dansSixMinutes())
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: lignes[0]!.id } })).statut).not.toBe('ENVOYEE')
  })

  it('le retour en arrière n’est permis qu’à son auteur, vers la place d’avant : sinon il déplacerait en silence', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('13:00', motifOrdinaire, '14'))
    cree.rdv.push(rdv.id)
    await deplacerRendezVous(ctxSecretaire, { id: rdv.id, debut: h('14', '13:30') })

    await expect(
      deplacerRendezVous(ctxAdmin, { id: rdv.id, debut: h('14', '13:00') }, { retourArriere: true }),
    ).rejects.toBeInstanceOf(RetourImpossibleError)
    await expect(
      deplacerRendezVous(ctxSecretaire, { id: rdv.id, debut: h('14', '14:00') }, { retourArriere: true }),
    ).rejects.toBeInstanceOf(RetourImpossibleError)
    expect((await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id } })).debut).toEqual(h('14', '13:30'))
  })

  it('une simple durée allongée : pas de SMS, l’heure du patient n’a pas changé', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('16:00', motifOrdinaire, '14'))
    cree.rdv.push(rdv.id)
    await deplacerRendezVous(ctxSecretaire, { id: rdv.id, debut: h('14', '16:00'), dureeMinutes: 60 })
    expect(await modifications(rdv.id)).toHaveLength(0)
  })
})

// Lot 6 : glisser-déposer dans la vue jour. Le fauteuil reste déduit de la
// présence du praticien (D11, `verifierCreneau`) — `fauteuilId` ne le CHOISIT
// jamais, il permet seulement de refuser proprement un dépôt dans une colonne
// où le praticien n'est pas, plutôt que de l'y écrire silencieusement ailleurs.
describe('déplacement vers un autre fauteuil (lot 6, glisser-déposer)', () => {
  it('accepté quand la colonne visée correspond à la présence du praticien à cette heure', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('09:30', motifOrdinaire, '10'))
    cree.rdv.push(rdv.id)

    const deplace = await deplacerRendezVous(ctxSecretaire, {
      id: rdv.id,
      debut: h('10', '13:00'),
      fauteuilId: fauteuilGlisserId,
    })
    expect(deplace.debut).toEqual(h('10', '13:00'))

    const enBase = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: { fauteuilId: true },
    })
    expect(enBase.fauteuilId).toBe(fauteuilGlisserId)
  })

  it('refusé quand la colonne visée ne correspond à aucune présence à cette heure : rien modifié', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('10:15', motifOrdinaire, '10'))
    cree.rdv.push(rdv.id)
    const avant = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: { debut: true, fauteuilId: true },
    })

    // 14h : le praticien y est bien présent, mais sur `fauteuilGlisserId`
    // (présence de l'après-midi) — pas sur le fauteuil d'origine demandé ici.
    await expect(
      deplacerRendezVous(ctxSecretaire, {
        id: rdv.id,
        debut: h('10', '14:00'),
        fauteuilId: fauteuilOriginalId,
      }),
    ).rejects.toThrow(CreneauRefuseError)

    const apres = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: { debut: true, fauteuilId: true },
    })
    expect(apres).toEqual(avant)
  })
})

describe('redimensionner la fin (lot 6, glisser-déposer)', () => {
  it('une nouvelle durée valide change la fin, sans toucher le fauteuil', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('09:00', motifOrdinaire, '11')) // 09:00–09:40
    cree.rdv.push(rdv.id)

    const redimensionne = await deplacerRendezVous(ctxSecretaire, {
      id: rdv.id,
      debut: h('11', '09:00'),
      dureeMinutes: 70, // 09:00–10:10 : rien d'autre avant 11:00 ce jour-là
      fauteuilId: fauteuilOriginalId,
    })
    expect((redimensionne.fin.getTime() - redimensionne.debut.getTime()) / 60_000).toBe(70)

    const enBase = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: { fauteuilId: true },
    })
    expect(enBase.fauteuilId).toBe(fauteuilOriginalId)
  })

  it('une durée qui chevaucherait un autre rendez-vous est refusée, rien modifié', async () => {
    const premier = await creerRendezVous(ctxSecretaire, base('11:00', motifOrdinaire, '11')) // 11:00–11:40
    cree.rdv.push(premier.id)
    const second = await creerRendezVous(ctxSecretaire, base('11:45', motifOrdinaire, '11')) // 11:45–12:25
    cree.rdv.push(second.id)

    const avant = await prisma.rendezVous.findUniqueOrThrow({ where: { id: premier.id }, select: { fin: true } })

    await expect(
      // Étirée à 60 minutes, la fin (12:00) chevaucherait `second` (11:45–12:25).
      deplacerRendezVous(ctxSecretaire, { id: premier.id, debut: h('11', '11:00'), dureeMinutes: 60 }),
    ).rejects.toThrow(CreneauRefuseError)

    const apres = await prisma.rendezVous.findUniqueOrThrow({ where: { id: premier.id }, select: { fin: true } })
    expect(apres).toEqual(avant)
  })
})

describe('conflit lors d’un déplacement par glisser (lot 6)', () => {
  it('chevauchement (même fauteuil, même praticien) : refusé, rien modifié', async () => {
    const fixe = await creerRendezVous(ctxSecretaire, base('15:00', motifOrdinaire, '12')) // 15:00–15:40
    cree.rdv.push(fixe.id)
    const aDeplacer = await creerRendezVous(ctxSecretaire, base('16:00', motifOrdinaire, '12')) // 16:00–16:40
    cree.rdv.push(aDeplacer.id)

    const avant = await prisma.rendezVous.findUniqueOrThrow({ where: { id: aDeplacer.id }, select: { debut: true } })

    await expect(
      deplacerRendezVous(ctxSecretaire, {
        id: aDeplacer.id,
        debut: h('12', '15:20'), // chevauche `fixe` (15:00–15:40)
        fauteuilId: fauteuilOriginalId,
      }),
    ).rejects.toThrow(CreneauRefuseError)

    const apres = await prisma.rendezVous.findUniqueOrThrow({ where: { id: aDeplacer.id }, select: { debut: true } })
    expect(apres).toEqual(avant)
  })
})

// Lot 5 : dupliquer un rendez-vous. Ce que ces tests éprouvent, et qu'une
// relecture du service ne montre pas — `dupliquerRendezVous` délègue ENTIÈREMENT
// à `creerRendezVous` : les mêmes refus (créneau pris, praticien absent, site
// hors portée, permission manquante) doivent donc s'appliquer sans rien écrire
// de plus, et la source ne disparaît ni ne change jamais.
describe('duplication (lot 5)', () => {
  it('duplication réussie : nouveau rendez-vous A_CONFIRMER, même patient/motif/praticien, source inchangée', async () => {
    const source = await creerRendezVous(ctxSecretaire, base('12:00'))
    cree.rdv.push(source.id)

    const copie = await dupliquerRendezVous(ctxSecretaire, {
      id: source.id,
      debut: h('09', '18:30'),
    })
    cree.rdv.push(copie.id)

    expect(copie.id).not.toBe(source.id)
    expect(copie.statut).toBe(StatutRendezVous.A_CONFIRMER)
    expect(copie.debut).toEqual(h('09', '18:30'))
    // Même durée que la source (40 minutes, le couple praticien × motif),
    // relue au moment de la copie plutôt que reprise telle quelle (D14).
    expect((copie.fin.getTime() - copie.debut.getTime()) / 60_000).toBe(40)

    const copieEnBase = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: copie.id },
      select: { patientId: true, praticienId: true, motifId: true, statut: true },
    })
    expect(copieEnBase.patientId).toBe(patientId)
    expect(copieEnBase.praticienId).toBe(praticienId)
    expect(copieEnBase.motifId).toBe(motifOrdinaire)
    expect(copieEnBase.statut).toBe(StatutRendezVous.A_CONFIRMER)

    // La source n'a pas bougé.
    const sourceEnBase = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: source.id },
      select: { statut: true, debut: true },
    })
    expect(sourceEnBase.statut).toBe(StatutRendezVous.A_CONFIRMER)
    expect(sourceEnBase.debut).toEqual(h('05', '12:00'))

    // Audit : action de création, filiation tracée.
    const ligne = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: copie.id, action: 'CREATE' },
      select: { metadata: true },
    })
    expect(ligne.metadata).toMatchObject({ dupliqueDe: source.id })
  })

  it('duplication sur un créneau en conflit (chevauchement même praticien) : refusée, rien créé', async () => {
    // Le tout premier rendez-vous du fichier, toujours occupé : 05/13:00–13:40.
    const source = await creerRendezVous(ctxSecretaire, base('14:00'))
    cree.rdv.push(source.id)

    const avant = await prisma.rendezVous.count({ where: { praticienId } })

    await expect(
      dupliquerRendezVous(ctxSecretaire, { id: source.id, debut: h('05', '13:00') }),
    ).rejects.toThrow(CreneauRefuseError)

    const apres = await prisma.rendezVous.count({ where: { praticienId } })
    expect(apres).toBe(avant)
  })

  it('duplication un jour sans présence du praticien : même refus qu’une création', async () => {
    const source = await creerRendezVous(ctxSecretaire, base('16:45'))
    cree.rdv.push(source.id)

    // Le 06 est volontairement vide de présence (voir la fixture en tête de
    // fichier) : c'est le jour « praticien absent ».
    await expect(
      dupliquerRendezVous(ctxSecretaire, { id: source.id, debut: h('06', '12:00') }),
    ).rejects.toThrow(CreneauRefuseError)
  })

  it('duplication d’une source hors de la portée site de l’appelant : refusée', async () => {
    const source = await creerRendezVous(ctxSecretaire, base('17:30'))
    cree.rdv.push(source.id)

    // Rattaché à AUCUN site : `filtreSite` ne lui rend jamais cette source,
    // exactement comme pour une lecture ordinaire (D5).
    const ctxHorsSite = await compte(RoleName.SECRETAIRE, 'sec-hors-site', [])

    await expect(
      dupliquerRendezVous(ctxHorsSite, { id: source.id, debut: h('09', '19:15') }),
    ).rejects.toThrow()

    const enBase = await prisma.rendezVous.count({ where: { praticienId, debut: h('09', '19:15') } })
    expect(enBase).toBe(0)
  })

  it('compte sans permission de création : refusé', async () => {
    const source = await creerRendezVous(ctxSecretaire, base('18:15'))
    cree.rdv.push(source.id)

    // Aucun rôle du seed ne porte `agenda:create` en moins des autres : le
    // dépourvoir directement éprouve la garde du service, pas une coïncidence
    // de la matrice actuelle.
    const ctxSansPermission = { ...ctxSecretaire, permissions: new Set<`${string}:${string}`>() }

    await expect(
      dupliquerRendezVous(ctxSansPermission, { id: source.id, debut: h('09', '19:45') }),
    ).rejects.toBeInstanceOf(PermissionDeniedError)
  })
})

describe('réservation concurrente (D12)', () => {
  it('deux créations simultanées sur le même créneau : une seule passe', async () => {
    // Le cas qui ne se manifeste jamais en développement et toujours en
    // production. Aucune vérification préalable ne peut l'éviter : entre le
    // contrôle et l'écriture, l'autre a le temps d'écrire. C'est la contrainte
    // d'exclusion du moteur qui tranche.
    const creneau = base('13:00', motifOrdinaire, '07')

    const resultats = await Promise.allSettled([
      creerRendezVous(ctxSecretaire, creneau),
      creerRendezVous(ctxSecretaire, creneau),
    ])

    const reussies = resultats.filter((r) => r.status === 'fulfilled')
    const echouees = resultats.filter((r) => r.status === 'rejected')

    expect(reussies).toHaveLength(1)
    expect(echouees).toHaveLength(1)

    for (const r of reussies) {
      if (r.status === 'fulfilled') cree.rdv.push(r.value.id)
    }

    const enBase = await prisma.rendezVous.count({
      where: { praticienId, debut: creneau.debut, statut: { not: StatutRendezVous.ANNULE } },
    })
    expect(enBase).toBe(1)
  })
})

describe('journalisation des écritures', () => {
  it('une création laisse sa trace, sans donnée de santé', async () => {
    const avant = await prisma.auditLog.count({
      where: { actorId: ctxSecretaire.userId, action: 'CREATE', entityType: 'agenda' },
    })

    const rdv = await creerRendezVous(ctxSecretaire, base('15:00', motifOrdinaire, '07'))
    cree.rdv.push(rdv.id)

    const ligne = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxSecretaire.userId, action: 'CREATE', entityType: 'agenda' },
      orderBy: { occurredAt: 'desc' },
      select: { entityId: true, metadata: true },
    })
    const apres = await prisma.auditLog.count({
      where: { actorId: ctxSecretaire.userId, action: 'CREATE', entityType: 'agenda' },
    })

    expect(apres).toBe(avant + 1)
    expect(ligne.entityId).toBe(rdv.id)

    // Ce que le journal ne doit PAS contenir : savoir qu'une personne nommée a
    // consulté est déjà une donnée de santé.
    const texte = JSON.stringify(ligne.metadata)
    expect(texte).not.toContain('Dupont')
    expect(texte).not.toContain('0590112233')
  })

  it('un changement de statut trace l’avant et l’après', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, base('17:00', motifOrdinaire, '07'))
    cree.rdv.push(rdv.id)

    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.CONFIRME })

    const ligne = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxSecretaire.userId, action: 'UPDATE', entityId: rdv.id },
      orderBy: { occurredAt: 'desc' },
      select: { metadata: true },
    })
    expect(ligne.metadata).toMatchObject({
      statutAvant: StatutRendezVous.A_CONFIRMER,
      statutApres: StatutRendezVous.CONFIRME,
    })
  })
})

// Q27 : trois rendez-vous annulés ou non honorés et la réservation en ligne se
// ferme. Ce que ces tests éprouvent, et qu'une relecture ne montre pas : le
// compteur ne double pas quand on reclique, il redescend quand on corrige, et
// une annulation posée par le cabinet ne coûte rien au patient.
describe('manquements du patient (Q27)', () => {
  let n = 0

  async function patientNeuf(cle: string) {
    n += 1
    const p = await creerPatient(ctxSecretaire, {
      nom: 'Manquement', prenom: `${cle}-${SUFFIXE}`, telephone: `05909${String(n).padStart(5, '0')}`,
    })
    cree.patients.push(p.id)
    return p.id
  }

  const compteur = async (id: string) =>
    prisma.patient.findUniqueOrThrow({
      where: { id },
      select: { manquements: true, reservationBloquee: true },
    })

  async function rdvPour(patientId: string, heure: string) {
    const rdv = await creerRendezVous(ctxSecretaire, {
      ...base(heure, motifOrdinaire, '08'),
      patientId,
    })
    cree.rdv.push(rdv.id)
    return rdv
  }

  it('« absent » coûte un point, et recliquer ne le compte pas deux fois', async () => {
    const pid = await patientNeuf('absent')
    const rdv = await rdvPour(pid, '12:00')

    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ABSENT })
    expect((await compteur(pid)).manquements).toBe(1)

    // La secrétaire reclique « Changer » sur la même ligne, par hésitation ou
    // par accident. Le drapeau du rendez-vous est déjà posé : rien ne bouge.
    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ABSENT })
    expect((await compteur(pid)).manquements).toBe(1)
  })

  it('corriger la ligne rend le point au patient', async () => {
    const pid = await patientNeuf('corrige')
    const rdv = await rdvPour(pid, '13:00')

    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ABSENT })
    expect((await compteur(pid)).manquements).toBe(1)

    // Le patient arrive avec cinq minutes de retard : la secrétaire se ravise.
    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.AU_FAUTEUIL })
    expect((await compteur(pid)).manquements).toBe(0)
  })

  it('trois manquements ferment la réservation en ligne', async () => {
    const pid = await patientNeuf('bloque')

    for (const heure of ['14:00', '15:00', '16:00']) {
      const rdv = await rdvPour(pid, heure)
      await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ABSENT })
    }

    const etat = await compteur(pid)
    expect(etat.manquements).toBe(3)
    expect(etat.reservationBloquee).toBe(true)
  })

  it("le cabinet qui annule ne coûte rien au patient", async () => {
    const pid = await patientNeuf('cabinet')
    const rdv = await rdvPour(pid, '17:00')

    // Le praticien est souffrant, il vide lui-même sa journée (Q5). Ce n'est
    // pas la faute du patient : son compteur ne bouge pas.
    //
    // ⚠ `ctxPraticien`, pas `ctxSecretaire` : depuis le 2026-09-23 (D17,
    // retournée une seconde fois), la secrétaire ne fait plus qu'une DEMANDE,
    // qui ne touche aucun manquement tant qu'elle n'est pas validée. Ce test
    // veut éprouver l'annulation elle-même, donc l'annulation DIRECTE, posée
    // par le praticien traitant.
    await annulerRendezVous(ctxPraticien, { id: rdv.id })

    const etat = await compteur(pid)
    expect(etat.manquements).toBe(0)
    expect(etat.reservationBloquee).toBe(false)
  })

  it('annuler un rendez-vous déjà marqué absent rend le point', async () => {
    const pid = await patientNeuf('rendu')
    const rdv = await rdvPour(pid, '18:00')

    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ABSENT })
    expect((await compteur(pid)).manquements).toBe(1)

    // Même remarque : une simple DEMANDE (par `ctxSecretaire`) ne rendrait rien
    // au patient tant qu'elle n'est pas validée — seule l'annulation DIRECTE du
    // praticien traitant rend le point immédiatement (D17, retournée le
    // 2026-09-23).
    await annulerRendezVous(ctxPraticien, { id: rdv.id })
    expect((await compteur(pid)).manquements).toBe(0)
  })

  it('le blocage retombe dès que la secrétaire corrige une ligne', async () => {
    const pid = await patientNeuf('debloque')
    let premier = ''
    for (const heure of ['19:00', '19:45', '20:15']) {
      const rdv = await rdvPour(pid, heure)
      await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ABSENT })
      premier ||= rdv.id
    }
    expect((await compteur(pid)).reservationBloquee).toBe(true)

    await changerStatut(ctxSecretaire, { id: premier, statut: StatutRendezVous.TERMINE })

    const etat = await compteur(pid)
    expect(etat.manquements).toBe(2)
    expect(etat.reservationBloquee).toBe(false)
  })
})
