import { RoleName, SiteCode, type StatutRendezVous } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import {
  type PlageStat,
  type RdvStat,
  calculerAbsences,
  calculerActivite,
  calculerPatients,
  calculerPrise,
  calculerRemplissage,
  fenetreDe,
} from '@/server/domaine/statistiques'
import {
  SansFichePraticienError,
  lireAbsences,
  lireActivite,
  lirePrise,
  lireRemplissage,
} from '@/server/queries/statistiques'

// Statistiques du cabinet (D73). D'abord les calculs, sur des rendez-vous écrits à la main ; puis la lecture en
// base, où se jouent les deux règles qui comptent : un praticien ne voit que SES chiffres, et le secrétariat n'en
// voit aucun.

// Un instant au cabinet (UTC-4) : `t('2027-03-15', '09:00')`.
const t = (jour: string, heure: string) => new Date(`${jour}T${heure}:00-04:00`)

let n = 0
function rdv(debut: Date, extra: Partial<RdvStat> = {}): RdvStat {
  return {
    debut,
    fin: new Date(debut.getTime() + 30 * 60_000),
    creeLe: new Date(debut.getTime() - 10 * 86_400_000),
    statut: 'TERMINE',
    praticienId: 'p1',
    siteId: 's1',
    fauteuilId: 'f1',
    motifId: 'm1',
    patientId: `patient-${++n}`,
    manquement: false,
    enLigne: false,
    ...extra,
  }
}

// ─── 1. Les fenêtres ──────────────────────────────────────────────────────────

describe('1. La période et sa comparaison un an plus tôt', () => {
  const maintenant = t('2027-03-17', '10:00')

  it('12 mois : douze mois civils, du 1er avril au mois en cours, comparés aux mêmes mois un an avant', () => {
    const f = fenetreDe('12m', maintenant)
    expect(f.granularite).toBe('mois')
    expect(f.seaux.map((s) => s.cle)).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
      '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
    ])
    expect(f.debut).toEqual(t('2026-04-01', '00:00'))
    expect(f.comparaison.debut).toEqual(t('2025-04-01', '00:00'))
    // La comparaison s'arrête au même jour et à la même heure : on ne compare pas un mois entamé à un mois plein.
    expect(f.comparaison.fin).toEqual(t('2026-03-17', '10:00'))
    expect(f.seauN1(t('2025-07-14', '09:00'))).toBe('2026-07')
  })

  it('3 mois : treize semaines qui commencent un lundi ; la comparaison recule de 364 jours (un lundi reste un lundi)', () => {
    const f = fenetreDe('3m', maintenant)
    expect(f.granularite).toBe('semaine')
    expect(f.seaux).toHaveLength(13)
    expect(new Date(`${f.seaux[0]!.cle}T12:00:00Z`).getUTCDay()).toBe(1)
    expect(f.seauN1(t('2026-03-16', '09:00'))).toBe(f.seauDe(t('2027-03-15', '09:00')))
  })

  it('30 jours : un seau par jour ; année en cours : depuis le 1er janvier', () => {
    expect(fenetreDe('30j', maintenant).seaux).toHaveLength(30)
    const annee = fenetreDe('annee', maintenant)
    expect(annee.seaux.map((s) => s.cle)).toEqual(['2027-01', '2027-02', '2027-03'])
  })
})

// ─── 2. Les calculs ───────────────────────────────────────────────────────────

