import { RoleName, SiteCode, StatutRendezVous } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { changerStatut, marquerAbsentsAutomatiques } from '@/server/services/agenda'

// Q27, lot 3 : « 20 minutes de retard → patient noté absent, rendez-vous
// annulé automatiquement. » Ce que ces tests éprouvent, et qu'une relecture
// ne montre pas :
//   - le seuil des 20 minutes est appliqué à la minute près (19 vs 21)
//   - SALLE_ATTENTE, AU_FAUTEUIL et ANNULATION_DEMANDEE ne sont JAMAIS touchés
//   - un site sans poste vivant depuis 10 minutes est intégralement épargné
//   - l'audit porte un acteur "système" explicite, distinct d'un compte humain
//   - un second passage ne recompte pas le manquement (idempotence)
//   - aucune liste d'attente n'est sollicitée (le créneau est déjà passé)
//   - la secrétaire peut corriger un absent automatique, et le manquement lui
//     est rendu — exactement comme pour un absent posé à la main (D21)
//
// Chaque test choisit son PROPRE `maintenant`, espacé de trois jours civils du
// précédent (`nouveauMaintenant`). Deux raisons, une seule fixture (même
// praticien, même fauteuil, pour rester proche de service-agenda.test.ts) :
//   - les contraintes d'exclusion de `prisma/sql/03_agenda_contraintes.sql`
//     interdisent à CE praticien deux rendez-vous qui se chevauchent — des
//     fenêtres de test rapprochées entreraient en collision ;
//   - l'horizon de rattrapage de 48h (`HORIZON_RATTRAPAGE_ABSENCE_MS`) doit
//     rester hermétique d'un test à l'autre : un écart de 3 jours (72h) est
//     strictement supérieur à 48h + 20 min, donc un rendez-vous laissé
//     `CONFIRME` par un test ne peut jamais retomber dans la fenêtre balayée
//     par le suivant.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

// Choisie loin de toute autre fixture connue de la suite : ni 2027
// (tests/service-agenda.test.ts), ni mai 2026
// (tests/notifications-rappels.test.ts), tous deux hors de la fenêtre de 48h
// que `marquerAbsentsAutomatiques` regarde autour de `maintenant`.
let compteurJour = 0
function nouveauMaintenant(): Date {
  compteurJour += 3
  return new Date(Date.UTC(2026, 5, 15 + compteurJour, 14, 0, 0))
}

let siteMG: string
let siteGP: string
let fauteuilMG: string
let fauteuilGP: string
let praticienId: string
let motifId: string
let ctxSecretaire: AuthContext

const cree = {
  praticiens: [] as string[],
  motifs: [] as string[],
  patients: [] as string[],
  rdv: [] as string[],
  workstations: [] as string[],
}

let compteurTel = 0
function telephone(): string {
  compteurTel += 1
  return `+3369${String(SUFFIXE).slice(-4)}${String(compteurTel).padStart(3, '0')}`
}

async function creerPatientTest() {
  const patient = await prisma.patient.create({
    data: { nom: `Absence${SUFFIXE}`, prenom: 'Test', telephone: telephone() },
    select: { id: true },
  })
  cree.patients.push(patient.id)
  return patient.id
}

async function creerRdv(params: {
  siteId: string
  fauteuilId: string
  debut: Date
  statut: StatutRendezVous
}) {
  const patientId = await creerPatientTest()
  const rdv = await prisma.rendezVous.create({
    data: {
      patientId,
      praticienId,
      siteId: params.siteId,
      fauteuilId: params.fauteuilId,
      motifId,
      debut: params.debut,
      fin: new Date(params.debut.getTime() + 30 * 60_000),
      statut: params.statut,
    },
    select: { id: true, statut: true, patientId: true, debut: true, fin: true },
  })
  cree.rdv.push(rdv.id)
  return rdv
}

/** Un poste actif de ce site, vu 5 minutes avant `maintenant` — rend le site
 *  vivant pour CE `maintenant` précis (voir la borne haute `lte: maintenant`
 *  de `sitesVivants`, qui rend le vivant relatif au passage, pas à l'horloge
 *  réelle). */
async function garantirPosteVivant(siteId: string, maintenant: Date) {
  const ws = await prisma.workstation.create({
    data: {
      siteId,
      nom: `Poste absence ${SUFFIXE}-${cree.workstations.length}`,
      secretHash: 'x'.repeat(64),
      actif: true,
      lastSeenAt: new Date(maintenant.getTime() - 5 * 60_000),
    },
    select: { id: true },
  })
  cree.workstations.push(ws.id)
}

