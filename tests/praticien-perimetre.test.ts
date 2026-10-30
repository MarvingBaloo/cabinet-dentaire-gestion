import { RoleName, SiteCode } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { lireFicheRendezVous, listerRendezVous } from '@/server/queries/agenda'
import { lireFichePatient, rechercherPatients } from '@/server/queries/patients'
import { deplacerRendezVous } from '@/server/services/agenda'

// Ce que voit un praticien (Marving, 27/10) : ses rendez-vous, ses patients, rien de son confrère. L'administrateur
// et la secrétaire voient tout le cabinet. Et « Modifier » dans la fiche : l'acte, le praticien et la note changent
// avec l'heure, sous les règles de la prise.
//
// La journée se joue en juillet 2027, sur des fauteuils et des praticiens propres à ce fichier.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }
const h = (heure: string) => new Date(`2027-07-13T${heure}:00Z`)

let siteMG: string
let ctxA: AuthContext
let ctxAdmin: AuthContext
let ctxSecretaire: AuthContext
let praticienA: string
let praticienB: string
let fauteuilA: string
let fauteuilB: string
let motifCourt: string
let motifLong: string
let patientA: string
let patientB: string
let rdvA: string
let rdvB: string

const cree = { praticiens: [] as string[], patients: [] as string[], fauteuils: [] as string[], motifs: [] as string[] }

