import { RoleName, SiteCode, StatutRendezVous } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bornesDuJour, joursSemaineAffiches } from '@/lib/dates'
import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PorteeConsolideeError } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import {
  compterRendezVousParJour,
  listerRendezVous,
  listerRendezVousConsolide,
  listerRendezVousPraticien,
} from '@/server/queries/agenda'
import { type ParametresAgenda, parseParametresAgenda } from '@/server/validation/agenda'

// Lot 4 — vues de l'agenda. Ce que ces tests cherchent à prouver :
//   - la semaine renvoie bien une fenêtre multi-jours, cantonnée au site
//     demandé (D5), et pas un jour de plus que ce qu'elle affiche
//   - le mois compte juste, et exclut ANNULE ET ABSENT (choix documenté dans
//     `compterRendezVousParJour`)
//   - l'agenda d'un praticien reste filtré par la portée de l'appelant, même
//     quand le praticien travaille aussi sur un site hors de cette portée
//   - la vue consolidée est refusée à un compte mono-site, jamais silencieuse
//   - le parseur de l'URL ne lève jamais : un paramètre invalide retombe sur
//     sa valeur par défaut

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let siteMG: string
let siteGP: string
let ctxSecretaireMG: AuthContext
let ctxAdmin: AuthContext
let praticienId: string
let motifId: string

const cree: { rdv: string[]; praticiens: string[]; patients: string[] } = {
  rdv: [],
  praticiens: [],
  patients: [],
}

