import { RoleName, SiteCode } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PorteeSiteError, filtreSite, peutVoirSite } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import {
  dureePour,
  lireRendezVous,
  listerFauteuils,
  listerMotifs,
  listerPraticiens,
  listerPresences,
  listerRendezVous,
} from '@/server/queries/agenda'

// Ce que ces tests cherchent à prouver, et qui n'a rien d'évident :
//   - le cloisonnement par site tient DANS la requête, pas après coup (D5)
//   - un rattachement vide ne vaut pas « tout voir » — c'est le sens qu'aurait
//     un `in []` mal interprété, et c'est la faille la plus probable ici
//   - passer un siteId hors portée ne contourne pas le filtre
//   - la portée globale d'ADMIN affranchit vraiment
//
// D5 a été RETOURNÉE le 2026-09-10 : le dépôt affirmait auparavant l'inverse.
// Ces tests sont le filet qui empêche un retour en arrière silencieux.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let siteMG: string
let siteGP: string
let ctxSecretaireMG: AuthContext
let ctxSecretaireGP: AuthContext
let ctxAdmin: AuthContext
let ctxSansSite: AuthContext

let praticienMG: string
let praticienGP: string
let motifId: string
let rdvMG: string
let rdvGP: string

const cree: { rdv: string[]; plages: string[]; praticiens: string[]; patients: string[] } = {
  rdv: [],
  plages: [],
  praticiens: [],
  patients: [],
}

/** Fixtures montées sans passer par la DAL : elles ne doivent pas dépendre du
 *  code qu'elles servent à éprouver. */
async function creerCompte(role: RoleName, cle: string, sites: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `agenda-${cle}-${SUFFIXE}@test.local`,
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

async function creerPraticien(cle: string) {
  const p = await prisma.praticien.create({
    data: { nom: 'Praticien', prenom: cle, couleur: '#0078cc' },
    select: { id: true },
  })
  cree.praticiens.push(p.id)
  return p.id
}

async function creerRendezVous(siteId: string, praticienId: string, debut: Date) {
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
    },
    select: { id: true },
  })
  cree.rdv.push(rdv.id)
  return rdv.id
}

// Fenêtre d'essai volontairement lointaine : ne croise aucune donnée de démo.
const DEBUT = new Date('2027-03-01T13:00:00Z')
const PERIODE = { debut: new Date('2027-03-01T00:00:00Z'), fin: new Date('2027-03-02T00:00:00Z') }

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id

  ctxSecretaireMG = await creerCompte(RoleName.SECRETAIRE, 'secmg', [siteMG])
  ctxSecretaireGP = await creerCompte(RoleName.SECRETAIRE, 'secgp', [siteGP])
  ctxAdmin = await creerCompte(RoleName.ADMIN, 'admin', [siteMG])
  ctxSansSite = await creerCompte(RoleName.SECRETAIRE, 'orphelin', [])

  motifId = (await prisma.motifConsultation.findFirstOrThrow({ where: { actif: true } })).id

  praticienMG = await creerPraticien('MG')
  praticienGP = await creerPraticien('GP')
  await prisma.praticienMotif.create({
    data: { praticienId: praticienMG, motifId, dureeMinutes: 45 },
  })

  rdvMG = await creerRendezVous(siteMG, praticienMG, DEBUT)
  rdvGP = await creerRendezVous(siteGP, praticienGP, DEBUT)

  const fauteuilMG = await prisma.fauteuil.findFirstOrThrow({ where: { siteId: siteMG } })
  const plage = await prisma.plageDePresence.create({
    data: {
      praticienId: praticienMG,
      siteId: siteMG,
      fauteuilId: fauteuilMG.id,
      debut: new Date('2027-03-01T11:30:00Z'),
      fin: new Date('2027-03-01T21:00:00Z'),
    },
    select: { id: true },
  })
  cree.plages.push(plage.id)
})

