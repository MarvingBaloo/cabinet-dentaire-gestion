import { RoleName, SiteCode, StatutRendezVous, TypeNotification } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { PorteeSiteError } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import { lireAccueil } from '@/server/queries/accueil'
import { lireDemandesAnnulationEnAttente, listerRendezVous } from '@/server/queries/agenda'
import { lireActiviteRecente } from '@/server/queries/tableau-bord'
import { listerUtilisateurs } from '@/server/queries/users'
import {
  AnnulationReserveeAuPraticienError,
  ReserveAuPraticienError,
  annulerRendezVous,
  apercuCreneau,
  creerRendezVous,
  refuserAnnulation,
  validerAnnulation,
} from '@/server/services/agenda'
import { listerModelesMessages } from '@/server/services/modeles-messages'
import { creerMotifPatient } from '@/server/services/motifs-patient'
import { debloquerPatient } from '@/server/services/patients'
import { creerUtilisateur, desactiverUtilisateur } from '@/server/services/users'

// La batterie du rôle PRATICIEN (21/10/2026). Le praticien fait tout ce que fait la secrétaire (sa batterie le
// couvre) ; celle-ci éprouve ce qu'il a en plus — son accueil, trancher les demandes d'annulation de SES
// rendez-vous, annuler directement les siens, l'urgence sur planning plein et le hors-horaires sur SON agenda —
// et ce qui lui reste fermé : l'agenda et les demandes d'un confrère, l'administration (D64).

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }
const h = (jour: string, heure: string) => new Date(`2027-08-${jour}T${heure}:00Z`)

let siteMG: string
let siteGP: string
let ctxMartin: AuthContext
let ctxBastien: AuthContext
let ctxTitulaire: AuthContext
let ctxSecretaire: AuthContext
let martin: string
let bastien: string
let titulaire: string
let fauteuil1: string
let fauteuil2: string
let fauteuil3: string
let motifId: string
let patientId: string

const cree = { praticiens: [] as string[], fauteuils: [] as string[], plages: [] as string[] }

async function compte(roles: RoleName[], cle: string, sites: string[]) {
  const ids = await prisma.role.findMany({ where: { name: { in: roles } }, select: { id: true } })
  const u = await prisma.user.create({
    data: {
      email: `role-prat-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: ids.map((r) => ({ roleId: r.id })) },
      sites: { create: sites.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  })
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error(`Contexte introuvable : ${cle}`)
  return ctx
}

async function fiche(nom: string, userId: string) {
  const p = await prisma.praticien.create({
    data: { nom: `${nom}${SUFFIXE}`, prenom: 'Dr', couleur: '#0078cc', userId },
  })
  cree.praticiens.push(p.id)
  await prisma.praticienMotif.create({ data: { praticienId: p.id, motifId, dureeMinutes: 30 } })
  return p.id
}

async function presence(praticienId: string, fauteuilId: string, jour: string) {
  const p = await prisma.plageDePresence.create({
    data: { praticienId, siteId: siteMG, fauteuilId, debut: h(jour, '12:00'), fin: h(jour, '21:00') },
    select: { id: true },
  })
  cree.plages.push(p.id)
}

async function rdvDirect(praticienId: string, fauteuilId: string, debut: Date, statut: StatutRendezVous = 'CONFIRME') {
  const r = await prisma.rendezVous.create({
    data: {
      patientId,
      praticienId,
      siteId: siteMG,
      fauteuilId,
      motifId,
      debut,
      fin: new Date(debut.getTime() + 30 * 60_000),
      statut,
    },
    select: { id: true },
  })
  return r.id
}

const rdvDe = (praticienId: string, jour: string, heure: string, extra: Record<string, unknown> = {}) => ({
  patientId,
  praticienId,
  motifId,
  siteId: siteMG,
  debut: h(jour, heure),
  surbooking: false,
  horsHoraire: false,
  ...extra,
})

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id
  motifId = (
    await prisma.motifConsultation.create({
      data: { libelle: `Soin praticien ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc', ordre: 9300 },
      select: { id: true },
    })
  ).id

  ctxMartin = await compte([RoleName.PRATICIEN], 'martin', [siteMG])
  ctxBastien = await compte([RoleName.PRATICIEN], 'bastien', [siteMG])
  ctxTitulaire = await compte([RoleName.PRATICIEN, RoleName.ADMIN], 'titulaire', [siteMG])
  ctxSecretaire = await compte([RoleName.SECRETAIRE], 'secretaire', [siteMG])
  martin = await fiche('Martin', ctxMartin.userId)
  bastien = await fiche('Bastien', ctxBastien.userId)
  titulaire = await fiche('Titulaire', ctxTitulaire.userId)

  for (const nom of ['1', '2', '3']) {
    const f = await prisma.fauteuil.create({
      data: { siteId: siteMG, nom: `Fauteuil prat ${nom} ${SUFFIXE}` },
      select: { id: true },
    })
    cree.fauteuils.push(f.id)
  }
  ;[fauteuil1, fauteuil2, fauteuil3] = cree.fauteuils as [string, string, string]
  for (const jour of ['02', '03', '04', '05', '06']) {
    await presence(martin, fauteuil1, jour)
    await presence(bastien, fauteuil2, jour)
    await presence(titulaire, fauteuil3, jour)
  }
  patientId = (
    await prisma.patient.create({
      data: { nom: `Dupont${SUFFIXE}`, prenom: 'Marie', telephone: '+590690990011' },
      select: { id: true },
    })
  ).id
})

