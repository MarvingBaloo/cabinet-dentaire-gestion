import { RoleName, SiteCode } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { centimesDepuisSaisie, euros } from '@/lib/euros'
import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { bornesMois, decalerMois, moisDe, partDe } from '@/server/domaine/retrocession'
import { lireMaRetrocession, lireRetrocessionCabinet } from '@/server/queries/retrocession'
import { changerStatut, corrigerMontant } from '@/server/services/agenda'
import { DejaVerseError, marquerVerse, reglerPart, reglerPrix } from '@/server/services/retrocession'

// La rétrocession (D81) : le montant posé au passage en caisse, le relevé du mois (soins × part), qui voit quoi,
// et le versement figé. Juillet 2027, sur des praticiens, un fauteuil et un motif propres à ce fichier.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }
const MOIS = '2027-08'
const h = (jour: string, heure: string) => new Date(`2027-08-${jour}T${heure}:00Z`)

let siteMG: string
let ctxAdmin: AuthContext
let ctxCollab: AuthContext
let ctxSecretaire: AuthContext
let collab: string
let titulaire: string
let fauteuil: string
let motif: string
let patient: string

const cree = { praticiens: [] as string[], fauteuils: [] as string[], motifs: [] as string[], patients: [] as string[] }

async function compte(roles: RoleName[], cle: string) {
  const ids = await prisma.role.findMany({ where: { name: { in: roles } }, select: { id: true } })
  return prisma.user.create({
    data: {
      email: `retro-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: ids.map((r) => ({ roleId: r.id })) },
      sites: { create: [{ siteId: siteMG }] },
    },
    select: { id: true },
  })
}

async function contexte(id: string) {
  const ctx = await loadAuthContext(id, ORIGINE)
  if (!ctx) throw new Error('Contexte introuvable')
  return ctx
}

/** Un rendez-vous terminé, prêt à passer en caisse. */
async function soinTermine(praticienId: string, debut: Date) {
  const r = await prisma.rendezVous.create({
    data: {
      patientId: patient,
      praticienId,
      siteId: siteMG,
      fauteuilId: fauteuil,
      motifId: motif,
      debut,
      fin: new Date(debut.getTime() + 30 * 60_000),
      statut: 'TERMINE',
    },
    select: { id: true },
  })
  return r.id
}

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  fauteuil = (await prisma.fauteuil.create({ data: { siteId: siteMG, nom: `Fauteuil retro ${SUFFIXE}` } })).id
  cree.fauteuils.push(fauteuil)
  motif = (
    await prisma.motifConsultation.create({
      data: { libelle: `Retro ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc', ordre: 9000 },
    })
  ).id
  cree.motifs.push(motif)
  patient = (await prisma.patient.create({ data: { nom: `Retro${SUFFIXE}`, prenom: 'Ana', telephone: '+33600000001' } })).id
  cree.patients.push(patient)

  const [uAdmin, uCollab, uSec] = await Promise.all([
    compte([RoleName.PRATICIEN, RoleName.ADMIN], 'titulaire'),
    compte([RoleName.PRATICIEN], 'collab'),
    compte([RoleName.SECRETAIRE], 'sec'),
  ])
  titulaire = (await prisma.praticien.create({ data: { userId: uAdmin.id, nom: `Titulaire${SUFFIXE}`, prenom: 'T', couleur: '#111' } })).id
  collab = (await prisma.praticien.create({ data: { userId: uCollab.id, nom: `Collab${SUFFIXE}`, prenom: 'C', couleur: '#222' } })).id
  cree.praticiens.push(titulaire, collab)
  ;[ctxAdmin, ctxCollab, ctxSecretaire] = await Promise.all([contexte(uAdmin.id), contexte(uCollab.id), contexte(uSec.id)])
})

afterAll(async () => {
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
})

describe('le calcul, sans base', () => {
  it('les montants vivent en centimes', () => {
    expect(centimesDepuisSaisie('60')).toBe(6000)
    expect(centimesDepuisSaisie('62,50 €')).toBe(6250)
    expect(centimesDepuisSaisie('1 200')).toBe(120000)
    expect(centimesDepuisSaisie('abc')).toBeNull()
    expect(euros(480000)).toMatch(/^4\s800\s€$/)
    expect(euros(6250)).toMatch(/^62,50\s€$/)
  })

  it('la part arrondit au centime ; les mois se suivent, décembre compris', () => {
    expect(partDe(800000, 60)).toBe(480000)
    expect(partDe(3333, 50)).toBe(1667)
    expect(decalerMois('2026-12', 1)).toBe('2027-01')
    expect(decalerMois('2027-01', -1)).toBe('2026-12')
    // Minuit heure du cabinet (UTC-4) : le 1er août à 1 h UTC est encore le 31 juillet au cabinet.
    expect(moisDe(new Date('2027-08-01T01:00:00Z'))).toBe('2027-07')
    expect(bornesMois('2027-08').debut.toISOString()).toBe('2027-08-01T04:00:00.000Z')
  })
})

