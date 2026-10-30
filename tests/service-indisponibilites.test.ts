import { RoleName, SiteCode } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { decalerJour, instantCabinet, jourLocal } from '@/lib/dates'
import { estJourFerie } from '@/lib/jours-feries'
import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { PorteeSiteError } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import { jourSemaineISO } from '@/server/domaine/presences'
import { creneauxDisponibles } from '@/server/queries/public/creneaux'
import { creerPatient, creerRendezVous } from '@/server/services/agenda'
import {
  IndisponibiliteBloqueeError,
  creerIndisponibilite,
  supprimerIndisponibilite,
} from '@/server/services/indisponibilites'
import { enregistrerJourSemaineType } from '@/server/services/presences'

// Ce que ces tests éprouvent, branchés sur la vraie base (D4, D5, D9, D11,
// même principe que service-presences.test.ts) :
//   - la garde anti-orphelin (Q5) refuse ET n'écrit rien, pour un congé
//     praticien comme pour une fermeture de site
//   - la portée (D5) protège une fermeture de site ET un congé praticien qui
//     n'a de sens que par les sites où il travaille
//   - le portail public (`creneauxDisponibles`) respecte l'un et l'autre
//   - une suppression rouvre la disponibilité, sans garde à rejouer

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let siteMG: string
let siteGP: string
let ctxSecretaire: AuthContext
let ctxSecretaireGP: AuthContext
let praticienId: string
let fauteuilMG: string
let motifId: string
let patientId: string

const cree: { praticiens: string[]; patients: string[]; motifs: string[]; indisponibilites: string[] } = {
  praticiens: [],
  patients: [],
  motifs: [],
  indisponibilites: [],
}

