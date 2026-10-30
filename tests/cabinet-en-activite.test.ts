import { createHash, randomBytes } from 'node:crypto'

import { RoleName, SiteCode } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { PorteeSiteError } from '@/server/auth/portee'
import { listerCabinetsAccessibles } from '@/server/cabinet-choisi'
import { prisma } from '@/server/db/client'
import { listerRendezVous } from '@/server/queries/agenda'
import { listerSitesPublics } from '@/server/queries/public/catalogue'
import { creneauxDisponibles } from '@/server/queries/public/creneaux'
import { presencesPubliques } from '@/server/queries/public/presences'
import { siteDetailParSlug } from '@/server/queries/public/site'
import { lireActivite } from '@/server/queries/statistiques'
import { historiqueDuPatient, rendezVousDuPatient } from '@/server/services/acces-patient'
import { DernierCabinetError, changerActiviteCabinet, listerCabinetsReglage } from '@/server/services/cabinets'
import { inscrireListeAttente } from '@/server/services/inscription-liste-attente'
import { demarrerReservation } from '@/server/services/reservation-publique'

// Un cabinet retiré (D74) — la Guadeloupe, la première année : il n'existe plus pour personne. Ni pour
// l'administrateur dans l'espace du cabinet, ni pour le patient sur le site, ni pour un appel forgé à la main. Le
// réglage lui-même est le seul endroit où il apparaît encore.
//
// ⚠ La Guadeloupe est retirée de la base de test pendant ce fichier, et remise en activité à la fin quoi qu'il
// arrive : les autres batteries en ont besoin.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }
const TELEPHONE = '+590690990088'
// Dans dix jours, de 8 h à 12 h au cabinet : dans l'horizon de la réservation en ligne.
const jour = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
const a = (heure: string) => new Date(`${jour}T${heure}:00-04:00`)

let siteMG: string
let siteGP: string
let ctxAdmin: AuthContext
let ctxSecretaireGP: AuthContext
let praticienMG: string
let praticienGP: string
let motifId: string
let patientId: string
let jeton: string
const cree = { praticiens: [] as string[], fauteuils: [] as string[] }

