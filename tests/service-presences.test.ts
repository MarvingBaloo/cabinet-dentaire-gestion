import { RoleName, SiteCode } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { decalerJour, instantCabinet, jourLocal } from '@/lib/dates'
import { estJourFerie, joursFeriesEntre } from '@/lib/jours-feries'
import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { PorteeSiteError } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import { jourSemaineISO, joursDeLHorizon } from '@/server/domaine/presences'
import { HORIZON_JOURS, creneauxDisponibles } from '@/server/queries/public/creneaux'
import { creerPatient, creerRendezVous } from '@/server/services/agenda'
import {
  FauteuilHorsSiteError,
  FauteuilNonChoisiError,
  RendezVousOrphelinsError,
  choisirFauteuil,
  enregistrerException,
  enregistrerJourSemaineType,
  genererPlagesPourTousLesPraticiens,
  supprimerException,
} from '@/server/services/presences'

// Ce que ces tests éprouvent, et que domaine-presences.test.ts (sans base) ne
// peut pas montrer :
//   - la réconciliation tient une fois branchée sur la vraie base (création,
//     suppression, idempotence)
//   - la garde anti-orphelin (Q5) refuse ET n'écrit rien, sur les deux chemins
//     qui peuvent orpheliner un rendez-vous (RETRAIT, semaine type raccourcie)
//   - permission et portée (D4, D5) sont bien vérifiées, pas seulement
//     déclarées dans la matrice de rôles
//
// Les règles de calcul elles-mêmes sont couvertes sans base par
// domaine-presences.test.ts.

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

const cree: { praticiens: string[]; patients: string[]; motifs: string[] } = {
  praticiens: [],
  patients: [],
  motifs: [],
}