async function compte(roles: RoleName[], cle: string) {
  const ids = await prisma.role.findMany({ where: { name: { in: roles } }, select: { id: true } })
  return prisma.user.create({
    data: {
      email: `perim-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: ids.map((r) => ({ roleId: r.id })) },
      sites: { create: [{ siteId: siteMG }] },
    },
    select: { id: true },
  })
}

async function contexte(userId: string) {
  const ctx = await loadAuthContext(userId, ORIGINE)
  if (!ctx) throw new Error('Contexte introuvable')
  return ctx
}

async function praticien(userId: string, nom: string, fauteuilId: string) {
  const p = await prisma.praticien.create({ data: { userId, nom, prenom: 'Test', couleur: '#0078cc' }, select: { id: true } })
  cree.praticiens.push(p.id)
  await prisma.plageDePresence.create({
    data: { praticienId: p.id, siteId: siteMG, fauteuilId, debut: h('12:00'), fin: h('22:00') },
  })
  await prisma.praticienMotif.createMany({
    data: [
      { praticienId: p.id, motifId: motifCourt, dureeMinutes: 30 },
      { praticienId: p.id, motifId: motifLong, dureeMinutes: 60 },
    ],
  })
  return p.id
}

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  for (const cle of ['A', 'B']) {
    const f = await prisma.fauteuil.create({ data: { siteId: siteMG, nom: `Fauteuil perim ${cle} ${SUFFIXE}` } })
    cree.fauteuils.push(f.id)
  }
  ;[fauteuilA, fauteuilB] = cree.fauteuils as [string, string]
  for (const [libelle, duree] of [['court', 30], ['long', 60]] as const) {
    const m = await prisma.motifConsultation.create({
      data: { libelle: `Perim ${libelle} ${SUFFIXE}`, dureeIndicative: duree, couleur: '#0078cc', ordre: 9000 },
    })
    cree.motifs.push(m.id)
  }
  ;[motifCourt, motifLong] = cree.motifs as [string, string]

  const userA = await compte([RoleName.PRATICIEN], 'a')
  const userB = await compte([RoleName.PRATICIEN], 'b')
  const userAdmin = await compte([RoleName.PRATICIEN, RoleName.ADMIN], 'admin')
  const userSecretaire = await compte([RoleName.SECRETAIRE], 'sec')
  praticienA = await praticien(userA.id, `PerimA${SUFFIXE}`, fauteuilA)
  praticienB = await praticien(userB.id, `PerimB${SUFFIXE}`, fauteuilB)
  ;[ctxA, ctxAdmin, ctxSecretaire] = await Promise.all([
    contexte(userA.id),
    contexte(userAdmin.id),
    contexte(userSecretaire.id),
  ])

  for (const cle of ['Alice', 'Bruno']) {
    const p = await prisma.patient.create({
      data: { nom: `Perim${SUFFIXE}`, prenom: cle, telephone: `+33600${String(SUFFIXE).slice(-6)}` },
      select: { id: true },
    })
    cree.patients.push(p.id)
  }
  ;[patientA, patientB] = cree.patients as [string, string]

  const rdv = async (patientId: string, praticienId: string, fauteuilId: string) =>
    (
      await prisma.rendezVous.create({
        data: { patientId, praticienId, siteId: siteMG, fauteuilId, motifId: motifCourt, debut: h('14:00'), fin: h('14:30') },
        select: { id: true },
      })
    ).id
  rdvA = await rdv(patientA, praticienA, fauteuilA)
  rdvB = await rdv(patientB, praticienB, fauteuilB)
})

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { rendezVous: { praticienId: { in: cree.praticiens } } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.plageDePresence.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  // Les comptes restent : le journal d'audit les référence et ne se modifie pas.
})

const journee = { debut: h('04:00'), fin: new Date(`2027-07-14T04:00:00Z`) }

describe('le praticien ne voit que ce qui le concerne', () => {
  it('ses rendez-vous, pas ceux de son confrère ; l’administrateur et la secrétaire voient les deux', async () => {
    const ids = async (ctx: AuthContext) => (await listerRendezVous(ctx, journee, { siteId: siteMG })).map((r) => r.id)
    expect(await ids(ctxA)).toContain(rdvA)
    expect(await ids(ctxA)).not.toContain(rdvB)
    for (const ctx of [ctxAdmin, ctxSecretaire]) expect(await ids(ctx)).toEqual(expect.arrayContaining([rdvA, rdvB]))
  })

  it('la fiche du rendez-vous d’un confrère lui est introuvable', async () => {
    expect(await lireFicheRendezVous(ctxA, rdvA)).not.toBeNull()
    expect(await lireFicheRendezVous(ctxA, rdvB)).toBeNull()
  })

  it('ses patients seulement, à la recherche comme à la fiche', async () => {
    const trouves = async (ctx: AuthContext) => (await rechercherPatients(ctx, `Perim${SUFFIXE}`)).map((p) => p.id)
    expect(await trouves(ctxA)).toEqual([patientA])
    expect(await trouves(ctxAdmin)).toEqual(expect.arrayContaining([patientA, patientB]))
    expect(await lireFichePatient(ctxA, patientB)).toBeNull()
    const fiche = await lireFichePatient(ctxA, patientA)
    expect(fiche?.rendezVous.map((r) => r.id)).toEqual([rdvA])
  })
})

describe('« Modifier » un rendez-vous (27/10)', () => {
  it('change l’acte, l’heure et la note : la durée suit l’acte', async () => {
    await deplacerRendezVous(ctxSecretaire, { id: rdvA, debut: h('15:00'), motifId: motifLong, note: 'Apporter la radio' })
    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdvA } })
    expect(rdv.motifId).toBe(motifLong)
    expect(rdv.debut).toEqual(h('15:00'))
    expect(rdv.fin).toEqual(h('16:00'))
    expect(rdv.note).toBe('Apporter la radio')
  })

  it('passe le rendez-vous à un confrère, sur le fauteuil de ce confrère', async () => {
    await deplacerRendezVous(ctxSecretaire, { id: rdvA, debut: h('18:00'), praticienId: praticienB })
    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdvA } })
    expect(rdv.praticienId).toBe(praticienB)
    expect(rdv.fauteuilId).toBe(fauteuilB)
    expect(rdv.note).toBe('Apporter la radio')
  })

  it('un praticien ne passe pas un rendez-vous à son confrère', async () => {
    await expect(
      deplacerRendezVous(ctxA, { id: rdvB, debut: h('19:00'), praticienId: praticienA }),
    ).rejects.toThrow()
    const nouveau = await prisma.rendezVous.create({
      data: {
        patientId: patientA,
        praticienId: praticienA,
        siteId: siteMG,
        fauteuilId: fauteuilA,
        motifId: motifCourt,
        debut: h('20:00'),
        fin: h('20:30'),
      },
      select: { id: true },
    })
    await expect(
      deplacerRendezVous(ctxA, { id: nouveau.id, debut: h('20:00'), praticienId: praticienB }),
    ).rejects.toBeInstanceOf(PermissionDeniedError)
  })
})