describe('2. Ce que compte chaque onglet', () => {
  const maintenant = t('2027-03-17', '10:00')
  const f = fenetreDe('12m', maintenant)
  const noms = { praticiens: new Map([['p1', 'Dr Rivière'], ['p2', 'Dr Morel']]), sites: new Map([['s1', 'Marie-Galante']]) }

  it('Activité : un rendez-vous absent, annulé, en attente d’annulation ou pas encore passé n’est pas honoré', () => {
    const lignes = [
      rdv(t('2027-03-01', '09:00')),
      rdv(t('2027-03-01', '10:00'), { statut: 'CONFIRME' }), // resté « confirmé » après coup : il a eu lieu
      rdv(t('2027-03-02', '09:00'), { statut: 'ABSENT' }),
      rdv(t('2027-03-02', '10:00'), { statut: 'ANNULE' }),
      rdv(t('2027-03-02', '11:00'), { statut: 'ANNULATION_DEMANDEE' }),
      rdv(t('2027-03-17', '15:00'), { statut: 'CONFIRME' }), // cet après-midi
      rdv(t('2026-03-02', '09:00')), // un an avant
      rdv(t('2026-03-18', '09:00')), // un an avant, mais après « aujourd'hui moins un an » : hors comparaison
      rdv(t('2027-03-03', '09:00'), { praticienId: 'p2' }),
    ]
    const a = calculerActivite(f, lignes, noms)
    expect(a.honores).toBe(3)
    expect(a.honoresN1).toBe(1)
    expect(a.heures).toBe(2) // trois demi-heures, arrondies
    expect(a.moyenneParJour).toBe(1.5) // trois rendez-vous sur deux jours travaillés
    expect(a.parPraticien).toEqual([
      { libelle: 'Dr Rivière', valeur: 2 },
      { libelle: 'Dr Morel', valeur: 1 },
    ])
    expect(a.courbe.at(-1)).toMatchObject({ cle: '2027-03', valeur: 3, valeurN1: 1 })
  })

  it('Absences : le taux se calcule sur les rendez-vous qui ont eu lieu ou auraient dû ; le lundi matin ressort', () => {
    const lundi = '2027-03-08'
    const lignes = [
      rdv(t(lundi, '08:30'), { statut: 'ABSENT', manquement: true }),
      rdv(t(lundi, '09:00')),
      rdv(t(lundi, '15:00')),
      rdv(t('2027-03-09', '09:00')),
      rdv(t('2027-03-09', '10:00'), { statut: 'ANNULE', manquement: true }), // annulé par le patient
      rdv(t('2027-03-10', '10:00'), { statut: 'ANNULE' }), // annulé par le cabinet
    ]
    const a = calculerAbsences(f, lignes, new Map([['m1', { libelle: 'Détartrage' }]]))
    expect(a.taux).toBeCloseTo(1 / 4)
    expect(a.absences).toBe(1)
    expect(a.annulesParPatient).toBe(1)
    expect(a.annulesParCabinet).toBe(1)
    expect(a.chaleur[0]![0]).toEqual({ valeur: 0.5, effectif: 2 }) // lundi, 8–10 h
    expect(a.chaleur[0]![3]).toEqual({ valeur: 0, effectif: 1 }) // lundi, 14–16 h
    expect(a.parMotif).toEqual([{ libelle: 'Détartrage', rendezVous: 4, absences: 1, taux: 0.25 }])
  })

  it('Prise de rendez-vous : la période porte sur le jour de la PRISE ; délai médian, part en ligne, jour même', () => {
    const lignes = [
      rdv(t('2027-04-10', '09:00'), { creeLe: t('2027-03-01', '09:00'), enLigne: true }), // pris en mars, pour avril
      rdv(t('2027-03-05', '09:00'), { creeLe: t('2027-03-03', '09:00') }),
      rdv(t('2027-03-05', '10:00'), { creeLe: t('2027-03-05', '08:00') }), // le jour même
      rdv(t('2027-03-20', '10:00'), { creeLe: t('2027-02-25', '10:00') }), // pris en février
    ]
    const p = calculerPrise(f, lignes, new Map())
    expect(p.pris).toBe(4)
    expect(p.partEnLigne).toBe(0.25)
    expect(p.memeJour).toBe(1)
    expect(p.delaiMedian).toBeCloseTo((2 + 23) / 2)
  })

  it('Remplissage : un absent a bloqué le créneau, un annulé non ; seules les heures déjà passées comptent', () => {
    const plage: PlageStat = { debut: t('2027-03-08', '08:00'), fin: t('2027-03-08', '12:00'), praticienId: 'p1', siteId: 's1', fauteuilId: 'f1' }
    const heure = (debut: Date, statut: StatutRendezVous) => rdv(debut, { statut, fin: new Date(debut.getTime() + 60 * 60_000) })
    const lignes = [heure(t('2027-03-08', '08:00'), 'TERMINE'), heure(t('2027-03-08', '09:00'), 'ABSENT'), heure(t('2027-03-08', '10:00'), 'ANNULE')]
    const r = calculerRemplissage(f, [plage], lignes, { sites: noms.sites, fauteuils: new Map([['f1', 'Fauteuil 1']]) })
    expect(r.taux).toBe(0.5)
    expect(r.heuresPresence).toBe(4)
    expect(r.heuresLibres).toBe(2)
    expect(r.chaleur[0]![0]).toEqual({ valeur: 1, effectif: 2 }) // 8–10 h : deux heures, toutes deux prises

    // Ce matin, plage de 8 h à 12 h, il est 10 h : deux heures de présence seulement.
    const ceMatin: PlageStat = { ...plage, debut: t('2027-03-17', '08:00'), fin: t('2027-03-17', '12:00') }
    expect(calculerRemplissage(f, [ceMatin], [], { sites: noms.sites, fauteuils: new Map() }).heuresPresence).toBe(2)
  })

  it('Patients : nouveau l’année où sa fiche est créée ; reçus, revenus, âges', () => {
    const lignes = [
      rdv(t('2027-03-01', '09:00'), { patientId: 'ancien' }),
      rdv(t('2027-03-08', '09:00'), { patientId: 'ancien' }),
      rdv(t('2027-03-02', '09:00'), { patientId: 'nouveau' }),
      rdv(t('2027-03-03', '09:00'), { patientId: 'absent', statut: 'ABSENT' }),
    ]
    const p = calculerPatients(
      f,
      lignes,
      new Map([
        ['ancien', t('2020-01-01', '09:00')],
        ['nouveau', t('2027-02-20', '09:00')],
      ]),
      new Map([
        ['ancien', new Date('1960-06-01')],
        ['nouveau', null],
      ]),
    )
    expect(p.recus).toBe(2)
    expect(p.nouveaux).toBe(1)
    expect(p.revenus).toBe(1)
    expect(p.ages.find((a) => a.libelle === '60 ans et plus')!.valeur).toBe(1)
    expect(p.ageInconnu).toBe(1)
  })
})