describe('le passage en caisse porte le montant', () => {
  it('le prix du soin, sinon le montant saisi ; en sortir l’efface ; il se corrige', async () => {
    await reglerPrix(ctxAdmin, { motifId: motif, prixCentimes: 6000 })
    const a = await soinTermine(collab, h('03', '13:00'))
    await changerStatut(ctxSecretaire, { id: a, statut: 'EN_CAISSE' })
    expect((await prisma.rendezVous.findUniqueOrThrow({ where: { id: a } })).montantCentimes).toBe(6000)

    const b = await soinTermine(collab, h('04', '13:00'))
    await changerStatut(ctxSecretaire, { id: b, statut: 'EN_CAISSE', montantCentimes: 52000 })
    expect((await prisma.rendezVous.findUniqueOrThrow({ where: { id: b } })).montantCentimes).toBe(52000)

    await changerStatut(ctxSecretaire, { id: b, statut: 'TERMINE' })
    const sorti = await prisma.rendezVous.findUniqueOrThrow({ where: { id: b } })
    expect(sorti.montantCentimes).toBeNull()
    expect(sorti.encaisseLe).toBeNull()

    await changerStatut(ctxSecretaire, { id: b, statut: 'EN_CAISSE' })
    await corrigerMontant(ctxSecretaire, { id: b, montantCentimes: 14000 })
    expect((await prisma.rendezVous.findUniqueOrThrow({ where: { id: b } })).montantCentimes).toBe(14000)
  })
})

describe('le relevé du mois', () => {
  it('soins passés en caisse × part ; le titulaire sans part n’a pas de ligne', async () => {
    await reglerPart(ctxAdmin, { praticienId: collab, part: 60 })
    // Les deux rendez-vous ci-dessus sont passés en caisse aujourd'hui : on les range en août 2027.
    await prisma.rendezVous.updateMany({ where: { praticienId: collab }, data: { encaisseLe: h('10', '15:00') } })
    const lignes = (await lireRetrocessionCabinet(ctxAdmin, MOIS)).filter((l) =>
      [collab, titulaire].includes(l.praticien.id),
    )
    expect(lignes.map((l) => l.praticien.id)).toEqual([collab])
    expect(lignes[0]!.totalCentimes).toBe(20000)
    expect(lignes[0]!.aVerserCentimes).toBe(12000)
    expect(lignes[0]!.soins).toHaveLength(2)
  })

  it('le collaborateur voit le sien ; ni lui ni la secrétaire ne lisent le relevé du cabinet', async () => {
    await expect(lireRetrocessionCabinet(ctxCollab, MOIS)).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(lireRetrocessionCabinet(ctxSecretaire, MOIS)).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(lireMaRetrocession(ctxSecretaire, MOIS)).rejects.toBeInstanceOf(PermissionDeniedError)
    const mien = await lireMaRetrocession(ctxCollab, MOIS, h('20', '12:00'))
    expect(mien?.part).toBe(60)
    expect(mien?.detail.totalCentimes).toBe(20000)
    expect(mien?.historique.find((m) => m.mois === MOIS)?.aVerserCentimes).toBe(12000)
  })

  it('« versé » fige le montant : un soin encaissé après coup ne le change pas, et on ne verse pas deux fois', async () => {
    await expect(marquerVerse(ctxCollab, { praticienId: collab, mois: MOIS })).rejects.toBeInstanceOf(PermissionDeniedError)
    const v = await marquerVerse(ctxAdmin, { praticienId: collab, mois: MOIS })
    expect(v.montantCentimes).toBe(12000)

    const c = await soinTermine(collab, h('05', '13:00'))
    await changerStatut(ctxSecretaire, { id: c, statut: 'EN_CAISSE' })
    await prisma.rendezVous.update({ where: { id: c }, data: { encaisseLe: h('11', '15:00') } })
    const ligne = (await lireRetrocessionCabinet(ctxAdmin, MOIS)).find((l) => l.praticien.id === collab)!
    expect(ligne.aVerserCentimes).toBe(15600)
    expect(ligne.versement?.montantCentimes).toBe(12000)
    await expect(marquerVerse(ctxAdmin, { praticienId: collab, mois: MOIS })).rejects.toBeInstanceOf(DejaVerseError)
  })

  it('régler une part ou un prix est réservé à l’administrateur', async () => {
    await expect(reglerPart(ctxCollab, { praticienId: collab, part: 90 })).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(reglerPrix(ctxSecretaire, { motifId: motif, prixCentimes: 1 })).rejects.toBeInstanceOf(PermissionDeniedError)
  })
})
