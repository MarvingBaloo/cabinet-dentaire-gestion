import { StatutRendezVous } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { instantCabinet } from '@/lib/dates'
import { prisma } from '@/server/db/client'
import {
  annulerParPatient,
  creneauxPourDeplacement,
  demanderAcces,
  deplacerParPatient,
  verifierAcces,
} from '@/server/services/acces-patient'
import { traiterLot } from '@/server/notifications/file'
import { definirTransporteur, type Message } from '@/server/sms/envoi'

// Ce que ces tests cherchent à prouver (D28), dans l'ordre de ce qui coûterait
// cher :
//   - un déplacement modifie le rendez-vous EN PLACE : ancien créneau libéré,
//     nouveau occupé, aucun manquement — jamais, à la différence de l'annulation
//   - deux patients qui déplacent sur le même créneau : un seul gagne, comme à
//     la réservation (D12), même contrainte d'exclusion de la base
//   - sous 24 h, l'annulation se ferme mais le déplacement reste ouvert — c'est
//     précisément ce qu'il remplace (Q28)
//   - un patient bloqué (D21) peut quand même déplacer : ça ne compte jamais
//     comme manquement
//   - un rendez-vous en ANNULATION_DEMANDEE ne se déplace pas (D27)
//   - horizon et motif sont revérifiés à l'écriture, pas seulement proposés
//   - tout est tracé au journal, sans nommer personne

const SUFFIXE = Date.now()
const IP = `198.51.100.${(SUFFIXE + 7) % 200}`

const TEL_A = `+3363333${String(SUFFIXE).slice(-4)}`
const TEL_B = `+3364444${String(SUFFIXE).slice(-4)}`

let siteId: string
let praticienId: string
let fauteuilId: string
let motifId: string
/** Praticien qui ne pratique PAS le motif ci-dessus : sert au refus « hors périmètre ». */
let praticienEtrangerId: string

const cree = {
  praticiens: [] as string[],
  fauteuils: [] as string[],
  motifs: [] as string[],
  plages: [] as string[],
}

let dernierCode = ''
let dernierTexte = ''
const transporteurEssai = {
  nom: 'essai',
  async envoyer(m: Message) {
    dernierCode = /(\d{6})/.exec(m.texte)?.[1] ?? ''
    dernierTexte = m.texte
    return { ok: true as const, reference: 'essai' }
  },
}

/** Décale l'instant courant de `heures` heures — jamais de date UTC fixe : les
 *  tests de délai (24 h) doivent rester vrais quelle que soit l'heure à
 *  laquelle la suite tourne. */
const decale = (heures: number) => new Date(Date.now() + heures * 3_600_000)

async function patientAvecRdv(telephone: string, dansHeures: number) {
  const patient = await prisma.patient.create({
    data: { nom: `Deplace${SUFFIXE}`, prenom: 'Test', telephone },
    select: { id: true },
  })
  const debut = decale(dansHeures)
  const rdv = await prisma.rendezVous.create({
    data: {
      patientId: patient.id,
      praticienId,
      siteId,
      fauteuilId,
      motifId,
      debut,
      fin: new Date(debut.getTime() + 30 * 60_000),
    },
    select: { id: true },
  })
  return { patientId: patient.id, rendezVousId: rdv.id, debut }
}

/** Ouvre une fenêtre et rend le jeton, comme le ferait le parcours complet. */
async function ouvrirFenetre(telephone: string) {
  const demande = await demanderAcces(telephone, IP)
  if (demande.etat !== 'code_envoye') throw new Error(demande.etat)
  const verif = await verifierAcces(telephone, dernierCode)
  if (verif.etat !== 'ouvert') throw new Error(verif.etat)
  return verif.jeton
}