async function compte(roles: RoleName[], cle: string, sites: string[]) {
  const ids = await prisma.role.findMany({ where: { name: { in: roles } }, select: { id: true } })
  const u = await prisma.user.create({
    data: {
      email: `activite-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: ids.map((r) => ({ roleId: r.id })) },
      sites: { create: sites.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  })
  return u.id
}
const contexte = async (userId: string) => (await loadAuthContext(userId, ORIGINE))!

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id
  await prisma.site.update({ where: { id: siteGP }, data: { actif: true } })

  motifId = (
    await prisma.motifConsultation.create({
      data: { libelle: `Activité ${SUFFIXE}`, dureeIndicative: 30, couleur: '#387a70', ordre: 9600 },
      select: { id: true },
    })
  ).id
  for (const [cle, siteId] of [['MG', siteMG], ['GP', siteGP]] as const) {
    const p = await prisma.praticien.create({ data: { nom: `Activite${cle}${SUFFIXE}`, prenom: 'Dr', couleur: '#387a70' } })
    cree.praticiens.push(p.id)
    await prisma.praticienMotif.create({ data: { praticienId: p.id, motifId, dureeMinutes: 30 } })
    const f = await prisma.fauteuil.create({ data: { siteId, nom: `Activité ${cle} ${SUFFIXE}` }, select: { id: true } })
    cree.fauteuils.push(f.id)
    await prisma.plageDePresence.create({
      data: { praticienId: p.id, siteId, fauteuilId: f.id, debut: a('08:00'), fin: a('12:00') },
    })
  }
  ;[praticienMG, praticienGP] = cree.praticiens as [string, string]

  patientId = (
    await prisma.patient.create({ data: { nom: `Activite${SUFFIXE}`, prenom: 'Marie', telephone: TELEPHONE } })
  ).id
  // Un rendez-vous dans chaque cabinet : à venir, et un passé en Guadeloupe.
  for (const [praticienId, siteId, fauteuilId, debut] of [
    [praticienMG, siteMG, cree.fauteuils[0]!, a('09:00')],
    [praticienGP, siteGP, cree.fauteuils[1]!, a('09:00')],
    [praticienGP, siteGP, cree.fauteuils[1]!, new Date(Date.now() - 20 * 86_400_000)],
  ] as const) {
    await prisma.rendezVous.create({
      data: { patientId, praticienId, siteId, fauteuilId, motifId, debut, fin: new Date(debut.getTime() + 30 * 60_000), statut: 'CONFIRME' },
    })
  }

  // L'espace « Mes rendez-vous » de Marie, ouvert comme après un code reçu par SMS.
  jeton = randomBytes(24).toString('base64url')
  await prisma.accesPatient.create({
    data: {
      telephone: TELEPHONE,
      codeHash: 'x',
      expiresAt: new Date(Date.now() + 600_000),
      jetonHash: createHash('sha256').update(jeton).digest('hex'),
      fenetreExpire: new Date(Date.now() + 600_000),
      ipAddress: '127.0.0.1',
    },
  })

  ctxAdmin = await contexte(await compte([RoleName.PRATICIEN, RoleName.ADMIN], 'admin', [siteMG]))
  ctxSecretaireGP = await contexte(await compte([RoleName.SECRETAIRE], 'secretaire', [siteMG, siteGP]))

  // L'administrateur retire la Guadeloupe.
  await changerActiviteCabinet(ctxAdmin, siteGP, false)
})

afterAll(async () => {
  await prisma.site.update({ where: { id: siteGP }, data: { actif: true } })
  await prisma.accesPatient.deleteMany({ where: { telephone: TELEPHONE } })
  await prisma.inscriptionListeAttente.deleteMany({ where: { telephone: TELEPHONE } })
  await prisma.reservationPublique.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.plageDePresence.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { id: patientId } })
  await prisma.motifConsultation.deleteMany({ where: { id: motifId } })
})

describe('Dans l’espace du cabinet, la Guadeloupe retirée n’existe plus pour personne', () => {
  it('l’administrateur ne la voit plus : ni dans sa portée, ni dans le choix du cabinet', async () => {
    const ctx = await contexte(ctxAdmin.userId)
    expect(ctx.sitesAutorises.has(siteGP)).toBe(false)
    expect(ctx.sitesAutorises.has(siteMG)).toBe(true)
    expect((await listerCabinetsAccessibles(ctx)).map((c) => c.id)).not.toContain(siteGP)
  })

  it('une secrétaire rattachée aux deux cabinets non plus, même en demandant l’agenda de la Guadeloupe', async () => {
    const ctx = await contexte(ctxSecretaireGP.userId)
    expect([...ctx.sitesAutorises]).toEqual([siteMG])
    const periode = { debut: a('00:00'), fin: a('23:59') }
    await expect(listerRendezVous(ctx, periode, { siteId: siteGP })).rejects.toBeInstanceOf(PorteeSiteError)
    const visibles = await listerRendezVous(ctx, periode)
    expect(visibles.some((r) => r.site.id === siteGP)).toBe(false)
    expect(visibles.some((r) => r.praticien.id === praticienMG)).toBe(true)
  })

  it('ses rendez-vous ne comptent plus dans les statistiques', async () => {
    const ctx = await contexte(ctxAdmin.userId)
    const { portee } = await lireActivite(ctx, { praticien: praticienGP })
    expect(portee.options.cabinets.map((c) => c.id)).toEqual([siteMG])
  })
})

describe('Sur le site public, rien ne la montre et rien ne s’y réserve', () => {
  it('ni dans la liste des cabinets, ni dans l’accès, ni sur sa page', async () => {
    expect((await listerSitesPublics()).map((s) => s.code)).toEqual([SiteCode.MARIE_GALANTE])
    const { cabinets, praticiens } = await presencesPubliques()
    expect(cabinets.map((c) => c.id)).toEqual([siteMG])
    expect(praticiens.find((p) => p.id === praticienGP)?.sites ?? []).toEqual([])
    expect(await siteDetailParSlug('guadeloupe')).toBeNull()
    expect(await siteDetailParSlug('marie-galante')).not.toBeNull()
  })

  it('aucun créneau en Guadeloupe, même demandé par son identifiant', async () => {
    const tous = await creneauxDisponibles({ motifId })
    expect(tous.some((c) => c.siteId === siteGP)).toBe(false)
    expect(tous.some((c) => c.siteId === siteMG)).toBe(true)
    expect(await creneauxDisponibles({ motifId, siteId: siteGP })).toEqual([])
  })

  it('une réservation forgée sur la Guadeloupe est refusée', async () => {
    const r = await demarrerReservation({
      motifId,
      praticienId: praticienGP,
      siteId: siteGP,
      debut: a('10:00'),
      nom: 'Forge',
      prenom: 'Jean',
      telephone: '+590690990089',
      ipAddress: `10.9.${SUFFIXE % 250}.1`,
    })
    expect(r.etat).toBe('creneau_indisponible')
  })

  it('pas d’inscription sur sa liste d’attente', async () => {
    const r = await inscrireListeAttente(jeton, { motifId, siteId: siteGP }, '127.0.0.1', new Date())
    expect(r.etat).toBe('motif_invalide')
  })

  it('« Mes rendez-vous » ne montre plus ceux de la Guadeloupe, à venir ou passés', async () => {
    const aVenir = await rendezVousDuPatient(jeton, new Date())
    expect(aVenir?.map((r) => r.site.nom)).toEqual([expect.stringContaining('Marie-Galante')])
    const passes = await historiqueDuPatient(jeton, new Date())
    expect(passes?.some((r) => r.site.nom.includes('Guadeloupe'))).toBe(false)
  })
})

describe('Le réglage', () => {
  it('l’écran « Cabinets » la montre encore, retirée, pour qu’on puisse la remettre', async () => {
    const cabinets = await listerCabinetsReglage(ctxAdmin)
    expect(cabinets.find((c) => c.id === siteGP)?.actif).toBe(false)
  })

  it('le retrait est noté au journal', async () => {
    const trace = await prisma.auditLog.findFirst({
      where: { actorId: ctxAdmin.userId, entityType: 'site', entityId: siteGP, action: 'UPDATE' },
    })
    expect(trace?.metadata).toEqual({ actif: false })
  })

  it('le dernier cabinet en activité ne se retire pas', async () => {
    await expect(changerActiviteCabinet(ctxAdmin, siteMG, false)).rejects.toBeInstanceOf(DernierCabinetError)
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteMG } })).actif).toBe(true)
  })

  it('la secrétaire ne peut pas y toucher', async () => {
    await expect(changerActiviteCabinet(ctxSecretaireGP, siteGP, true)).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(listerCabinetsReglage(ctxSecretaireGP)).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  it('remise en activité, la Guadeloupe revient avec ses rendez-vous', async () => {
    await changerActiviteCabinet(ctxAdmin, siteGP, true)
    const ctx = await contexte(ctxSecretaireGP.userId)
    const visibles = await listerRendezVous(ctx, { debut: a('00:00'), fin: a('23:59') }, { siteId: siteGP })
    expect(visibles.map((r) => r.praticien.id)).toEqual([praticienGP])
    expect((await listerSitesPublics()).map((s) => s.code)).toContain(SiteCode.GUADELOUPE)
  })
})