afterAll(async () => {
  await prisma.envoiListeAttente.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.notification.deleteMany({ where: { rendezVous: { praticienId: { in: cree.praticiens } } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: cree.plages } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { id: patientId } })
  await prisma.motifConsultation.deleteMany({ where: { id: motifId } })
})

// ─── 1. Le rôle ─────────────────────────────────────────────────────────────

describe('1. Le praticien porte les droits du secrétariat, plus la validation des annulations et la lecture des comptes', () => {
  it('21 droits : les 18 de la secrétaire, plus agenda:valider, utilisateur:read (D64) et ses statistiques (D73)', () => {
    expect([...ctxMartin.permissions].sort()).toEqual([
      'agenda:create',
      'agenda:delete',
      'agenda:read',
      'agenda:update',
      'agenda:valider',
      'motif:read',
      'note:create',
      'note:delete',
      'note:read',
      'note:update',
      'patient:create',
      'patient:read',
      'patient:update',
      'praticien:read',
      'presence:create',
      'presence:delete',
      'presence:read',
      'presence:update',
      'site:read',
      'statistiques:read',
      'utilisateur:read',
    ])
  })

  it('il lit la liste du personnel, mais n’en crée ni n’en modifie aucun', async () => {
    expect((await listerUtilisateurs(ctxMartin)).length).toBeGreaterThan(0)
    await expect(
      creerUtilisateur(ctxMartin, {
        email: `x-${SUFFIXE}@test.local`,
        nom: 'X',
        prenom: 'Y',
        motDePasse: 'motdepasse-assez-long',
        roles: [RoleName.ADMIN],
        siteIds: [],
      } as never),
    ).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(desactiverUtilisateur(ctxMartin, ctxBastien.userId)).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  it('le journal, les modèles de SMS, le menu des patients et le déblocage restent à l’administrateur (D64)', async () => {
    await expect(lireActiviteRecente(ctxMartin, 10)).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(listerModelesMessages(ctxMartin)).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(creerMotifPatient(ctxMartin, {} as never)).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(debloquerPatient(ctxMartin, { id: patientId })).rejects.toBeInstanceOf(PermissionDeniedError)
  })
})

// ─── 2. Son accueil ─────────────────────────────────────────────────────────

describe('2. Son accueil ne montre que ses rendez-vous', () => {
  it('le Dr Martin voit le sien, pas celui du Dr Bastien le même jour', async () => {
    const sien = await rdvDirect(martin, fauteuil1, h('02', '13:00'))
    const autre = await rdvDirect(bastien, fauteuil2, h('02', '13:00'))
    const mg = { id: siteMG, code: SiteCode.MARIE_GALANTE, nom: 'Cabinet de Marie-Galante' }
    const accueil = await lireAccueil(ctxMartin, mg, [mg], { praticienId: martin, maintenant: h('02', '12:30') })
    const ids = JSON.stringify(accueil)
    expect(ids).toContain(sien)
    expect(ids).not.toContain(autre)
  })

  it('l’agenda du cabinet, lui, lui montre tous les praticiens de son cabinet', async () => {
    const rdvs = await listerRendezVous(ctxMartin, { debut: h('02', '04:00'), fin: h('03', '04:00') })
    expect(new Set(rdvs.map((r) => r.praticien.id))).toEqual(new Set([martin, bastien]))
  })
})

// ─── 3. Les annulations ─────────────────────────────────────────────────────

describe('3. Les annulations : il tranche les siennes, jamais celles d’un confrère', () => {
  it('il voit les demandes sur SES rendez-vous, pas celles du confrère', async () => {
    const sienne = await rdvDirect(martin, fauteuil1, h('03', '13:00'))
    const autre = await rdvDirect(bastien, fauteuil2, h('03', '13:00'))
    await annulerRendezVous(ctxSecretaire, { id: sienne })
    await annulerRendezVous(ctxSecretaire, { id: autre })
    const ids = (await lireDemandesAnnulationEnAttente(ctxMartin)).map((d) => d.id)
    expect(ids).toContain(sienne)
    expect(ids).not.toContain(autre)
  })

  it('il valide une demande sur son rendez-vous : annulé, aucune absence comptée, SMS au patient, créneau rendu', async () => {
    const id = await rdvDirect(martin, fauteuil1, h('03', '14:00'))
    await annulerRendezVous(ctxSecretaire, { id })
    const r = await validerAnnulation(ctxMartin, { id })
    expect(r.statut).toBe(StatutRendezVous.ANNULE)
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patientId } })).manquements).toBe(0)
    expect(
      await prisma.notification.count({ where: { rendezVousId: id, type: TypeNotification.ANNULATION_CABINET } }),
    ).toBe(1)
    const trace = await prisma.auditLog.findFirst({
      where: { actorId: ctxMartin.userId, action: 'ANNULATION_VALIDEE', entityId: id },
    })
    expect(trace).not.toBeNull()
  })

  it('il refuse une demande : le rendez-vous revient intact, dans son statut d’avant', async () => {
    const id = await rdvDirect(martin, fauteuil1, h('03', '15:00'), 'SALLE_ATTENTE')
    await annulerRendezVous(ctxSecretaire, { id })
    await refuserAnnulation(ctxMartin, { id, raison: 'Le patient vient finalement' })
    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id } })
    expect(rdv.statut).toBe(StatutRendezVous.SALLE_ATTENTE)
  })

  it('il ne tranche pas la demande d’un confrère, même avec agenda:valider — refus tracé, rendez-vous intact', async () => {
    const id = await rdvDirect(bastien, fauteuil2, h('03', '16:00'))
    await annulerRendezVous(ctxSecretaire, { id })
    await expect(validerAnnulation(ctxMartin, { id })).rejects.toBeInstanceOf(AnnulationReserveeAuPraticienError)
    await expect(refuserAnnulation(ctxMartin, { id })).rejects.toBeInstanceOf(AnnulationReserveeAuPraticienError)
    expect((await prisma.rendezVous.findUniqueOrThrow({ where: { id } })).statut).toBe(
      StatutRendezVous.ANNULATION_DEMANDEE,
    )
  })

  it('le titulaire (praticien et administrateur) tranche aussi les demandes de ses confrères', async () => {
    const id = await rdvDirect(bastien, fauteuil2, h('03', '17:00'))
    await annulerRendezVous(ctxSecretaire, { id })
    expect((await validerAnnulation(ctxTitulaire, { id })).statut).toBe(StatutRendezVous.ANNULE)
  })

  it('il annule directement SON rendez-vous, sans demande et sans absence comptée', async () => {
    const id = await rdvDirect(martin, fauteuil1, h('04', '13:00'))
    const r = await annulerRendezVous(ctxMartin, { id })
    expect(r.statut).toBe(StatutRendezVous.ANNULE)
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patientId } })).manquements).toBe(0)
  })

  it('« Annuler » sur le rendez-vous d’un confrère ne fait qu’une demande', async () => {
    const id = await rdvDirect(bastien, fauteuil2, h('04', '13:00'))
    expect((await annulerRendezVous(ctxMartin, { id })).statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
  })
})