// ─── 3. La lecture en base : qui voit quoi ────────────────────────────────────

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }
// Une semaine de 2031, que nulle autre batterie n'occupe ; « maintenant » est le vendredi suivant.
const MAINTENANT = t('2031-06-13', '18:00')

let siteMG: string
let siteGP: string
let ctxMartin: AuthContext
let ctxTitulaire: AuthContext
let ctxSecretaire: AuthContext
let ctxSansFiche: AuthContext
let martin: string
let bastien: string
let motifId: string
let patientId: string
const cree = { praticiens: [] as string[], fauteuils: [] as string[] }

async function compte(roles: RoleName[], cle: string, sites: string[]) {
  const ids = await prisma.role.findMany({ where: { name: { in: roles } }, select: { id: true } })
  const u = await prisma.user.create({
    data: {
      email: `stats-${cle}-${SUFFIXE}@test.local`,
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

async function poser(praticienId: string, siteId: string, debut: Date, statut: StatutRendezVous = 'TERMINE') {
  const fauteuilId = cree.fauteuils[siteId === siteMG ? (praticienId === martin ? 0 : 1) : 2]!
  await prisma.rendezVous.create({
    data: { patientId, praticienId, siteId, fauteuilId, motifId, debut, fin: new Date(debut.getTime() + 30 * 60_000), statut },
  })
}

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id
  motifId = (
    await prisma.motifConsultation.create({
      data: { libelle: `Statistiques ${SUFFIXE}`, dureeIndicative: 30, couleur: '#387a70', ordre: 9500 },
      select: { id: true },
    })
  ).id
  patientId = (
    await prisma.patient.create({ data: { nom: `Stats${SUFFIXE}`, prenom: 'Marie', telephone: '+590690990077' }, select: { id: true } })
  ).id

  ctxMartin = await compte([RoleName.PRATICIEN], 'martin', [siteMG])
  const ctxBastien = await compte([RoleName.PRATICIEN], 'bastien', [siteMG, siteGP])
  ctxTitulaire = await compte([RoleName.PRATICIEN, RoleName.ADMIN], 'titulaire', [siteMG])
  ctxSecretaire = await compte([RoleName.SECRETAIRE], 'secretaire', [siteMG])
  ctxSansFiche = await compte([RoleName.PRATICIEN], 'sansfiche', [siteMG])
  for (const [cle, userId] of [['Martin', ctxMartin.userId], ['Bastien', ctxBastien.userId]] as const) {
    const p = await prisma.praticien.create({ data: { nom: `${cle}${SUFFIXE}`, prenom: 'Dr', couleur: '#387a70', userId } })
    cree.praticiens.push(p.id)
  }
  ;[martin, bastien] = cree.praticiens as [string, string]
  for (const [siteId, nom] of [[siteMG, 'A'], [siteMG, 'B'], [siteGP, 'C']] as const) {
    const f = await prisma.fauteuil.create({ data: { siteId, nom: `Stats ${nom} ${SUFFIXE}` }, select: { id: true } })
    cree.fauteuils.push(f.id)
  }

  // Martin : trois honorés et un absent à Marie-Galante, plus un honoré en Guadeloupe (où il n'est pas rattaché).
  await poser(martin, siteMG, t('2031-06-09', '09:00'))
  await poser(martin, siteMG, t('2031-06-09', '10:00'))
  await poser(martin, siteMG, t('2031-06-10', '09:00'))
  await poser(martin, siteMG, t('2031-06-10', '10:00'), 'ABSENT')
  await poser(martin, siteGP, t('2031-06-13', '09:00'))
  // Bastien : deux honorés.
  await poser(bastien, siteMG, t('2031-06-11', '09:00'))
  await poser(bastien, siteMG, t('2031-06-12', '09:00'))
  await prisma.plageDePresence.create({
    data: { praticienId: martin, siteId: siteMG, fauteuilId: cree.fauteuils[0]!, debut: t('2031-06-09', '08:00'), fin: t('2031-06-09', '12:00') },
  })
})

afterAll(async () => {
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.plageDePresence.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { id: patientId } })
  await prisma.motifConsultation.deleteMany({ where: { id: motifId } })
})