async function compte(role: RoleName, cle: string, sites: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `pres-${cle}-${SUFFIXE}@test.local`,
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

/**
 * Un mercredi (jourSemaine = 3), `n` semaines après aujourd'hui. Choisi loin
 * de la date d'exécution du test — jamais dans le passé, jamais sur la borne
 * exacte de l'horizon — sans jamais dépendre d'une date écrite en dur, qui se
 * serait périmée au premier lancement après cette session.
 */
// Le N-ième mercredi NON FÉRIÉ : un mercredi férié n'a pas de présence, et le
// test qui y pose un rendez-vous échouait les semaines où le 11 novembre tombait
// un mercredi (2026).
function prochainMercredi(dansNSemaines: number): string {
  let jour = jourLocal(new Date())
  while (jourSemaineISO(jour) !== 3) jour = decalerJour(jour, 1)
  for (let n = 0; n < dansNSemaines || estJourFerie(jour); ) {
    jour = decalerJour(jour, 7)
    if (!estJourFerie(jour)) n++
  }
  return jour
}

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id

  ctxSecretaire = await compte(RoleName.SECRETAIRE, 'sec', [siteMG])
  ctxSecretaireGP = await compte(RoleName.SECRETAIRE, 'secgp', [siteGP])

  const p = await prisma.praticien.create({
    data: { nom: 'Presences', prenom: 'Test', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Test presence ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc', ordre: 9000 },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)
  await prisma.praticienMotif.create({ data: { praticienId, motifId, dureeMinutes: 30 } })

  fauteuilMG = (await prisma.fauteuil.findFirstOrThrow({ where: { siteId: siteMG } })).id

  const patient = await creerPatient(ctxSecretaire, { nom: 'Orphelin', prenom: 'Test', telephone: '0590000000' })
  patientId = patient.id
  cree.patients.push(patient.id)
})

afterAll(async () => {
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

describe('semaine type → plages générées', () => {
  it('crée une plage chaque semaine sur l’horizon, aux bonnes heures (UTC-4)', async () => {
    const jour = prochainMercredi(1)
    const jourSemaine = jourSemaineISO(jour)

    const resultat = await enregistrerJourSemaineType(ctxSecretaire, {
      praticienId,
      jourSemaine,
      actif: true,
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      heureDebut: '08:00',
      heureFin: '17:00',
    })

    const debutHorizon = jourLocal(new Date())
    const finHorizon = decalerJour(debutHorizon, HORIZON_JOURS)
    // Fermé par défaut un jour férié (Q29, Q30, lot 2) : un mercredi qui tombe
    // un férié ne produit pas de plage tant qu'il n'a pas été ouvert — ce que
    // ce test ne fait pas. `enregistrerJourSemaineType` (le service qu'il
    // exerce) applique cette règle via `plagesVouluesAvecFeries`, donc les
    // fériés doivent être exclus ici aussi, sous peine de compter un jour que
    // le service, à raison, n'aura pas généré.
    const attendus = joursDeLHorizon(debutHorizon, finHorizon).filter(
      (j) => jourSemaineISO(j) === jourSemaine && !estJourFerie(j),
    )

    expect(resultat.creees).toBe(attendus.length)
    expect(resultat.supprimees).toBe(0)

    const plages = await prisma.plageDePresence.findMany({ where: { praticienId }, orderBy: { debut: 'asc' } })
    expect(plages).toHaveLength(attendus.length)

    // `jour` (dans deux semaines) n'est pas forcément la première occurrence
    // chronologique de l'horizon : on la retrouve par sa date exacte.
    const laNotre = plages.find((p) => p.debut.getTime() === instantCabinet(jour, '08:00')!.getTime())
    expect(laNotre).toBeDefined()
    // 08:00 heure du cabinet = 12:00 UTC, 17:00 = 21:00 UTC (D10, UTC-4 fixe).
    expect(laNotre!.fin.getTime()).toBe(instantCabinet(jour, '17:00')!.getTime())
    expect(laNotre!.debut.getUTCHours()).toBe(12)
    expect(laNotre!.fin.getUTCHours()).toBe(21)
  })

  it('est idempotent : rejouer sans rien changer ne crée ni ne supprime rien', async () => {
    const jourSemaine = jourSemaineISO(prochainMercredi(1))

    const resultat = await enregistrerJourSemaineType(ctxSecretaire, {
      praticienId,
      jourSemaine,
      actif: true,
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      heureDebut: '08:00',
      heureFin: '17:00',
    })

    expect(resultat.creees).toBe(0)
    expect(resultat.supprimees).toBe(0)
  })

  it('refuse un fauteuil fixe qui n’appartient pas au cabinet choisi', async () => {
    const fauteuilGP = (await prisma.fauteuil.findFirstOrThrow({ where: { siteId: siteGP } })).id

    await expect(
      choisirFauteuil(ctxSecretaire, { praticienId, siteId: siteMG, fauteuilId: fauteuilGP }),
    ).rejects.toBeInstanceOf(FauteuilHorsSiteError)
  })

  it('le fauteuil est fixe (27/10) : la semaine type reprend celui du praticien dans ce cabinet', async () => {
    const fixe = await prisma.fauteuilPraticien.findUniqueOrThrow({
      where: { praticienId_siteId: { praticienId, siteId: siteMG } },
    })
    expect(fixe.fauteuilId).toBe(fauteuilMG)
    const lignes = await prisma.presenceHebdomadaire.findMany({ where: { praticienId, siteId: siteMG } })
    expect(lignes.every((l) => l.fauteuilId === fauteuilMG)).toBe(true)
  })

  it('sans fauteuil fixe dans ce cabinet, la présence est refusée et rien n’est écrit', async () => {
    await expect(
      enregistrerJourSemaineType(ctxSecretaireGP, {
        praticienId,
        jourSemaine: 6,
        actif: true,
        siteId: siteGP,
        heureDebut: '08:00',
        heureFin: '12:00',
      }),
    ).rejects.toBeInstanceOf(FauteuilNonChoisiError)
    expect(await prisma.presenceHebdomadaire.count({ where: { praticienId, jourSemaine: 6 } })).toBe(0)
  })
})

describe('Q5 — jamais de rendez-vous orphelin', () => {
  it('refuse un RETRAIT sur un jour où un rendez-vous actif est posé, sans rien écrire', async () => {
    const jour = prochainMercredi(2)
    // La plage existe déjà : la semaine type couvre tous les mercredis.
    const rdv = await creerRendezVous(ctxSecretaire, {
      patientId,
      praticienId,
      motifId,
      siteId: siteMG,
      debut: instantCabinet(jour, '09:00')!,
      surbooking: false,
      horsHoraire: false,
    })

    const exceptionsAvant = await prisma.exceptionPresence.count({ where: { praticienId } })
    const plagesAvant = await prisma.plageDePresence.count({ where: { praticienId } })

    let erreur: unknown
    try {
      await enregistrerException(ctxSecretaire, { praticienId, date: jour, type: 'RETRAIT' })
    } catch (e) {
      erreur = e
    }

    expect(erreur).toBeInstanceOf(RendezVousOrphelinsError)
    expect((erreur as RendezVousOrphelinsError).rendezVous.map((r) => r.id)).toContain(rdv.id)

    // Rien n'est écrit en cas de refus : ni l'exception, ni les plages.
    expect(await prisma.exceptionPresence.count({ where: { praticienId } })).toBe(exceptionsAvant)
    expect(await prisma.plageDePresence.count({ where: { praticienId } })).toBe(plagesAvant)
  })

  it('un RETRAIT sans rendez-vous concerné supprime bien la plage', async () => {
    const jour = prochainMercredi(3)
    const avant = await prisma.plageDePresence.findFirst({
      where: { praticienId, debut: instantCabinet(jour, '08:00')! },
    })
    expect(avant).not.toBeNull()

    const resultat = await enregistrerException(ctxSecretaire, { praticienId, date: jour, type: 'RETRAIT' })
    expect(resultat.supprimees).toBe(1)

    const apres = await prisma.plageDePresence.findFirst({
      where: { praticienId, debut: instantCabinet(jour, '08:00')! },
    })
    expect(apres).toBeNull()
  })

  it('refuse de raccourcir la semaine type sous un rendez-vous déjà posé', async () => {
    const jour = prochainMercredi(4)
    await creerRendezVous(ctxSecretaire, {
      patientId,
      praticienId,
      motifId,
      siteId: siteMG,
      debut: instantCabinet(jour, '16:00')!,
      surbooking: false,
      horsHoraire: false,
    })

    await expect(
      enregistrerJourSemaineType(ctxSecretaire, {
        praticienId,
        jourSemaine: jourSemaineISO(jour),
        actif: true,
        siteId: siteMG,
        fauteuilId: fauteuilMG,
        heureDebut: '08:00',
        heureFin: '15:00',
      }),
    ).rejects.toBeInstanceOf(RendezVousOrphelinsError)

    // La ligne de semaine type n'a pas bougé : toujours 17:00, pas 15:00.
    const ligne = await prisma.presenceHebdomadaire.findUniqueOrThrow({
      where: { praticienId_jourSemaine: { praticienId, jourSemaine: jourSemaineISO(jour) } },
    })
    expect(ligne.heureFin).toBe(17 * 60)
  })
})

describe('exceptions : ajout, puis suppression', () => {
  it('un AJOUT_OU_MODIFICATION décale la plage, la supprimer la ramène à la semaine type', async () => {
    const jour = prochainMercredi(5)

    await enregistrerException(ctxSecretaire, {
      praticienId,
      date: jour,
      type: 'AJOUT_OU_MODIFICATION',
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      heureDebut: '10:00',
      heureFin: '11:00',
    })

    expect(
      await prisma.plageDePresence.findFirst({ where: { praticienId, debut: instantCabinet(jour, '10:00')! } }),
    ).not.toBeNull()
    expect(
      await prisma.plageDePresence.findFirst({ where: { praticienId, debut: instantCabinet(jour, '08:00')! } }),
    ).toBeNull()

    const exception = await prisma.exceptionPresence.findUniqueOrThrow({
      where: { praticienId_date: { praticienId, date: new Date(`${jour}T00:00:00.000Z`) } },
      select: { id: true },
    })
    await supprimerException(ctxSecretaire, { id: exception.id })

    expect(
      await prisma.plageDePresence.findFirst({ where: { praticienId, debut: instantCabinet(jour, '08:00')! } }),
    ).not.toBeNull()
    expect(
      await prisma.plageDePresence.findFirst({ where: { praticienId, debut: instantCabinet(jour, '10:00')! } }),
    ).toBeNull()
  })
})

describe('garde de permission et de portée', () => {
  it('refuse un compte sans presence:update', async () => {
    const sansDroit: AuthContext = { ...ctxSecretaire, permissions: new Set() }

    await expect(
      enregistrerJourSemaineType(sansDroit, {
        praticienId,
        jourSemaine: 2,
        actif: true,
        siteId: siteMG,
        fauteuilId: fauteuilMG,
        heureDebut: '08:00',
        heureFin: '17:00',
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  it('refuse un site hors du rattachement de l’appelant (D5)', async () => {
    await expect(
      enregistrerJourSemaineType(ctxSecretaireGP, {
        praticienId,
        jourSemaine: 4,
        actif: true,
        siteId: siteMG,
        fauteuilId: fauteuilMG,
        heureDebut: '08:00',
        heureFin: '17:00',
      }),
    ).rejects.toBeInstanceOf(PorteeSiteError)
  })
})

describe('glissement quotidien (worker)', () => {
  it('ne lève jamais d’orphelin et ne supprime rien pour un praticien déjà à jour', async () => {
    const avant = await prisma.plageDePresence.count({ where: { praticienId } })
    const resultat = await genererPlagesPourTousLesPraticiens(new Date())

    expect(resultat.conflits).toBe(0)
    expect(resultat.praticiens).toBeGreaterThanOrEqual(1)

    // Peut ajouter le jour qui vient d'entrer dans l'horizon si l'exécution
    // tombe juste après un changement de jour civil, mais ne doit jamais
    // supprimer une plage déjà correcte.
    const apres = await prisma.plageDePresence.count({ where: { praticienId } })
    expect(apres).toBeGreaterThanOrEqual(avant)
  })
})

/**
 * Le premier férié à venir dans l'horizon (Q3), jamais écrit en dur : le
 * fichier entier évite les dates figées (voir `prochainMercredi`) pour ne pas
 * se périmer au premier lancement après cette session. Une marge d'un jour à
 * chaque bout laisse la place de poser un rendez-vous le jour même sans
 * dépasser l'horizon que `creneauxDisponibles` applique lui aussi.
 */
function prochainFerieDansHorizon(): string {
  const debut = decalerJour(jourLocal(new Date()), 1)
  const fin = decalerJour(jourLocal(new Date()), HORIZON_JOURS - 1)
  const feries = joursFeriesEntre(debut, fin)
  if (feries.length === 0) {
    throw new Error('Aucun jour férié dans l’horizon de test : ajuster la fenêtre ou la période d’exécution.')
  }
  return feries[0]!.date
}

describe('jours fériés (Q29, Q30)', () => {
  const FERIE = prochainFerieDansHorizon()
  const jourSemaineFerie = jourSemaineISO(FERIE)

  it('fermé par défaut : aucun créneau public ce jour-là, même si la semaine type le couvrirait', async () => {
    await enregistrerJourSemaineType(ctxSecretaire, {
      praticienId,
      jourSemaine: jourSemaineFerie,
      actif: true,
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      heureDebut: '08:00',
      heureFin: '17:00',
    })

    expect(
      await prisma.plageDePresence.findFirst({ where: { praticienId, debut: instantCabinet(FERIE, '08:00')! } }),
    ).toBeNull()

    const creneaux = await creneauxDisponibles({
      motifId,
      praticienId,
      siteId: siteMG,
      debut: instantCabinet(FERIE, '00:00')!,
      fin: instantCabinet(decalerJour(FERIE, 1), '00:00')!,
    })
    expect(creneaux).toHaveLength(0)
  })

  it('« ouvrir ce jour » (AJOUT_OU_MODIFICATION) fait apparaître des créneaux publics, bornés à l’exception', async () => {
    await enregistrerException(ctxSecretaire, {
      praticienId,
      date: FERIE,
      type: 'AJOUT_OU_MODIFICATION',
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      heureDebut: '09:00',
      heureFin: '11:00',
    })

    const creneaux = await creneauxDisponibles({
      motifId,
      praticienId,
      siteId: siteMG,
      debut: instantCabinet(FERIE, '00:00')!,
      fin: instantCabinet(decalerJour(FERIE, 1), '00:00')!,
    })
    expect(creneaux.length).toBeGreaterThan(0)
    const debutOuverture = instantCabinet(FERIE, '09:00')!.getTime()
    const finOuverture = instantCabinet(FERIE, '11:00')!.getTime()
    for (const c of creneaux) {
      expect(c.debut.getTime()).toBeGreaterThanOrEqual(debutOuverture)
      expect(c.fin.getTime()).toBeLessThanOrEqual(finOuverture)
    }
  })

  it('l’ouverture d’un férié ne vaut que pour CE praticien — un confrère sans exception reste fermé', async () => {
    // Un second praticien, même jour de semaine que le férié, mais SANS
    // exception : `plagesVouluesAvecFeries` est appelée séparément pour
    // chacun (un praticien à la fois, `verifierEtReconcilier`), donc rien ne
    // devrait fuiter de l'un à l'autre — ce test le vérifie sur la vraie base,
    // pas seulement sur la fonction pure.
    const confrere = await prisma.praticien.create({
      data: { nom: 'Confrere', prenom: 'Test', couleur: '#0078cc' },
      select: { id: true },
    })
    // Un AUTRE fauteuil que `fauteuilMG` : si `jourSemaineFerie` coïncide avec
    // le mercredi déjà réservé par `praticienId` (semaine type des tests
    // précédents), les deux praticiens sur le MÊME fauteuil au même horaire
    // chevaucheraient sur les mercredis ordinaires de l'horizon — refusé par
    // `plage_fauteuil_sans_chevauchement`, une contrainte réelle mais sans
    // rapport avec ce que ce test démontre.
    const fauteuilConfrere = (
      await prisma.fauteuil.findFirstOrThrow({ where: { siteId: siteMG, id: { not: fauteuilMG } } })
    ).id
    try {
      await prisma.praticienMotif.create({
        data: { praticienId: confrere.id, motifId, dureeMinutes: 30 },
      })
      await enregistrerJourSemaineType(ctxSecretaire, {
        praticienId: confrere.id,
        jourSemaine: jourSemaineFerie,
        actif: true,
        siteId: siteMG,
        fauteuilId: fauteuilConfrere,
        heureDebut: '08:00',
        heureFin: '17:00',
      })

      expect(
        await prisma.plageDePresence.findFirst({
          where: { praticienId: confrere.id, debut: instantCabinet(FERIE, '08:00')! },
        }),
      ).toBeNull()

      // Le praticien du describe, lui, a une exception sur ce férié (test
      // précédent) : sa plage à lui existe toujours.
      expect(
        await prisma.plageDePresence.findFirst({
          where: { praticienId, debut: instantCabinet(FERIE, '09:00')! },
        }),
      ).not.toBeNull()
    } finally {
      await prisma.plageDePresence.deleteMany({ where: { praticienId: confrere.id } })
      await prisma.presenceHebdomadaire.deleteMany({ where: { praticienId: confrere.id } })
      await prisma.praticienMotif.deleteMany({ where: { praticienId: confrere.id } })
      await prisma.praticien.delete({ where: { id: confrere.id } })
    }
  })

  it('« refermer » (retirer l’exception) un férié où un rendez-vous est posé est refusé, avec la liste', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, {
      patientId,
      praticienId,
      motifId,
      siteId: siteMG,
      debut: instantCabinet(FERIE, '09:30')!,
      surbooking: false,
      horsHoraire: false,
    })

    const exception = await prisma.exceptionPresence.findUniqueOrThrow({
      where: { praticienId_date: { praticienId, date: new Date(`${FERIE}T00:00:00.000Z`) } },
      select: { id: true },
    })

    let erreur: unknown
    try {
      await supprimerException(ctxSecretaire, { id: exception.id })
    } catch (e) {
      erreur = e
    }

    expect(erreur).toBeInstanceOf(RendezVousOrphelinsError)
    expect((erreur as RendezVousOrphelinsError).rendezVous.map((r) => r.id)).toContain(rdv.id)

    // Rien n'est refermé : le rendez-vous reste couvert, toujours visible côté portail.
    const exceptionEncore = await prisma.exceptionPresence.findUnique({ where: { id: exception.id } })
    expect(exceptionEncore).not.toBeNull()
  })
})

describe('pause du midi dans la semaine type (18/10)', () => {
  it('deux plages ce jour-là, et aucun créneau public pendant la pause', async () => {
    // Un mercredi ordinaire de l'horizon, pas férié.
    let jour = decalerJour(jourLocal(new Date()), 7)
    while (jourSemaineISO(jour) !== 3 || estJourFerie(jour)) jour = decalerJour(jour, 1)

    await enregistrerJourSemaineType(ctxSecretaire, {
      praticienId,
      jourSemaine: 3,
      actif: true,
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      heureDebut: '08:00',
      heureFin: '17:00',
      pauseDebut: '12:00',
      pauseFin: '13:30',
    })

    const plages = await prisma.plageDePresence.findMany({
      where: { praticienId, debut: { gte: instantCabinet(jour, '00:00')!, lt: instantCabinet(decalerJour(jour, 1), '00:00')! } },
      orderBy: { debut: 'asc' },
    })
    expect(plages.map((p) => [p.debut, p.fin])).toEqual([
      [instantCabinet(jour, '08:00'), instantCabinet(jour, '12:00')],
      [instantCabinet(jour, '13:30'), instantCabinet(jour, '17:00')],
    ])

    const creneaux = await creneauxDisponibles({
      motifId,
      praticienId,
      siteId: siteMG,
      debut: instantCabinet(jour, '00:00')!,
      fin: instantCabinet(decalerJour(jour, 1), '00:00')!,
    })
    expect(creneaux.length).toBeGreaterThan(0)
    const pauseDebut = instantCabinet(jour, '12:00')!.getTime()
    const pauseFin = instantCabinet(jour, '13:30')!.getTime()
    for (const c of creneaux) {
      expect(c.fin.getTime() <= pauseDebut || c.debut.getTime() >= pauseFin).toBe(true)
    }
  })
})