// ─── 4. Urgence et hors-horaires ────────────────────────────────────────────

describe('4. Urgence sur planning plein et hors-horaires : sur SON agenda seulement (Q19, Q23, Marving 21/10)', () => {
  it('le Dr Martin glisse une urgence sur son planning plein', async () => {
    await rdvDirect(martin, fauteuil1, h('05', '13:00'))
    const r = await creerRendezVous(ctxMartin, rdvDe(martin, '05', '13:00', { surbooking: true }))
    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: r.id } })
    expect(rdv.surbooking).toBe(true)
  })

  it('il ne la glisse pas dans le planning plein du Dr Bastien — l’aperçu le dit déjà', async () => {
    await rdvDirect(bastien, fauteuil2, h('05', '14:00'))
    await expect(
      creerRendezVous(ctxMartin, rdvDe(bastien, '05', '14:00', { surbooking: true })),
    ).rejects.toBeInstanceOf(ReserveAuPraticienError)
    const apercu = await apercuCreneau(ctxMartin, rdvDe(bastien, '05', '14:00', { surbooking: true }))
    expect(apercu.ok).toBe(false)
  })

  it('le titulaire non plus : administrer ne donne aucun droit sur le planning d’un confrère', async () => {
    await expect(
      creerRendezVous(ctxTitulaire, rdvDe(bastien, '05', '14:00', { surbooking: true })),
    ).rejects.toBeInstanceOf(ReserveAuPraticienError)
  })

  it('il ne pose pas de rendez-vous hors horaires sur l’agenda d’un confrère', async () => {
    await expect(
      creerRendezVous(ctxMartin, rdvDe(bastien, '05', '22:30', { horsHoraire: true })),
    ).rejects.toBeInstanceOf(ReserveAuPraticienError)
  })

  it('un patient qui ne peut venir qu’à 18h30 : le Dr Martin le reçoit après sa journée, sur son agenda (Q23)', async () => {
    // Sa présence finit à 21h UTC (17h en Guadeloupe) : 22h30 UTC est hors de ses horaires.
    const r = await creerRendezVous(ctxMartin, rdvDe(martin, '05', '22:30', { horsHoraire: true }))
    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: r.id } })
    expect(rdv).toMatchObject({ horsHoraire: true, praticienId: martin, fauteuilId: fauteuil1 })
  })
})