beforeAll(async () => {
  definirTransporteur(transporteurEssai)

  siteId = (await prisma.site.findFirstOrThrow({ select: { id: true } })).id

  const p = await prisma.praticien.create({
    data: { nom: `Deplace${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const etranger = await prisma.praticien.create({
    data: { nom: `Etranger${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienEtrangerId = etranger.id
  cree.praticiens.push(etranger.id)

  const f = await prisma.fauteuil.create({
    data: { siteId, nom: `Fauteuil deplace ${SUFFIXE}` },
    select: { id: true },
  })
  fauteuilId = f.id
  cree.fauteuils.push(f.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Acte deplace ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)

  // Seul `praticienId` pratique ce motif : `praticienEtrangerId` sert au refus
  // « hors périmètre » (le rendez-vous ne peut pas changer de motif, D28).
  await prisma.praticienMotif.create({ data: { praticienId, motifId, dureeMinutes: 30 } })

  // Une présence large : de la veille à 90 jours devant, pour que les tests de
  // délai (quelques heures) et d'horizon (au-delà de deux mois) trouvent tous
  // deux un praticien présent — seul l'horizon de `deplacerParPatient` doit
  // trancher pour le second, pas l'absence de plage.
  const plage = await prisma.plageDePresence.create({
    data: {
      praticienId,
      siteId,
      fauteuilId,
      debut: decale(-24),
      fin: decale(90 * 24),
    },
    select: { id: true },
  })
  cree.plages.push(plage.id)
})

const TELS = [TEL_A, TEL_B]

beforeEach(async () => {
  dernierTexte = ''
  await prisma.accesPatient.deleteMany({ where: { telephone: { in: TELS } } })
  // Doit précéder la suppression des rendez-vous : `Notification.rendezVous`
  // est `onDelete: Restrict` (phase 4, lot 3, D37) — un déplacement émet
  // désormais une ligne MODIFICATION_RENDEZ_VOUS.
  await prisma.notification.deleteMany({ where: { destinataire: { in: TELS } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: [praticienId, praticienEtrangerId] } } })
  await prisma.patient.deleteMany({ where: { telephone: { in: TELS } } })
})

afterAll(async () => {
  await prisma.accesPatient.deleteMany({ where: { telephone: { in: TELS } } })
  await prisma.notification.deleteMany({ where: { destinataire: { in: TELS } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: [praticienId, praticienEtrangerId] } } })
  await prisma.patient.deleteMany({ where: { telephone: { in: TELS } } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: cree.plages } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  await prisma.$disconnect()
})

describe('créneaux proposés pour un déplacement', () => {
  it('rend une liste bornée au même motif et au même site que le rendez-vous', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_A, 5 * 24)
    const jeton = await ouvrirFenetre(TEL_A)

    const creneaux = await creneauxPourDeplacement(jeton, rendezVousId, new Date())
    expect(creneaux).not.toBeNull()
    expect(creneaux?.length).toBeGreaterThan(0)
    for (const c of creneaux ?? []) {
      expect(c.siteId).toBe(siteId)
      expect(c.praticienId).toBe(praticienId)
    }
  })

  it('ne rend rien sans fenêtre valide', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_A, 5 * 24)
    expect(await creneauxPourDeplacement('jeton-inventé', rendezVousId, new Date())).toBeNull()
  })
})