afterAll(async () => {
  // Les rendez-vous et patients sont supprimables ; les lignes d'audit produites
  // par ces tests ne le sont pas, et c'est le comportement attendu (D9).
  await prisma.rendezVous.deleteMany({ where: { id: { in: cree.rdv } } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: cree.plages } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
})

describe('cloisonnement par site', () => {
  it('une secrétaire de Marie-Galante ne voit que les rendez-vous de son site', async () => {
    const rdv = await listerRendezVous(ctxSecretaireMG, PERIODE)
    const ids = rdv.map((r) => r.id)

    expect(ids).toContain(rdvMG)
    expect(ids).not.toContain(rdvGP)
    expect(rdv.every((r) => r.site.id === siteMG)).toBe(true)
  })

  it('la secrétaire de Guadeloupe voit l’autre moitié, et pas la première', async () => {
    const ids = (await listerRendezVous(ctxSecretaireGP, PERIODE)).map((r) => r.id)

    expect(ids).toContain(rdvGP)
    expect(ids).not.toContain(rdvMG)
  })

  it('un administrateur voit les deux sites', async () => {
    const ids = (await listerRendezVous(ctxAdmin, PERIODE)).map((r) => r.id)

    expect(ids).toContain(rdvMG)
    expect(ids).toContain(rdvGP)
  })

  it('un rendez-vous hors portée est introuvable, pas seulement masqué', async () => {
    // La différence compte : masquer après coup laisse la donnée sortir de la
    // base, et le jour où un appelant oublie le masquage, elle s'affiche.
    expect(await lireRendezVous(ctxSecretaireMG, rdvGP)).toBeNull()
    expect(await lireRendezVous(ctxSecretaireMG, rdvMG)).not.toBeNull()
  })

  it('un compte sans aucun rattachement ne voit RIEN — et surtout pas tout', async () => {
    // Le piège de ce fichier : `siteId: { in: [] }` doit rendre zéro ligne. Une
    // implémentation qui traiterait la liste vide comme « pas de filtre »
    // donnerait l'agenda entier au compte le moins habilité du cabinet.
    expect(ctxSansSite.porteeGlobale).toBe(false)
    expect(await listerRendezVous(ctxSansSite, PERIODE)).toHaveLength(0)
    expect(await listerPresences(ctxSansSite, PERIODE)).toHaveLength(0)
    expect(await listerFauteuils(ctxSansSite)).toHaveLength(0)
  })

  it('demander explicitement un site hors portée est refusé, pas ignoré', async () => {
    await expect(listerRendezVous(ctxSecretaireMG, PERIODE, { siteId: siteGP })).rejects.toThrow(
      PorteeSiteError,
    )
  })

  it('le refus de portée laisse une trace au journal', async () => {
    const avant = await prisma.auditLog.count({
      where: { actorId: ctxSecretaireMG.userId, action: 'PERMISSION_DENIED', entityId: siteGP },
    })

    await expect(
      listerPresences(ctxSecretaireMG, PERIODE, { siteId: siteGP }),
    ).rejects.toThrow(PorteeSiteError)

    const apres = await prisma.auditLog.count({
      where: { actorId: ctxSecretaireMG.userId, action: 'PERMISSION_DENIED', entityId: siteGP },
    })
    expect(apres).toBe(avant + 1)
  })

  it('demander son propre site passe', async () => {
    const rdv = await listerRendezVous(ctxSecretaireMG, PERIODE, { siteId: siteMG })
    expect(rdv.map((r) => r.id)).toContain(rdvMG)
  })
})

describe('portée — helpers', () => {
  it('peutVoirSite suit le rattachement, et la portée globale l’emporte', () => {
    expect(peutVoirSite(ctxSecretaireMG, siteMG)).toBe(true)
    expect(peutVoirSite(ctxSecretaireMG, siteGP)).toBe(false)
    expect(peutVoirSite(ctxAdmin, siteGP)).toBe(true)
  })

  it('filtreSite : tous les cabinets en activité pour une portée globale (D74), ses rattachements sinon', async () => {
    const actifs = (await prisma.site.findMany({ where: { actif: true }, select: { id: true } })).map((x) => x.id)
    expect([...filtreSite(ctxAdmin).siteId.in].sort()).toEqual(actifs.sort())
    expect(filtreSite(ctxSecretaireMG)).toEqual({ siteId: { in: [siteMG] } })
    // Le cas qui compte : pas de rattachement, donc une liste vide — et non
    // l'absence de filtre.
    expect(filtreSite(ctxSansSite)).toEqual({ siteId: { in: [] } })
  })
})

describe('ce qui n’est pas cloisonné, et pourquoi', () => {
  it('les praticiens se lisent depuis les deux sites', async () => {
    // Un praticien n'appartient pas à un site, il s'y rend. La secrétaire de
    // Marie-Galante doit pouvoir nommer le confrère qui consulte en Guadeloupe.
    const ids = (await listerPraticiens(ctxSecretaireMG)).map((p) => p.id)
    expect(ids).toContain(praticienMG)
    expect(ids).toContain(praticienGP)
  })

  it('le catalogue des motifs est commun', async () => {
    const motifs = await listerMotifs(ctxSecretaireMG)
    expect(motifs.length).toBeGreaterThan(0)
    expect(motifs.map((m) => m.id)).toContain(motifId)
  })
})

describe('durée d’un acte', () => {
  it('vient du couple praticien × motif', async () => {
    expect(await dureePour(ctxSecretaireMG, praticienMG, motifId)).toBe(45)
  })

  it('vaut null quand le praticien ne pratique pas cet acte', async () => {
    // Pas une erreur : une réponse. Chacun a son périmètre, et l'appelant doit
    // refuser le rendez-vous plutôt que se rabattre sur une durée par défaut.
    expect(await dureePour(ctxSecretaireMG, praticienGP, motifId)).toBeNull()
  })
})

describe('journalisation des lectures', () => {
  it('une lecture d’agenda laisse une ligne, avec son volume', async () => {
    const avant = await prisma.auditLog.count({
      where: { actorId: ctxSecretaireMG.userId, action: 'READ', entityType: 'agenda' },
    })

    const rdv = await listerRendezVous(ctxSecretaireMG, PERIODE)

    const derniere = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxSecretaireMG.userId, action: 'READ', entityType: 'agenda' },
      orderBy: { occurredAt: 'desc' },
      select: { itemCount: true },
    })
    const apres = await prisma.auditLog.count({
      where: { actorId: ctxSecretaireMG.userId, action: 'READ', entityType: 'agenda' },
    })

    expect(apres).toBe(avant + 1)
    expect(derniere.itemCount).toBe(rdv.length)
  })
})