// ─── 5. Portée ──────────────────────────────────────────────────────────────

describe('4 bis. Hors horaires : seulement un jour où il reçoit dans ce cabinet', () => {
  it('le dimanche 08, où il n’a aucune présence, le rendez-vous hors horaires reste refusé', async () => {
    await expect(creerRendezVous(ctxMartin, rdvDe(martin, '08', '13:00', { horsHoraire: true }))).rejects.toThrow(
      'Le praticien n’est pas présent sur ce site à cette date.',
    )
  })

  it('la secrétaire décale de dix minutes un rendez-vous hors horaires : accepté, il le reste', async () => {
    const r = await creerRendezVous(ctxMartin, rdvDe(martin, '06', '22:00', { horsHoraire: true }))
    const { deplacerRendezVous } = await import('@/server/services/agenda')
    const d = await deplacerRendezVous(ctxSecretaire, { id: r.id, debut: h('06', '22:10') })
    expect(d.debut.toISOString()).toBe(h('06', '22:10').toISOString())
  })
})

describe('5. Un praticien rattaché à Marie-Galante n’agit pas en Guadeloupe', () => {
  it('ni lecture nommée, ni rendez-vous posé là-bas', async () => {
    await expect(
      listerRendezVous(ctxMartin, { debut: h('02', '04:00'), fin: h('03', '04:00') }, { siteId: siteGP }),
    ).rejects.toBeInstanceOf(PorteeSiteError)
    await expect(
      creerRendezVous(ctxMartin, { ...rdvDe(martin, '06', '13:00'), siteId: siteGP }),
    ).rejects.toBeInstanceOf(PorteeSiteError)
  })
})

// ─── 6. Le patient prévenu ──────────────────────────────────────────────────

describe('6. Quand le praticien annule lui-même, le patient est prévenu comme à la validation (Marving, 21/10)', () => {
  it('annulation directe d’un rendez-vous attendu : SMS d’annulation au patient', async () => {
    const id = await rdvDirect(martin, fauteuil1, h('06', '13:00'))
    await annulerRendezVous(ctxMartin, { id })
    expect(
      await prisma.notification.count({ where: { rendezVousId: id, type: TypeNotification.ANNULATION_CABINET } }),
    ).toBe(1)
  })

  it('corriger un « absent » en « annulé » pour rendre son point au patient n’envoie rien', async () => {
    const id = await rdvDirect(martin, fauteuil1, h('06', '14:00'), 'ABSENT')
    await annulerRendezVous(ctxMartin, { id })
    expect(
      await prisma.notification.count({ where: { rendezVousId: id, type: TypeNotification.ANNULATION_CABINET } }),
    ).toBe(0)
  })
})