describe('déplacement par le patient', () => {
  it('déplace EN PLACE : ancien créneau libéré, nouveau occupé, aucun manquement', async () => {
    const { patientId, rendezVousId, debut: ancienDebut } = await patientAvecRdv(TEL_A, 5 * 24)
    const jeton = await ouvrirFenetre(TEL_A)

    const nouveauDebut = decale(6 * 24)
    const r = await deplacerParPatient(jeton, rendezVousId, nouveauDebut, praticienId, IP, new Date())
    expect(r.etat).toBe('deplace')
    if (r.etat !== 'deplace') return
    expect(r.rendezVousId).toBe(rendezVousId) // même id : modification en place, pas recréation

    const rdv = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rendezVousId },
      select: { debut: true, statut: true, manquementCompte: true, praticienId: true },
    })
    expect(rdv.debut.getTime()).toBe(r.debut.getTime())
    expect(rdv.manquementCompte).toBe(false)
    // Le statut n'est pas touché par le déplacement : un rendez-vous « à
    // confirmer » le reste, ce n'est pas une nouvelle réservation.
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)

    // L'ancien créneau n'est plus occupé par AUCUN rendez-vous de ce praticien.
    const surAncien = await prisma.rendezVous.findFirst({
      where: { praticienId, debut: ancienDebut },
    })
    expect(surAncien).toBeNull()

    const patient = await prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { manquements: true },
    })
    expect(patient.manquements).toBe(0)

    // Depuis la file de notifications (phase 4, lot 3, D37) : `deplacerParPatient`
    // n'envoie plus de SMS de façon synchrone, elle émet une ligne — c'est le
    // worker (ici, `traiterLot` appelé directement) qui l'envoie réellement.
    // `2027-04-09` est toujours postérieur à la date réelle d'exécution des
    // tests, donc toujours après le `planifiePour` par défaut de l'émission.
    await traiterLot(instantCabinet('2027-04-09', '12:00') as Date)
    expect(dernierTexte).toContain('déplacé')
  })

  it('refuse un patient dont le rendez-vous n’est plus le sien', async () => {
    await patientAvecRdv(TEL_A, 5 * 24)
    const autre = await patientAvecRdv(TEL_B, 5 * 24 + 1)
    const jeton = await ouvrirFenetre(TEL_A)

    const r = await deplacerParPatient(jeton, autre.rendezVousId, decale(6 * 24), praticienId, IP, new Date())
    expect(r.etat).toBe('introuvable')
  })

  it('course : deux patients déplacent vers le même créneau, un seul gagne', async () => {
    const a = await patientAvecRdv(TEL_A, 5 * 24)
    const b = await patientAvecRdv(TEL_B, 5 * 24 + 1)
    const jetonA = await ouvrirFenetre(TEL_A)
    const jetonB = await ouvrirFenetre(TEL_B)

    const cible = decale(7 * 24)

    const [ra, rb] = await Promise.all([
      deplacerParPatient(jetonA, a.rendezVousId, cible, praticienId, IP, new Date()),
      deplacerParPatient(jetonB, b.rendezVousId, cible, praticienId, IP, new Date()),
    ])

    const etats = [ra.etat, rb.etat].sort()
    // L'un obtient le créneau, l'autre lit que c'est déjà pris — jamais les
    // deux à la fois, et jamais aucun des deux (la contrainte d'exclusion de
    // la base tranche, comme à la réservation, D12).
    expect(etats).toEqual(['creneau_indisponible', 'deplace'])

    const surCible = await prisma.rendezVous.count({
      where: { praticienId, debut: cible, statut: { not: StatutRendezVous.ANNULE } },
    })
    expect(surCible).toBe(1)
  })

  it('reste ouvert sous 24 h, quand l’annulation ne l’est plus (Q28)', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_A, 3) // dans 3 heures
    const jeton = await ouvrirFenetre(TEL_A)

    // L'annulation refuse : c'est le point de départ de Q28.
    const annulation = await annulerParPatient(jeton, rendezVousId, IP, new Date())
    expect(annulation.etat).toBe('trop_tard')

    // Le déplacement, lui, reste ouvert — c'est ce qu'il remplace (D28).
    const deplacement = await deplacerParPatient(
      jeton,
      rendezVousId,
      decale(30 * 24),
      praticienId,
      IP,
      new Date(),
    )
    expect(deplacement.etat).toBe('deplace')
  })

  it('laisse déplacer un patient dont la réservation en ligne est bloquée (D21, D28)', async () => {
    const patient = await prisma.patient.create({
      data: { nom: `Deplace${SUFFIXE}`, prenom: 'Bloque', telephone: TEL_A, reservationBloquee: true, manquements: 3 },
      select: { id: true },
    })
    const debut = decale(5 * 24)
    const rdv = await prisma.rendezVous.create({
      data: { patientId: patient.id, praticienId, siteId, fauteuilId, motifId, debut, fin: new Date(debut.getTime() + 30 * 60_000) },
      select: { id: true },
    })
    const jeton = await ouvrirFenetre(TEL_A)

    const r = await deplacerParPatient(jeton, rdv.id, decale(6 * 24), praticienId, IP, new Date())
    // Un déplacement ne compte jamais comme manquement : le blocage de D21, qui
    // porte sur la RÉSERVATION, ne s'applique pas ici (D28, lecture retenue).
    expect(r.etat).toBe('deplace')

    const toujoursBloque = await prisma.patient.findUniqueOrThrow({
      where: { id: patient.id },
      select: { reservationBloquee: true, manquements: true },
    })
    expect(toujoursBloque.reservationBloquee).toBe(true)
    expect(toujoursBloque.manquements).toBe(3)
  })

  it('refuse un rendez-vous en attente d’une demande d’annulation (D27, D28)', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_A, 5 * 24)
    await prisma.rendezVous.update({
      where: { id: rendezVousId },
      data: {
        statut: StatutRendezVous.ANNULATION_DEMANDEE,
        statutAvantAnnulation: StatutRendezVous.CONFIRME,
        annulationDemandeeLe: new Date(),
      },
    })
    const jeton = await ouvrirFenetre(TEL_A)

    const r = await deplacerParPatient(jeton, rendezVousId, decale(6 * 24), praticienId, IP, new Date())
    expect(r.etat).toBe('introuvable')
  })

  it('refuse un créneau au-delà de l’horizon de deux mois', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_A, 5 * 24)
    const jeton = await ouvrirFenetre(TEL_A)

    const r = await deplacerParPatient(jeton, rendezVousId, decale(70 * 24), praticienId, IP, new Date())
    expect(r.etat).toBe('hors_perimetre')
  })

  it('refuse un praticien qui ne pratique pas le motif du rendez-vous', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_A, 5 * 24)
    const jeton = await ouvrirFenetre(TEL_A)

    const r = await deplacerParPatient(
      jeton,
      rendezVousId,
      decale(6 * 24),
      praticienEtrangerId,
      IP,
      new Date(),
    )
    expect(r.etat).toBe('hors_perimetre')
  })

  it('laisse une trace au journal, sans nommer personne', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_A, 5 * 24)
    const jeton = await ouvrirFenetre(TEL_A)
    await deplacerParPatient(jeton, rendezVousId, decale(6 * 24), praticienId, IP, new Date())

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: rendezVousId, action: 'UPDATE' },
      orderBy: { occurredAt: 'desc' },
      select: { actorId: true, ipAddress: true, metadata: true },
    })
    expect(trace.actorId).toBeNull()
    expect(trace.ipAddress).toBe(IP)
    expect(trace.metadata).toMatchObject({ origine: 'portail public', deplacePar: 'patient' })
    expect(JSON.stringify(trace.metadata)).not.toContain(TEL_A)
  })
})