async function manquements(patientId: string) {
  const p = await prisma.patient.findUniqueOrThrow({
    where: { id: patientId },
    select: { manquements: true },
  })
  return p.manquements
}

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id
  fauteuilMG = (await prisma.fauteuil.findFirstOrThrow({ where: { siteId: siteMG } })).id
  fauteuilGP = (await prisma.fauteuil.findFirstOrThrow({ where: { siteId: siteGP } })).id

  const p = await prisma.praticien.create({
    data: { nom: `Absence${SUFFIXE}`, prenom: 'Test', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Acte absence ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)

  const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SECRETAIRE } })
  const u = await prisma.user.create({
    data: {
      email: `svc-absence-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: 'Secretaire',
      passwordHash: 'x',
      roles: { create: { roleId: role.id } },
      sites: { create: [{ siteId: siteMG }, { siteId: siteGP }] },
    },
    select: { id: true },
  })
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error('Contexte secrétaire introuvable')
  ctxSecretaire = ctx
})

afterAll(async () => {
  await prisma.rendezVous.deleteMany({ where: { id: { in: cree.rdv } } })
  await prisma.workstation.deleteMany({ where: { id: { in: cree.workstations } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  await prisma.$disconnect()
})

describe('absence automatique 20 minutes après le début (Q27, lot 3)', () => {
  it('CONFIRME à début + 21 min → ABSENT, manquement compté, audit acteur système', async () => {
    const maintenant = nouveauMaintenant()
    await garantirPosteVivant(siteMG, maintenant)
    const rdv = await creerRdv({
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      debut: new Date(maintenant.getTime() - 21 * 60_000),
      statut: StatutRendezVous.CONFIRME,
    })

    const resultat = await marquerAbsentsAutomatiques(maintenant)
    expect(resultat.marques).toBeGreaterThanOrEqual(1)

    const apres = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: { statut: true, manquementCompte: true },
    })
    expect(apres.statut).toBe(StatutRendezVous.ABSENT)
    expect(apres.manquementCompte).toBe(true)
    expect(await manquements(rdv.patientId)).toBe(1)

    const ligne = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'agenda', entityId: rdv.id, action: 'UPDATE' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(ligne.actorId).toBeNull()
    expect(ligne.actorEmail).toBe('système')
    expect(ligne.metadata).toMatchObject({
      statutAvant: StatutRendezVous.CONFIRME,
      statutApres: StatutRendezVous.ABSENT,
      manquements: 1,
      raisonAutomatique: 'retard_20_min',
    })
  })

  it('CONFIRME à début + 19 min → inchangé (pas encore 20 minutes de retard)', async () => {
    const maintenant = nouveauMaintenant()
    await garantirPosteVivant(siteMG, maintenant)
    const rdv = await creerRdv({
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      debut: new Date(maintenant.getTime() - 19 * 60_000),
      statut: StatutRendezVous.CONFIRME,
    })

    await marquerAbsentsAutomatiques(maintenant)

    const apres = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id }, select: { statut: true } })
    expect(apres.statut).toBe(StatutRendezVous.CONFIRME)
  })

  it.each([StatutRendezVous.SALLE_ATTENTE, StatutRendezVous.AU_FAUTEUIL])(
    '%s en retard n’est jamais touché : le patient est déjà là',
    async (statut) => {
      const maintenant = nouveauMaintenant()
      await garantirPosteVivant(siteMG, maintenant)
      const rdv = await creerRdv({
        siteId: siteMG,
        fauteuilId: fauteuilMG,
        debut: new Date(maintenant.getTime() - 40 * 60_000),
        statut,
      })

      await marquerAbsentsAutomatiques(maintenant)

      const apres = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id }, select: { statut: true } })
      expect(apres.statut).toBe(statut)
    },
  )

  it('ANNULATION_DEMANDEE en retard n’est jamais touché : une demande en attente n’est pas court-circuitée (D17)', async () => {
    const maintenant = nouveauMaintenant()
    await garantirPosteVivant(siteMG, maintenant)
    const rdv = await creerRdv({
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      debut: new Date(maintenant.getTime() - 40 * 60_000),
      statut: StatutRendezVous.ANNULATION_DEMANDEE,
    })

    await marquerAbsentsAutomatiques(maintenant)

    const apres = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id }, select: { statut: true } })
    expect(apres.statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
  })

  it('un site sans aucun poste enregistré est épargné (parade hors ligne, dans le doute)', async () => {
    const maintenant = nouveauMaintenant()
    // Aucun `garantirPosteVivant` pour la Guadeloupe : ni ici, ni ailleurs
    // dans ce fichier — c'est tout le point du test.
    const rdv = await creerRdv({
      siteId: siteGP,
      fauteuilId: fauteuilGP,
      debut: new Date(maintenant.getTime() - 40 * 60_000),
      statut: StatutRendezVous.CONFIRME,
    })

    const resultat = await marquerAbsentsAutomatiques(maintenant)
    expect(resultat.sitesIgnores).toContain(siteGP)

    const apres = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id }, select: { statut: true } })
    expect(apres.statut).toBe(StatutRendezVous.CONFIRME)
  })

  it('un poste vu il y a plus de 10 minutes ne rend pas le site vivant', async () => {
    const maintenant = nouveauMaintenant()
    const rdv = await creerRdv({
      siteId: siteGP,
      fauteuilId: fauteuilGP,
      debut: new Date(maintenant.getTime() - 40 * 60_000),
      statut: StatutRendezVous.CONFIRME,
    })
    const ws = await prisma.workstation.create({
      data: {
        siteId: siteGP,
        nom: `Poste absence périmé ${SUFFIXE}`,
        secretHash: 'x'.repeat(64),
        actif: true,
        lastSeenAt: new Date(maintenant.getTime() - 11 * 60_000),
      },
      select: { id: true },
    })
    cree.workstations.push(ws.id)

    await marquerAbsentsAutomatiques(maintenant)

    const apres = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id }, select: { statut: true } })
    expect(apres.statut).toBe(StatutRendezVous.CONFIRME)
  })

  it('idempotence : un second passage ne recompte pas le manquement et ne réécrit pas l’audit', async () => {
    const maintenant = nouveauMaintenant()
    await garantirPosteVivant(siteMG, maintenant)
    const rdv = await creerRdv({
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      debut: new Date(maintenant.getTime() - 25 * 60_000),
      statut: StatutRendezVous.A_CONFIRMER,
    })

    await marquerAbsentsAutomatiques(maintenant)
    expect(await manquements(rdv.patientId)).toBe(1)

    await marquerAbsentsAutomatiques(maintenant)
    expect(await manquements(rdv.patientId)).toBe(1)

    const lignes = await prisma.auditLog.count({
      where: { entityType: 'agenda', entityId: rdv.id, action: 'UPDATE', actorEmail: 'système' },
    })
    expect(lignes).toBe(1)
  })

  it('n’émet aucune notification et ne sollicite pas la liste d’attente : le créneau est déjà passé', async () => {
    const maintenant = nouveauMaintenant()
    await garantirPosteVivant(siteMG, maintenant)
    const rdv = await creerRdv({
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      debut: new Date(maintenant.getTime() - 30 * 60_000),
      statut: StatutRendezVous.CONFIRME,
    })

    await marquerAbsentsAutomatiques(maintenant)

    expect(await prisma.notification.count({ where: { rendezVousId: rdv.id } })).toBe(0)
    expect(
      await prisma.envoiListeAttente.count({
        where: { praticienId, creneauDebut: rdv.debut, creneauFin: rdv.fin },
      }),
    ).toBe(0)
  })

  it('la secrétaire corrige un absent automatique : le manquement est rendu (D21)', async () => {
    const maintenant = nouveauMaintenant()
    await garantirPosteVivant(siteMG, maintenant)
    const rdv = await creerRdv({
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      debut: new Date(maintenant.getTime() - 45 * 60_000),
      statut: StatutRendezVous.CONFIRME,
    })

    await marquerAbsentsAutomatiques(maintenant)
    expect(await manquements(rdv.patientId)).toBe(1)

    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.CONFIRME })

    const apres = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rdv.id },
      select: { statut: true, manquementCompte: true },
    })
    expect(apres.statut).toBe(StatutRendezVous.CONFIRME)
    expect(apres.manquementCompte).toBe(false)
    expect(await manquements(rdv.patientId)).toBe(0)
  })

  it('ne remonte pas l’historique au-delà de la fenêtre de rattrapage (anomalie laissée à un regard humain)', async () => {
    const maintenant = nouveauMaintenant()
    await garantirPosteVivant(siteMG, maintenant)
    const rdv = await creerRdv({
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      debut: new Date(maintenant.getTime() - 72 * 3_600_000), // 3 jours avant
      statut: StatutRendezVous.CONFIRME,
    })

    await marquerAbsentsAutomatiques(maintenant)

    const apres = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id }, select: { statut: true } })
    expect(apres.statut).toBe(StatutRendezVous.CONFIRME)
  })
})