async function creerCompte(role: RoleName, cle: string, sites: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `vues-agenda-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: { roleId: r.id } },
      sites: { create: sites.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  })
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error(`Contexte introuvable pour ${cle}`)
  return ctx
}

async function creerRendezVous(
  siteId: string,
  debut: Date,
  statut: StatutRendezVous = StatutRendezVous.CONFIRME,
) {
  const fauteuil = await prisma.fauteuil.findFirstOrThrow({ where: { siteId } })
  const patient = await prisma.patient.create({
    data: { nom: 'Patient', prenom: `T${cree.patients.length}`, telephone: '0590000000' },
    select: { id: true },
  })
  cree.patients.push(patient.id)

  const rdv = await prisma.rendezVous.create({
    data: {
      patientId: patient.id,
      praticienId,
      siteId,
      fauteuilId: fauteuil.id,
      motifId,
      debut,
      fin: new Date(debut.getTime() + 30 * 60_000),
      statut,
    },
    select: { id: true },
  })
  cree.rdv.push(rdv.id)
  return rdv.id
}

// Semaine lointaine et dédiée : ne croise aucune fixture d'un autre fichier de
// test. Lundi 3 mai 2027.
const LUNDI = '2027-05-03'
const JOURS_SEMAINE = joursSemaineAffiches(LUNDI) // lundi → samedi

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id

  ctxSecretaireMG = await creerCompte(RoleName.SECRETAIRE, 'secmg', [siteMG])
  ctxAdmin = await creerCompte(RoleName.ADMIN, 'admin', [siteMG])

  motifId = (await prisma.motifConsultation.findFirstOrThrow({ where: { actif: true } })).id
  const p = await prisma.praticien.create({
    data: { nom: 'Praticien', prenom: 'Semaine', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)
  await prisma.praticienMotif.create({ data: { praticienId, motifId, dureeMinutes: 30 } })
})

afterAll(async () => {
  await prisma.rendezVous.deleteMany({ where: { id: { in: cree.rdv } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
})

describe('vue semaine', () => {
  it('renvoie les rendez-vous des jours affichés, du site demandé seulement', async () => {
    const lundiMG = await creerRendezVous(siteMG, new Date(`${JOURS_SEMAINE[0]}T13:00:00Z`))
    const samediMG = await creerRendezVous(siteMG, new Date(`${JOURS_SEMAINE.at(-1)}T13:00:00Z`))
    // Même praticien, même jour, mais un autre créneau : la contrainte
    // d'exclusion en base interdit à un même praticien deux rendez-vous qui se
    // chevauchent, quel qu'en soit le site (il ne peut être qu'à un endroit à
    // la fois) — ici on ne teste que le filtrage par site, pas l'alternance.
    const lundiGP = await creerRendezVous(siteGP, new Date(`${JOURS_SEMAINE[0]}T15:00:00Z`))
    // Dimanche suivant, hors de la fenêtre lundi→samedi affichée par défaut.
    const dimancheSuivant = new Date(`${JOURS_SEMAINE.at(-1)}T13:00:00Z`)
    dimancheSuivant.setUTCDate(dimancheSuivant.getUTCDate() + 1)
    const dimancheMG = await creerRendezVous(siteMG, dimancheSuivant)

    const periode = {
      debut: bornesDuJour(JOURS_SEMAINE[0]!).debut,
      fin: bornesDuJour(JOURS_SEMAINE.at(-1)!).fin,
    }

    const rdv = await listerRendezVous(ctxSecretaireMG, periode, { siteId: siteMG })
    const ids = rdv.map((r) => r.id)

    expect(ids).toContain(lundiMG)
    expect(ids).toContain(samediMG)
    expect(ids).not.toContain(lundiGP) // autre site
    expect(ids).not.toContain(dimancheMG) // hors fenêtre lundi→samedi
  })
})

describe('vue mois — comptes par jour', () => {
  it('compte juste, et exclut ANNULE ET ABSENT', async () => {
    const jourA = '2027-05-10'
    const jourB = '2027-05-11'

    await creerRendezVous(siteMG, new Date(`${jourA}T13:00:00Z`), StatutRendezVous.CONFIRME)
    await creerRendezVous(siteMG, new Date(`${jourA}T15:00:00Z`), StatutRendezVous.A_CONFIRMER)
    await creerRendezVous(siteMG, new Date(`${jourA}T17:00:00Z`), StatutRendezVous.ANNULE)
    await creerRendezVous(siteMG, new Date(`${jourB}T13:00:00Z`), StatutRendezVous.ABSENT)
    await creerRendezVous(siteMG, new Date(`${jourB}T15:00:00Z`), StatutRendezVous.TERMINE)

    const periode = { debut: new Date('2027-05-01T04:00:00Z'), fin: new Date('2027-06-01T04:00:00Z') }
    const comptes = await compterRendezVousParJour(ctxAdmin, periode, { siteId: siteMG })

    expect(comptes.get(jourA)).toBe(2) // CONFIRME + A_CONFIRMER, pas ANNULE
    expect(comptes.get(jourB)).toBe(1) // TERMINE, pas ABSENT
  })
})

describe('vue par praticien', () => {
  it('reste cantonnée à la portée de l’appelant, même pour UN SEUL praticien', async () => {
    // Deux jours distincts : le cabinet n'autorise jamais un praticien sur les
    // deux sites le même jour (horaires de bateau), et la contrainte
    // d'exclusion en base refuserait de toute façon deux créneaux qui se
    // chevauchent pour un même praticien.
    const surMG = await creerRendezVous(siteMG, new Date('2027-05-17T13:00:00Z'))
    const surGP = await creerRendezVous(siteGP, new Date('2027-05-19T13:00:00Z'))

    const periode = { debut: new Date('2027-05-17T00:00:00Z'), fin: new Date('2027-05-20T00:00:00Z') }

    const vuMonoSite = (await listerRendezVousPraticien(ctxSecretaireMG, praticienId, periode)).map(
      (r) => r.id,
    )
    expect(vuMonoSite).toContain(surMG)
    expect(vuMonoSite).not.toContain(surGP)

    const vuAdmin = (await listerRendezVousPraticien(ctxAdmin, praticienId, periode)).map((r) => r.id)
    expect(vuAdmin).toContain(surMG)
    expect(vuAdmin).toContain(surGP)
  })
})

describe('vue consolidée', () => {
  it('est refusée à un compte qui ne voit qu’un site', async () => {
    const periode = { debut: new Date('2027-05-17T00:00:00Z'), fin: new Date('2027-05-18T00:00:00Z') }
    await expect(listerRendezVousConsolide(ctxSecretaireMG, periode)).rejects.toThrow(
      PorteeConsolideeError,
    )
  })

  it('est accordée à un compte à portée globale, et renvoie les deux sites', async () => {
    const surMG = await creerRendezVous(siteMG, new Date('2027-05-18T13:00:00Z'))
    // Décalé de deux heures : même praticien, même jour, la contrainte
    // d'exclusion en base n'accepterait pas deux créneaux qui se chevauchent.
    const surGP = await creerRendezVous(siteGP, new Date('2027-05-18T15:00:00Z'))

    const periode = { debut: new Date('2027-05-18T00:00:00Z'), fin: new Date('2027-05-19T00:00:00Z') }
    const rdv = await listerRendezVousConsolide(ctxAdmin, periode)
    const ids = rdv.map((r) => r.id)

    expect(ids).toContain(surMG)
    expect(ids).toContain(surGP)
    expect(new Set(rdv.map((r) => r.site.id))).toEqual(new Set([siteMG, siteGP]))
  })
})

describe('filtres d’affichage (D58) — jamais au-delà de la portée', () => {
  const periode = { debut: new Date('2027-05-24T00:00:00Z'), fin: new Date('2027-05-27T00:00:00Z') }
  let surMG: string
  let surGP: string
  const autreUuid = '00000000-0000-4000-8000-000000000001'

  beforeAll(async () => {
    surMG = await creerRendezVous(siteMG, new Date('2027-05-24T13:00:00Z'), StatutRendezVous.CONFIRME)
    surGP = await creerRendezVous(siteGP, new Date('2027-05-26T13:00:00Z'), StatutRendezVous.CONFIRME)
  })

  const combinaisons = [
    {},
    { praticiensExclus: [autreUuid] },
    { motifsExclus: [autreUuid] },
    { statutsExclus: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT] },
    { praticiensExclus: [autreUuid], motifsExclus: [autreUuid], statutsExclus: [StatutRendezVous.ANNULE] },
  ]

  it('un compte mono-site ne voit jamais un rendez-vous hors de son site, quel que soit le filtre', async () => {
    for (const filtres of combinaisons) {
      const rdv = await listerRendezVous(ctxSecretaireMG, periode, { filtres })
      const ids = rdv.map((r) => r.id)
      expect(ids).toContain(surMG)
      expect(ids).not.toContain(surGP)
      expect(rdv.every((r) => r.site.id === siteMG)).toBe(true)

      const parPraticien = await listerRendezVousPraticien(ctxSecretaireMG, praticienId, periode, filtres)
      expect(parPraticien.map((r) => r.id)).not.toContain(surGP)
    }
  })

  it('demander l’autre site avec des filtres reste refusé', async () => {
    await expect(
      listerRendezVous(ctxSecretaireMG, periode, {
        siteId: siteGP,
        filtres: { statutsExclus: [StatutRendezVous.ANNULE] },
      }),
    ).rejects.toThrow()
  })

  it('la vue consolidée reste refusée à un compte mono-site, filtres ou non', async () => {
    await expect(
      listerRendezVousConsolide(ctxSecretaireMG, periode, { praticiensExclus: [autreUuid] }),
    ).rejects.toThrow(PorteeConsolideeError)
  })

  it('les exclusions masquent bien les rendez-vous visés', async () => {
    const sansPraticien = await listerRendezVous(ctxSecretaireMG, periode, {
      filtres: { praticiensExclus: [praticienId] },
    })
    expect(sansPraticien.map((r) => r.id)).not.toContain(surMG)

    const sansMotif = await listerRendezVous(ctxSecretaireMG, periode, { filtres: { motifsExclus: [motifId] } })
    expect(sansMotif.map((r) => r.id)).not.toContain(surMG)

    const sansStatut = await listerRendezVous(ctxSecretaireMG, periode, {
      filtres: { statutsExclus: [StatutRendezVous.CONFIRME] },
    })
    expect(sansStatut.map((r) => r.id)).not.toContain(surMG)

    const consolide = await listerRendezVousConsolide(ctxAdmin, periode, { praticiensExclus: [praticienId] })
    expect(consolide.map((r) => r.id)).not.toContain(surGP)
  })
})

describe('parseParametresAgenda — listes d’exclusions', () => {
  const a = '11111111-1111-4111-8111-111111111111'
  const b = '22222222-2222-4222-8222-222222222222'

  it('accepte une chaîne ou un tableau, sans doublon', () => {
    expect(parseParametresAgenda({ sansPraticien: a }, '2027-01-15').praticiensExclus).toEqual([a])
    expect(parseParametresAgenda({ sansMotif: [a, b, a] }, '2027-01-15').motifsExclus).toEqual([a, b])
  })

  it('ignore les valeurs invalides au lieu de lever', () => {
    const p = parseParametresAgenda(
      { sansPraticien: ['pas-un-uuid', a], sansStatut: ['INCONNU', 'ANNULE'] },
      '2027-01-15',
    )
    expect(p.praticiensExclus).toEqual([a])
    expect(p.statutsExclus).toEqual(['ANNULE'])
  })

  it('borne le nombre de valeurs lues', () => {
    const beaucoup = Array.from({ length: 80 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(parseParametresAgenda({ sansMotif: beaucoup }, '2027-01-15').motifsExclus).toHaveLength(50)
  })
})

describe('parseParametresAgenda — jamais d’erreur 500 sur un paramètre invalide', () => {
  const aujourdHui = '2027-01-15'
  const defauts: ParametresAgenda = {
    vue: 'jour',
    date: aujourdHui,
    siteId: null,
    tousLesSites: false,
    praticienId: null,
    praticiensExclus: [],
    motifsExclus: [],
    statutsExclus: [],
    tousPraticiens: false,
  }

  it('aucun paramètre : tous les défauts', () => {
    expect(parseParametresAgenda({}, aujourdHui)).toEqual(defauts)
  })

  it('une vue inconnue retombe sur "jour"', () => {
    expect(parseParametresAgenda({ vue: 'annee' }, aujourdHui).vue).toBe('jour')
  })

  it('une date malformée retombe sur aujourd’hui', () => {
    expect(parseParametresAgenda({ date: '15/01/2027' }, aujourdHui).date).toBe(aujourdHui)
  })

  it('une date calendairement inexistante retombe aussi', () => {
    expect(parseParametresAgenda({ date: '2027-02-30' }, aujourdHui).date).toBe(aujourdHui)
  })

  it('un site "tous" active la vue consolidée sans fixer de siteId', () => {
    const p = parseParametresAgenda({ site: 'tous' }, aujourdHui)
    expect(p.tousLesSites).toBe(true)
    expect(p.siteId).toBeNull()
  })

  it('un site qui n’est pas un UUID retombe à null', () => {
    expect(parseParametresAgenda({ site: 'n-importe-quoi' }, aujourdHui).siteId).toBeNull()
  })

  it('un praticien qui n’est pas un UUID retombe à null', () => {
    expect(parseParametresAgenda({ praticien: 'xyz' }, aujourdHui).praticienId).toBeNull()
  })

  it('le paramètre historique `jour` sert de secours quand `date` est absent', () => {
    expect(parseParametresAgenda({ jour: '2027-03-01' }, aujourdHui).date).toBe('2027-03-01')
  })

  it('`date` l’emporte sur `jour` quand les deux sont présents', () => {
    expect(parseParametresAgenda({ date: '2027-04-01', jour: '2027-03-01' }, aujourdHui).date).toBe(
      '2027-04-01',
    )
  })
})