async function compte(role: RoleName, cle: string, sites: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `indispo-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: { roleId: r.id } },
      sites: { create: sites.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  })
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error(`Contexte introuvable : ${cle}`)
  return ctx
}

const joursDejaUtilises = new Set<string>()

/**
 * Un mercredi (jourSemaine = 3) OUVRABLE — jamais férié (Q29, Q30, lot 2) —
 * et jamais réutilisé deux fois dans ce fichier. Jamais écrit en dur (même
 * principe que service-presences.test.ts) : chaque appel avance d'une semaine
 * de plus tant que la date tombée est un férié ou déjà prise par un appel
 * précédent, ce qui reste vrai quel que soit le jour où la suite s'exécute —
 * contrairement à un index de semaine choisi à la main, qui se périmerait dès
 * qu'un jour férié viendrait à tomber ailleurs dans le calendrier.
 *
 * Une plage de présence hebdomadaire ne couvre QUE les mercredis (`beforeAll`) :
 * un mercredi férié n'en produit aucune (lot 2), et un test qui suppose une
 * présence existante échouerait pour une raison qu'il ne teste pas s'il
 * tombait dessus sans le savoir.
 */
function prochainMercrediOuvrable(): string {
  let jour = jourLocal(new Date())
  while (jourSemaineISO(jour) !== 3) jour = decalerJour(jour, 1)
  jour = decalerJour(jour, 7)
  while (estJourFerie(jour) || joursDejaUtilises.has(jour)) jour = decalerJour(jour, 7)
  joursDejaUtilises.add(jour)
  return jour
}

// Un jour par test qui écrit ou vérifie quelque chose de persistant ; les
// tests qui échouent AVANT toute lecture ou écriture significative (permission
// refusée, portée refusée sur une fermeture) réutilisent `JOUR_Q5_CONGE` — rien
// n'y dépend de son état, seule son existence en tant que mercredi ouvrable
// compte pour la vérification de portée d'un congé.
const JOUR_Q5_CONGE = prochainMercrediOuvrable()
const JOUR_CONGE_ACCEPTE = prochainMercrediOuvrable()
const JOUR_Q5_FERMETURE = prochainMercrediOuvrable()
const JOUR_PORTAIL_CONGE = prochainMercrediOuvrable()
const JOUR_PORTAIL_FERMETURE = prochainMercrediOuvrable()
const JOUR_SUPPRESSION = prochainMercrediOuvrable()

/**
 * Le mercredi/vendredi du test D49 (congé couvrant les deux jours) : réutilise
 * `JOUR_Q5_CONGE` comme mercredi plutôt que de tirer une semaine neuve. Sans
 * écriture possible : ce congé est de toute façon refusé (Q5, un rendez-vous
 * de Guadeloupe le bloque) avant tout accès en base, donc rien n'entre en
 * conflit avec le rendez-vous que le premier test crée sur cette même date.
 * Le préserver évite de repousser `JOUR_SUPPRESSION` (le dernier de la liste
 * ci-dessus) au-delà de l'horizon de génération des présences
 * (`HORIZON_JOURS`, 62 jours, `src/server/queries/public/creneaux.ts`) —
 * constaté : une semaine de plus suffit à faire disparaître silencieusement
 * la présence attendue par ce test-là. Le repli ci-dessous (nouvelle semaine)
 * ne sert que si le vendredi obtenu tombe un jour férié, cas rarissime que
 * `JOUR_Q5_CONGE` seul (choisi comme mercredi ouvrable, pas comme vendredi)
 * ne garantit pas d'éviter.
 */
function prochainePaireMercrediVendrediOuvrable(mercrediPrefere: string): { mercredi: string; vendredi: string } {
  let mercredi = mercrediPrefere
  let vendredi = decalerJour(mercredi, 2)
  while (estJourFerie(vendredi)) {
    mercredi = prochainMercrediOuvrable()
    vendredi = decalerJour(mercredi, 2)
  }
  return { mercredi, vendredi }
}
const { mercredi: JOUR_Q5_HORS_PORTEE_MERCREDI, vendredi: JOUR_Q5_HORS_PORTEE_VENDREDI } =
  prochainePaireMercrediVendrediOuvrable(JOUR_Q5_CONGE)

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id

  ctxSecretaire = await compte(RoleName.SECRETAIRE, 'sec', [siteMG])
  ctxSecretaireGP = await compte(RoleName.SECRETAIRE, 'secgp', [siteGP])

  const p = await prisma.praticien.create({
    data: { nom: 'Indispo', prenom: 'Test', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Test indispo ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc', ordre: 9001 },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)
  await prisma.praticienMotif.create({ data: { praticienId, motifId, dureeMinutes: 30 } })

  fauteuilMG = (await prisma.fauteuil.findFirstOrThrow({ where: { siteId: siteMG } })).id

  // Semaine type (lot 1) pour que le praticien ait une présence à congédier,
  // et des créneaux publics à faire disparaître.
  await enregistrerJourSemaineType(ctxSecretaire, {
    praticienId,
    jourSemaine: 3,
    actif: true,
    siteId: siteMG,
    fauteuilId: fauteuilMG,
    heureDebut: '08:00',
    heureFin: '17:00',
  })

  const patient = await creerPatient(ctxSecretaire, { nom: 'Congé', prenom: 'Test', telephone: '0590000001' })
  patientId = patient.id
  cree.patients.push(patient.id)
})

afterAll(async () => {
  // Par identifiant, pas par `praticienId` : une fermeture de site n'en porte
  // aucun (`praticienId: null`), et un filtre sur `praticienId` la laisserait
  // en base — orpheline, mais bien réelle, puisqu'elle vise `siteMG`, une
  // fixture partagée avec d'autres fichiers de test.
  await prisma.indisponibilite.deleteMany({ where: { id: { in: cree.indisponibilites } } })
  await prisma.notification.deleteMany({ where: { rendezVous: { praticienId } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId } })
  await prisma.exceptionPresence.deleteMany({ where: { praticienId } })
  await prisma.presenceHebdomadaire.deleteMany({ where: { praticienId } })
  await prisma.plageDePresence.deleteMany({ where: { praticienId } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
})

describe('creerIndisponibilite — Q5 (jamais de rendez-vous orphelin)', () => {
  it('refuse un congé praticien qui recouvre un rendez-vous actif, sans rien écrire', async () => {
    const jour = JOUR_Q5_CONGE
    const rdv = await creerRendezVous(ctxSecretaire, {
      patientId,
      praticienId,
      motifId,
      siteId: siteMG,
      debut: instantCabinet(jour, '09:00')!,
      surbooking: false,
      horsHoraire: false,
    })

    const avant = await prisma.indisponibilite.count({ where: { praticienId } })

    let erreur: unknown
    try {
      await creerIndisponibilite(ctxSecretaire, {
        type: 'CONGE',
        praticienId,
        joursEntiers: true,
        dateDebut: jour,
        dateFin: jour,
      })
    } catch (e) {
      erreur = e
    }

    expect(erreur).toBeInstanceOf(IndisponibiliteBloqueeError)
    expect((erreur as IndisponibiliteBloqueeError).rendezVous.map((r) => r.id)).toContain(rdv.id)
    expect(await prisma.indisponibilite.count({ where: { praticienId } })).toBe(avant)
  })

  it('accepte un congé praticien sans rendez-vous concerné', async () => {
    const jour = JOUR_CONGE_ACCEPTE

    const creee = await creerIndisponibilite(ctxSecretaire, {
      type: 'CONGE',
      praticienId,
      joursEntiers: true,
      dateDebut: jour,
      dateFin: jour,
    })
    cree.indisponibilites.push(creee.id)

    const ligne = await prisma.indisponibilite.findUniqueOrThrow({ where: { id: creee.id } })
    expect(ligne.type).toBe('CONGE')
    expect(ligne.praticienId).toBe(praticienId)
    expect(ligne.siteId).toBeNull()
  })

  it('refuse une fermeture de site qui recouvre un rendez-vous actif, sans rien écrire', async () => {
    const jour = JOUR_Q5_FERMETURE
    const rdv = await creerRendezVous(ctxSecretaire, {
      patientId,
      praticienId,
      motifId,
      siteId: siteMG,
      debut: instantCabinet(jour, '10:00')!,
      surbooking: false,
      horsHoraire: false,
    })

    const avant = await prisma.indisponibilite.count({ where: { siteId: siteMG } })

    let erreur: unknown
    try {
      await creerIndisponibilite(ctxSecretaire, {
        type: 'FERMETURE',
        siteId: siteMG,
        joursEntiers: true,
        dateDebut: jour,
        dateFin: jour,
        motif: 'Travaux',
      })
    } catch (e) {
      erreur = e
    }

    expect(erreur).toBeInstanceOf(IndisponibiliteBloqueeError)
    expect((erreur as IndisponibiliteBloqueeError).rendezVous.map((r) => r.id)).toContain(rdv.id)
    expect(await prisma.indisponibilite.count({ where: { siteId: siteMG } })).toBe(avant)
  })
})

describe('garde de permission et de portée (D4, D5)', () => {
  it('refuse un compte sans presence:create', async () => {
    const sansDroit: AuthContext = { ...ctxSecretaire, permissions: new Set() }

    await expect(
      creerIndisponibilite(sansDroit, {
        type: 'FERMETURE',
        siteId: siteMG,
        joursEntiers: true,
        dateDebut: JOUR_Q5_CONGE,
        dateFin: JOUR_Q5_CONGE,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  it('refuse une fermeture de site hors du rattachement de l’appelant', async () => {
    await expect(
      creerIndisponibilite(ctxSecretaireGP, {
        type: 'FERMETURE',
        siteId: siteMG,
        joursEntiers: true,
        dateDebut: JOUR_Q5_CONGE,
        dateFin: JOUR_Q5_CONGE,
        motif: 'Cyclone',
      }),
    ).rejects.toBeInstanceOf(PorteeSiteError)
  })

  it('refuse un congé praticien dont aucun site accessible ne correspond', async () => {
    // Ce praticien n'a de présence et de rendez-vous qu'à Marie-Galante : la
    // secrétaire de Guadeloupe n'y a pas accès (D5), donc pas de quoi déclarer
    // son congé — « au moins un site », et elle n'en a aucun.
    await expect(
      creerIndisponibilite(ctxSecretaireGP, {
        type: 'CONGE',
        praticienId,
        joursEntiers: true,
        dateDebut: JOUR_Q5_CONGE,
        dateFin: JOUR_Q5_CONGE,
      }),
    ).rejects.toBeInstanceOf(PorteeSiteError)
  })
})

describe('D49 — le détail du blocage se restreint à la portée de l’appelant', () => {
  it('un congé qui chevauche un rendez-vous hors de la portée de l’appelant est refusé sans exposer ce patient', async () => {
    // Le praticien est déjà présent à Marie-Galante le mercredi (`beforeAll`).
    // On lui ajoute une présence à Guadeloupe le vendredi suivant, pour qu'un
    // congé couvrant les deux jours ait « au moins un » site accessible à
    // `ctxSecretaire` (Marie-Galante seule) — le vendredi à Guadeloupe, lui,
    // ne l'est pas.
    const mercredi = JOUR_Q5_HORS_PORTEE_MERCREDI
    const vendredi = JOUR_Q5_HORS_PORTEE_VENDREDI

    const fauteuilGP = (await prisma.fauteuil.findFirstOrThrow({ where: { siteId: siteGP } })).id

    await enregistrerJourSemaineType(ctxSecretaireGP, {
      praticienId,
      jourSemaine: 5,
      actif: true,
      siteId: siteGP,
      fauteuilId: fauteuilGP,
      heureDebut: '08:00',
      heureFin: '17:00',
    })

    const patientGP = await creerPatient(ctxSecretaireGP, {
      nom: 'Discretion',
      prenom: 'Secrete',
      telephone: '0590000099',
    })
    cree.patients.push(patientGP.id)

    const rdvGP = await creerRendezVous(ctxSecretaireGP, {
      patientId: patientGP.id,
      praticienId,
      motifId,
      siteId: siteGP,
      debut: instantCabinet(vendredi, '09:00')!,
      surbooking: false,
      horsHoraire: false,
    })

    const avant = await prisma.indisponibilite.count({ where: { praticienId } })

    let erreur: unknown
    try {
      await creerIndisponibilite(ctxSecretaire, {
        type: 'CONGE',
        praticienId,
        joursEntiers: true,
        dateDebut: mercredi,
        dateFin: vendredi,
      })
    } catch (e) {
      erreur = e
    }

    expect(erreur).toBeInstanceOf(IndisponibiliteBloqueeError)
    const bloquee = erreur as IndisponibiliteBloqueeError
    // Le blocage a bien vu le rendez-vous de Guadeloupe (sinon rien n'empêcherait
    // le congé) : c'est ce qui le refuse. Mais l'appelant, rattaché à
    // Marie-Galante seule, n'en reçoit ni l'identifiant ni le patient —
    // seulement un décompte (D5, D49).
    expect(bloquee.rendezVous.map((r) => r.id)).not.toContain(rdvGP.id)
    expect(bloquee.rendezVous.some((r) => r.patientNom === 'Discretion')).toBe(false)
    expect(bloquee.horsPortee).toBeGreaterThanOrEqual(1)
    expect(bloquee.message).not.toContain('Discretion')
    expect(bloquee.message).not.toContain('Secrete')
    expect(await prisma.indisponibilite.count({ where: { praticienId } })).toBe(avant)
  })
})

describe('portail public — créneaux absents pendant une indisponibilité', () => {
  it('absents pendant un congé du praticien', async () => {
    const jour = JOUR_PORTAIL_CONGE

    const avant = await creneauxDisponibles({
      motifId,
      praticienId,
      siteId: siteMG,
      debut: instantCabinet(jour, '00:00')!,
      fin: instantCabinet(decalerJour(jour, 1), '00:00')!,
    })
    expect(avant.length).toBeGreaterThan(0)

    const creee = await creerIndisponibilite(ctxSecretaire, {
      type: 'CONGE',
      praticienId,
      joursEntiers: true,
      dateDebut: jour,
      dateFin: jour,
    })
    cree.indisponibilites.push(creee.id)

    const pendant = await creneauxDisponibles({
      motifId,
      praticienId,
      siteId: siteMG,
      debut: instantCabinet(jour, '00:00')!,
      fin: instantCabinet(decalerJour(jour, 1), '00:00')!,
    })
    expect(pendant).toHaveLength(0)
  })

  it('absents pendant une fermeture du site', async () => {
    const jour = JOUR_PORTAIL_FERMETURE

    const avant = await creneauxDisponibles({
      motifId,
      praticienId,
      siteId: siteMG,
      debut: instantCabinet(jour, '00:00')!,
      fin: instantCabinet(decalerJour(jour, 1), '00:00')!,
    })
    expect(avant.length).toBeGreaterThan(0)

    const creee = await creerIndisponibilite(ctxSecretaire, {
      type: 'FERMETURE',
      siteId: siteMG,
      joursEntiers: true,
      dateDebut: jour,
      dateFin: jour,
      motif: 'Maintenance électrique',
    })
    cree.indisponibilites.push(creee.id)

    const pendant = await creneauxDisponibles({
      motifId,
      praticienId,
      siteId: siteMG,
      debut: instantCabinet(jour, '00:00')!,
      fin: instantCabinet(decalerJour(jour, 1), '00:00')!,
    })
    expect(pendant).toHaveLength(0)
  })
})

describe('supprimerIndisponibilite', () => {
  it('rouvre la disponibilité : aucune garde à rejouer, une suppression ne peut qu’ouvrir', async () => {
    const jour = JOUR_SUPPRESSION

    const creee = await creerIndisponibilite(ctxSecretaire, {
      type: 'CONGE',
      praticienId,
      joursEntiers: true,
      dateDebut: jour,
      dateFin: jour,
    })

    const pendant = await creneauxDisponibles({
      motifId,
      praticienId,
      siteId: siteMG,
      debut: instantCabinet(jour, '00:00')!,
      fin: instantCabinet(decalerJour(jour, 1), '00:00')!,
    })
    expect(pendant).toHaveLength(0)

    await supprimerIndisponibilite(ctxSecretaire, { id: creee.id })

    const apres = await creneauxDisponibles({
      motifId,
      praticienId,
      siteId: siteMG,
      debut: instantCabinet(jour, '00:00')!,
      fin: instantCabinet(decalerJour(jour, 1), '00:00')!,
    })
    expect(apres.length).toBeGreaterThan(0)

    expect(await prisma.indisponibilite.findUnique({ where: { id: creee.id } })).toBeNull()
  })
})