const derniereTrace = (userId: string) =>
  prisma.auditLog.findFirst({ where: { actorId: userId }, orderBy: { occurredAt: 'desc' } })

describe('3. Un praticien ne lit que ses chiffres, le titulaire choisit, le secrétariat n’a rien', () => {
  it('le Dr Martin voit ses rendez-vous, sans menu « praticien », et seulement dans son cabinet', async () => {
    const { portee, donnees } = await lireActivite(ctxMartin, { periode: '30j' }, MAINTENANT)
    expect(portee.options.praticiens).toEqual([])
    expect(portee.options.cabinets.map((c) => c.id)).toEqual([siteMG])
    // Le rendez-vous de Guadeloupe ne compte pas : il n'y est pas rattaché (D5).
    expect(donnees.honores).toBe(3)
    const absences = await lireAbsences(ctxMartin, { periode: '30j' }, MAINTENANT)
    expect(absences.donnees.taux).toBe(1 / 4)
  })

  it('l’ouverture d’un onglet est notée au journal', async () => {
    await lirePrise(ctxMartin, { periode: '30j' }, MAINTENANT)
    expect(await derniereTrace(ctxMartin.userId)).toMatchObject({ action: 'READ', entityType: 'statistiques', entityId: 'prise' })
  })

  it('demander les chiffres du Dr Bastien, ou de tout le cabinet : refusé et tracé', async () => {
    await expect(lireActivite(ctxMartin, { praticien: bastien }, MAINTENANT)).rejects.toBeInstanceOf(PermissionDeniedError)
    expect(await derniereTrace(ctxMartin.userId)).toMatchObject({
      action: 'PERMISSION_DENIED',
      deniedReason: 'statistiques:cabinet',
    })
    await expect(lireActivite(ctxMartin, { praticien: 'tous' }, MAINTENANT)).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  it('le titulaire choisit le Dr Bastien et ne voit que lui', async () => {
    const { portee, donnees } = await lireActivite(ctxTitulaire, { periode: '30j', praticien: bastien }, MAINTENANT)
    expect(portee.options.praticiens.map((p) => p.id)).toEqual(expect.arrayContaining([martin, bastien]))
    expect(portee.choix.praticien).toBe(bastien)
    expect(donnees.honores).toBe(2)
  })

  it('le titulaire, par défaut, voit tout le cabinet', async () => {
    const { portee, donnees } = await lireActivite(ctxTitulaire, { periode: '30j' }, MAINTENANT)
    expect(portee.choix.praticien).toBe('tous')
    expect(donnees.honores).toBeGreaterThanOrEqual(6)
  })

  it('le remplissage du Dr Martin : 4 h de présence lundi matin, 1 h occupée', async () => {
    const { donnees } = await lireRemplissage(ctxMartin, { periode: '30j' }, MAINTENANT)
    expect(donnees.heuresPresence).toBe(4)
    expect(donnees.taux).toBe(1 / 4)
  })

  it('la secrétaire : refusé, et tracé', async () => {
    await expect(lireActivite(ctxSecretaire, {}, MAINTENANT)).rejects.toBeInstanceOf(PermissionDeniedError)
    expect(await derniereTrace(ctxSecretaire.userId)).toMatchObject({ action: 'PERMISSION_DENIED', deniedReason: 'statistiques:read' })
  })

  it('un compte praticien sans fiche d’agenda : rien à compter, dit clairement', async () => {
    await expect(lireActivite(ctxSansFiche, {}, MAINTENANT)).rejects.toBeInstanceOf(SansFichePraticienError)
  })

  it('les droits : statistiques:read au praticien, statistiques:cabinet en plus au titulaire, rien au secrétariat', () => {
    expect(ctxMartin.permissions.has('statistiques:read')).toBe(true)
    expect(ctxMartin.permissions.has('statistiques:cabinet')).toBe(false)
    expect(ctxTitulaire.permissions.has('statistiques:cabinet')).toBe(true)
    expect([...ctxSecretaire.permissions].some((p) => p.startsWith('statistiques'))).toBe(false)
  })
})
