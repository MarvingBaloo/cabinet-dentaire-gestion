import type { StatutRendezVous } from '@prisma/client'

import {
  FUSEAU_CABINET,
  bornesDuJour,
  decalerJour,
  jourLocal,
  lundiDeSemaine,
  minutesDepuisMinuit,
  premierJourMois,
} from '@/lib/dates'

// Statistiques du cabinet (D73) : calculs purs sur les rendez-vous, les présences et les motifs déjà
// enregistrés. Aucun accès base ici : `src/server/queries/statistiques.ts` lit et cloisonne, ce fichier
// compte. Chaque onglet de l'écran a sa fonction.
//
// Définitions, les mêmes partout :
//   - honoré : passé, ni absent, ni annulé, ni en attente d'annulation. Un rendez-vous resté « confirmé »
//     après coup compte comme honoré : l'accueil ne fait pas toujours avancer le statut, et l'absence, elle,
//     est posée automatiquement 20 minutes après le début (D50) ;
//   - taux d'absence : absents / (honorés + absents). Les annulés n'y entrent pas : le créneau a été rendu ;
//   - annulé par le patient : l'annulation lui a coûté un manquement (Q27), sinon c'est le cabinet ;
//   - pris en ligne : né d'une réservation du site public.

export const PERIODES = ['30j', '3m', '12m', 'annee'] as const
export type Periode = (typeof PERIODES)[number]
export const LIBELLE_PERIODE: Record<Periode, string> = {
  '30j': '30 jours',
  '3m': '3 mois',
  '12m': '12 mois',
  annee: 'Année en cours',
}

export type Granularite = 'jour' | 'semaine' | 'mois'

export type Seau = { cle: string; libelle: string; titre: string }

export type Fenetre = {
  periode: Periode
  granularite: Granularite
  debut: Date
  fin: Date
  comparaison: { debut: Date; fin: Date }
  seaux: Seau[]
  /** Le seau d'un instant de la période, ou d'un instant de la période de comparaison ramené un an plus tard. */
  seauDe: (instant: Date) => string
  seauN1: (instant: Date) => string
}

export type RdvStat = {
  debut: Date
  fin: Date
  creeLe: Date
  statut: StatutRendezVous
  praticienId: string
  siteId: string
  fauteuilId: string
  motifId: string
  patientId: string
  manquement: boolean
  enLigne: boolean
}

export type PlageStat = { debut: Date; fin: Date; praticienId: string; siteId: string; fauteuilId: string }

export type Valeur = { libelle: string; valeur: number }
export type PointCourbe = Seau & { valeur: number | null; valeurN1: number | null }

const NON_HONORES: StatutRendezVous[] = ['ABSENT', 'ANNULE', 'ANNULATION_DEMANDEE']

export const estHonore = (r: RdvStat, maintenant: Date) => r.debut < maintenant && !NON_HONORES.includes(r.statut)
export const estAbsent = (r: RdvStat) => r.statut === 'ABSENT'
/** A eu lieu, ou aurait dû : honoré ou absent. */
const estPasseNonAnnule = (r: RdvStat, maintenant: Date) => estHonore(r, maintenant) || estAbsent(r)

/** Variation relative, `null` quand rien ne permet de comparer. */
export function evolution(valeur: number, avant: number): number | null {
  return avant > 0 ? (valeur - avant) / avant : null
}

const taux = (n: number, sur: number) => (sur > 0 ? n / sur : null)

// ─── Fenêtres ─────────────────────────────────────────────────────────────────

function ajouterMois(premierDuMois: string, n: number): string {
  const total = Number(premierDuMois.slice(0, 4)) * 12 + Number(premierDuMois.slice(5, 7)) - 1 + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/** Le même jour un an plus tôt ; le 29 février devient le 28. */
function anneeAvant(jour: string): string {
  const j = `${Number(jour.slice(0, 4)) - 1}${jour.slice(4)}`
  return j.endsWith('-02-29') ? j.replace(/-29$/, '-28') : j
}
function anneeApres(jour: string): string {
  const j = `${Number(jour.slice(0, 4)) + 1}${jour.slice(4)}`
  return j.endsWith('-02-29') ? j.replace(/-29$/, '-28') : j
}

const moisCourt = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU_CABINET, month: 'short' })
const moisLong = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU_CABINET, month: 'long', year: 'numeric' })
const jourMois = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU_CABINET, day: 'numeric', month: 'short' })
const jourComplet = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

/**
 * La période affichée et celle d'il y a un an, découpées en seaux : des jours sur 30 jours, des semaines sur
 * 3 mois, des mois au-delà. La comparaison décale de 364 jours pour les jours et les semaines (un lundi reste
 * un lundi), d'une année civile pour les mois.
 */
export function fenetreDe(periode: Periode, maintenant: Date): Fenetre {
  const aujourdHui = jourLocal(maintenant)
  const granularite: Granularite = periode === '30j' ? 'jour' : periode === '3m' ? 'semaine' : 'mois'

  let premierJour: string
  if (periode === '30j') premierJour = decalerJour(aujourdHui, -29)
  else if (periode === '3m') premierJour = decalerJour(lundiDeSemaine(aujourdHui), -7 * 12)
  else if (periode === '12m') premierJour = ajouterMois(premierJourMois(aujourdHui), -11)
  else premierJour = `${aujourdHui.slice(0, 4)}-01-01`

  const versN1 = granularite === 'mois' ? anneeAvant : (j: string) => decalerJour(j, -364)
  const depuisN1 = granularite === 'mois' ? anneeApres : (j: string) => decalerJour(j, 364)

  const cleDuJour = (jour: string) =>
    granularite === 'mois' ? jour.slice(0, 7) : granularite === 'semaine' ? lundiDeSemaine(jour) : jour

  const seaux: Seau[] = []
  for (let j = premierJour; j <= aujourdHui; ) {
    const instant = bornesDuJour(j).debut
    if (granularite === 'mois') {
      seaux.push({ cle: j.slice(0, 7), libelle: moisCourt.format(instant), titre: moisLong.format(instant) })
      j = ajouterMois(j, 1)
    } else if (granularite === 'semaine') {
      seaux.push({ cle: j, libelle: jourMois.format(instant), titre: `semaine du ${jourComplet.format(instant)}` })
      j = decalerJour(j, 7)
    } else {
      seaux.push({ cle: j, libelle: jourMois.format(instant), titre: jourComplet.format(instant) })
      j = decalerJour(j, 1)
    }
  }

  const debut = bornesDuJour(premierJour).debut
  const ecartAujourdHui = bornesDuJour(aujourdHui).debut.getTime() - bornesDuJour(versN1(aujourdHui)).debut.getTime()

  return {
    periode,
    granularite,
    debut,
    fin: maintenant,
    comparaison: { debut: bornesDuJour(versN1(premierJour)).debut, fin: new Date(maintenant.getTime() - ecartAujourdHui) },
    seaux,
    seauDe: (instant) => cleDuJour(jourLocal(instant)),
    seauN1: (instant) => cleDuJour(depuisN1(jourLocal(instant))),
  }
}

/** Sépare les lignes entre la période et sa comparaison, selon l'instant choisi (début du rendez-vous, prise…). */
export function separer<T>(f: Fenetre, lignes: T[], instant: (l: T) => Date) {
  const courant: T[] = []
  const precedent: T[] = []
  for (const l of lignes) {
    const t = instant(l)
    if (t >= f.debut && t < f.fin) courant.push(l)
    else if (t >= f.comparaison.debut && t < f.comparaison.fin) precedent.push(l)
  }
  return { courant, precedent }
}

function courbe<T>(
  f: Fenetre,
  courant: T[],
  precedent: T[],
  instant: (l: T) => Date,
  mesure: (lignes: T[]) => number | null,
): PointCourbe[] {
  const grouper = (lignes: T[], seau: (t: Date) => string) => {
    const m = new Map<string, T[]>()
    for (const l of lignes) {
      const k = seau(instant(l))
      m.set(k, [...(m.get(k) ?? []), l])
    }
    return m
  }
  const c = grouper(courant, f.seauDe)
  const p = grouper(precedent, f.seauN1)
  return f.seaux.map((s) => ({ ...s, valeur: mesure(c.get(s.cle) ?? []), valeurN1: mesure(p.get(s.cle) ?? []) }))
}

function compterPar<T>(lignes: T[], cle: (l: T) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lignes) m.set(cle(l), (m.get(cle(l)) ?? 0) + 1)
  return m
}

function enValeurs(m: Map<string, number>, libelle: (cle: string) => string): Valeur[] {
  return [...m.entries()].map(([k, valeur]) => ({ libelle: libelle(k), valeur })).sort((a, b) => b.valeur - a.valeur)
}

const minutes = (debut: Date, fin: Date) => Math.max(0, (fin.getTime() - debut.getTime()) / 60_000)

function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null
  const t = [...valeurs].sort((a, b) => a - b)
  const m = Math.floor(t.length / 2)
  return t.length % 2 ? t[m]! : (t[m - 1]! + t[m]!) / 2
}

// ─── Jours et tranches horaires ───────────────────────────────────────────────

export const JOURS_OUVRES = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'] as const
/** Tranches de deux heures, de 8 h à 18 h ; un rendez-vous plus tôt ou plus tard rejoint la tranche du bord. */
export const TRANCHES = ['8–10 h', '10–12 h', '12–14 h', '14–16 h', '16–18 h'] as const

/** 0 = lundi … 5 = samedi ; `null` le dimanche, où les deux cabinets sont fermés. */
export function indexJourOuvre(instant: Date): number | null {
  const i = new Date(`${jourLocal(instant)}T12:00:00.000Z`).getUTCDay()
  return i === 0 ? null : i - 1
}

export function indexTranche(instant: Date): number {
  const h = minutesDepuisMinuit(instant, jourLocal(instant)) / 60
  return Math.min(TRANCHES.length - 1, Math.max(0, Math.floor((h - 8) / 2)))
}

export type Case = { valeur: number | null; effectif: number }
const grilleVide = (): { n: number; sur: number }[][] =>
  JOURS_OUVRES.map(() => TRANCHES.map(() => ({ n: 0, sur: 0 })))

// ─── Onglet Activité ──────────────────────────────────────────────────────────

export function calculerActivite(
  f: Fenetre,
  rdvs: RdvStat[],
  noms: { praticiens: Map<string, string>; sites: Map<string, string> },
) {
  const { courant, precedent } = separer(f, rdvs, (r) => r.debut)
  const hon = courant.filter((r) => estHonore(r, f.fin))
  const honN1 = precedent.filter((r) => estHonore(r, f.comparaison.fin))
  const minutesDe = (l: RdvStat[]) => l.reduce((s, r) => s + minutes(r.debut, r.fin), 0)

  const jours = new Set(hon.map((r) => jourLocal(r.debut)))
  const points = courbe(f, hon, honN1, (r) => r.debut, (l) => l.length)
  const meilleur = points.reduce<PointCourbe | null>((m, p) => (!m || (p.valeur ?? 0) > (m.valeur ?? 0) ? p : m), null)

  // Moyenne par jour de la semaine : rendez-vous honorés ce jour-là / nombre de ces jours travaillés.
  const parJour = JOURS_OUVRES.map((libelle, i) => {
    const duJour = hon.filter((r) => indexJourOuvre(r.debut) === i)
    const nJours = new Set(duJour.map((r) => jourLocal(r.debut))).size
    return { libelle, valeur: nJours ? Math.round((duJour.length / nJours) * 10) / 10 : 0 }
  })

  return {
    honores: hon.length,
    honoresN1: honN1.length,
    heures: Math.round(minutesDe(hon) / 60),
    heuresN1: Math.round(minutesDe(honN1) / 60),
    moyenneParJour: jours.size ? hon.length / jours.size : null,
    meilleur: meilleur && (meilleur.valeur ?? 0) > 0 ? meilleur : null,
    courbe: points,
    parPraticien: enValeurs(compterPar(hon, (r) => r.praticienId), (id) => noms.praticiens.get(id) ?? '—'),
    parSite: enValeurs(compterPar(hon, (r) => r.siteId), (id) => noms.sites.get(id) ?? '—'),
    parJour,
  }
}

// ─── Onglet Motifs ────────────────────────────────────────────────────────────

/** Un motif ne compte comme « en hausse » qu'à partir de ce nombre de rendez-vous l'an d'avant : de 3 à 6, ce
 *  n'est pas une tendance. */
export const SEUIL_HAUSSE = 20

export function calculerMotifs(
  f: Fenetre,
  rdvs: RdvStat[],
  motifs: Map<string, { libelle: string; estUrgence: boolean }>,
) {
  const { courant, precedent } = separer(f, rdvs, (r) => r.debut)
  const pris = courant.filter((r) => estPasseNonAnnule(r, f.fin))
  const prisN1 = precedent.filter((r) => estPasseNonAnnule(r, f.comparaison.fin))
  const libelle = (id: string) => motifs.get(id)?.libelle ?? '—'

  const parMotif = compterPar(pris, (r) => r.motifId)
  const parMotifN1 = compterPar(prisN1, (r) => r.motifId)
  const classement = [...parMotif.entries()].sort((a, b) => b[1] - a[1])

  const tableau = classement.map(([id, n]) => ({
    libelle: libelle(id),
    valeur: n,
    valeurN1: parMotifN1.get(id) ?? 0,
    evolution: evolution(n, parMotifN1.get(id) ?? 0),
  }))
  // « En plus forte hausse » : seulement sur des effectifs qui ne tiennent pas du hasard.
  const hausse = tableau
    .filter((t) => t.valeurN1 >= SEUIL_HAUSSE && t.evolution !== null && t.evolution > 0)
    .sort((a, b) => b.evolution! - a.evolution!)[0]

  // Les quatre premiers motifs, puis « Autres », seau par seau.
  const tete = classement.slice(0, 4).map(([id]) => id)
  const series = [...tete.map((id) => ({ libelle: libelle(id), ids: [id] })), { libelle: 'Autres', ids: null }]
  const empile = f.seaux.map((s) => {
    const duSeau = pris.filter((r) => f.seauDe(r.debut) === s.cle)
    return {
      ...s,
      valeurs: series.map((se) =>
        se.ids ? duSeau.filter((r) => se.ids.includes(r.motifId)).length : duSeau.filter((r) => !tete.includes(r.motifId)).length,
      ),
    }
  })
  const urgences = pris.filter((r) => motifs.get(r.motifId)?.estUrgence).length

  return {
    total: pris.length,
    premier: tableau[0] ? { libelle: tableau[0].libelle, part: tableau[0].valeur / pris.length } : null,
    hausse: hausse ? { libelle: hausse.libelle, evolution: hausse.evolution! } : null,
    nombreMotifs: parMotif.size,
    partUrgences: taux(urgences, pris.length),
    barres: tableau.map(({ libelle, valeur }) => ({ libelle, valeur })),
    tableau,
    empile: { series: series.map((s) => s.libelle), seaux: empile },
  }
}

// ─── Onglet Absences ──────────────────────────────────────────────────────────

export function calculerAbsences(
  f: Fenetre,
  rdvs: RdvStat[],
  motifs: Map<string, { libelle: string }>,
) {
  const { courant, precedent } = separer(f, rdvs, (r) => r.debut)
  const tenus = courant.filter((r) => estPasseNonAnnule(r, f.fin))
  const tenusN1 = precedent.filter((r) => estPasseNonAnnule(r, f.comparaison.fin))
  const absents = tenus.filter(estAbsent)
  const absentsN1 = tenusN1.filter(estAbsent)
  const tauxDe = (l: RdvStat[]) => taux(l.filter(estAbsent).length, l.length)

  const grille = grilleVide()
  for (const r of tenus) {
    const j = indexJourOuvre(r.debut)
    if (j === null) continue
    const c = grille[j]![indexTranche(r.debut)]!
    c.sur++
    if (estAbsent(r)) c.n++
  }

  const parMotif = [...compterPar(tenus, (r) => r.motifId).entries()]
    .map(([id, n]) => {
      const abs = tenus.filter((r) => r.motifId === id && estAbsent(r)).length
      return { libelle: motifs.get(id)?.libelle ?? '—', rendezVous: n, absences: abs, taux: abs / n }
    })
    .sort((a, b) => b.taux - a.taux || b.rendezVous - a.rendezVous)

  const annules = courant.filter((r) => r.statut === 'ANNULE')

  return {
    taux: tauxDe(tenus),
    tauxN1: tauxDe(tenusN1),
    absences: absents.length,
    absencesN1: absentsN1.length,
    courbe: courbe(f, tenus, tenusN1, (r) => r.debut, (l) => (l.length ? tauxDe(l) : null)),
    chaleur: grille.map((ligne) => ligne.map((c) => ({ valeur: taux(c.n, c.sur), effectif: c.sur }))),
    parMotif,
    annulesParPatient: annules.filter((r) => r.manquement).length,
    annulesParCabinet: annules.filter((r) => !r.manquement).length,
  }
}

// ─── Onglet Prise de rendez-vous ──────────────────────────────────────────────

/** Ici, la période porte sur le jour où le rendez-vous a été PRIS, pas sur celui où il a lieu. */
export function calculerPrise(f: Fenetre, rdvs: RdvStat[], motifs: Map<string, { libelle: string }>) {
  const { courant, precedent } = separer(f, rdvs, (r) => r.creeLe)
  const delaiJours = (r: RdvStat) => Math.max(0, (r.debut.getTime() - r.creeLe.getTime()) / 86_400_000)
  const enLigne = courant.filter((r) => r.enLigne).length

  const parMotif = [...compterPar(courant, (r) => r.motifId).entries()]
    .filter(([, n]) => n >= 3)
    .map(([id]) => ({
      libelle: motifs.get(id)?.libelle ?? '—',
      valeur: Math.round(mediane(courant.filter((r) => r.motifId === id).map(delaiJours))!),
    }))
    .sort((a, b) => b.valeur - a.valeur)

  const grouper = (l: RdvStat[], seau: (t: Date) => string) => compterPar(l, (r) => seau(r.creeLe))
  const enLigneParSeau = grouper(courant.filter((r) => r.enLigne), f.seauDe)
  const cabinetParSeau = grouper(courant.filter((r) => !r.enLigne), f.seauDe)

  return {
    pris: courant.length,
    prisN1: precedent.length,
    partEnLigne: taux(enLigne, courant.length),
    partEnLigneN1: taux(precedent.filter((r) => r.enLigne).length, precedent.length),
    enLigne,
    parSecretariat: courant.length - enLigne,
    delaiMedian: mediane(courant.map(delaiJours)),
    delaiMedianN1: mediane(precedent.map(delaiJours)),
    memeJour: courant.filter((r) => delaiJours(r) < 1).length,
    empile: {
      series: ['En ligne', 'Secrétariat'],
      seaux: f.seaux.map((s) => ({ ...s, valeurs: [enLigneParSeau.get(s.cle) ?? 0, cabinetParSeau.get(s.cle) ?? 0] })),
    },
    delaiParMotif: parMotif,
  }
}

// ─── Onglet Remplissage ───────────────────────────────────────────────────────

function chevauchement(a: { debut: Date; fin: Date }, debut: Date, fin: Date) {
  return minutes(new Date(Math.max(a.debut.getTime(), debut.getTime())), new Date(Math.min(a.fin.getTime(), fin.getTime())))
}

/**
 * Part des heures de présence occupées par un rendez-vous (honoré ou manqué : un absent a bloqué le créneau).
 * Seules les présences déjà écoulées comptent.
 */
export function calculerRemplissage(
  f: Fenetre,
  plages: PlageStat[],
  rdvs: RdvStat[],
  noms: { sites: Map<string, string>; fauteuils: Map<string, string> },
) {
  const occupants = rdvs.filter((r) => r.statut !== 'ANNULE')
  const parPraticienJour = new Map<string, RdvStat[]>()
  for (const r of occupants) {
    const k = `${r.praticienId}|${jourLocal(r.debut)}`
    parPraticienJour.set(k, [...(parPraticienJour.get(k) ?? []), r])
  }

  type Mesure = { plage: PlageStat; presence: number; occupe: number }
  const mesurer = (p: PlageStat): Mesure => {
    const fin = new Date(Math.min(p.fin.getTime(), f.fin.getTime()))
    const duJour = parPraticienJour.get(`${p.praticienId}|${jourLocal(p.debut)}`) ?? []
    const occupe = duJour.reduce((s, r) => s + chevauchement(r, p.debut, fin), 0)
    return { plage: p, presence: minutes(p.debut, fin), occupe: Math.min(occupe, minutes(p.debut, fin)) }
  }
  const { courant, precedent } = separer(f, plages, (p) => p.debut)
  const m = courant.map(mesurer)
  const mN1 = precedent.map(mesurer)
  const tauxDe = (l: Mesure[]) =>
    taux(
      l.reduce((s, x) => s + x.occupe, 0),
      l.reduce((s, x) => s + x.presence, 0),
    )

  const parJour = JOURS_OUVRES.map((libelle, i) => ({
    libelle,
    valeur: tauxDe(m.filter((x) => indexJourOuvre(x.plage.debut) === i)),
  }))

  // Carte de chaleur : on découpe chaque présence et ses rendez-vous en tranches de deux heures.
  const grille = grilleVide()
  for (const x of m) {
    const j = indexJourOuvre(x.plage.debut)
    if (j === null) continue
    const jour = jourLocal(x.plage.debut)
    const fin = new Date(Math.min(x.plage.fin.getTime(), f.fin.getTime()))
    const duJour = parPraticienJour.get(`${x.plage.praticienId}|${jour}`) ?? []
    TRANCHES.forEach((_, t) => {
      const debutTranche = new Date(bornesDuJour(jour).debut.getTime() + (8 + 2 * t) * 3_600_000)
      const finTranche = new Date(debutTranche.getTime() + 2 * 3_600_000)
      const a = new Date(Math.max(x.plage.debut.getTime(), debutTranche.getTime()))
      const b = new Date(Math.min(fin.getTime(), finTranche.getTime()))
      if (b <= a) return
      const c = grille[j]![t]!
      c.sur += minutes(a, b)
      c.n += Math.min(minutes(a, b), duJour.reduce((s, r) => s + chevauchement(r, a, b), 0))
    })
  }

  const parFauteuil = [...new Set(m.map((x) => x.plage.fauteuilId))]
    .map((id) => {
      const l = m.filter((x) => x.plage.fauteuilId === id)
      const p = l[0]!.plage
      return {
        libelle: `${noms.sites.get(p.siteId) ?? '—'} · ${noms.fauteuils.get(id) ?? '—'}`,
        heuresPresence: Math.round(l.reduce((s, x) => s + x.presence, 0) / 60),
        heuresOccupees: Math.round(l.reduce((s, x) => s + x.occupe, 0) / 60),
        taux: tauxDe(l),
      }
    })
    .sort((a, b) => b.heuresPresence - a.heuresPresence)

  const plusCreux = parJour.filter((j) => j.valeur !== null).sort((a, b) => a.valeur! - b.valeur!)[0] ?? null

  return {
    taux: tauxDe(m),
    tauxN1: tauxDe(mN1),
    heuresPresence: Math.round(m.reduce((s, x) => s + x.presence, 0) / 60),
    heuresLibres: Math.round(m.reduce((s, x) => s + x.presence - x.occupe, 0) / 60),
    plusCreux,
    courbe: courbe(f, m, mN1, (x) => x.plage.debut, (l) => tauxDe(l)),
    parJour,
    chaleur: grille.map((ligne) => ligne.map((c) => ({ valeur: taux(c.n, c.sur), effectif: Math.round(c.sur / 60) }))),
    parFauteuil,
  }
}

// ─── Onglet Patients ──────────────────────────────────────────────────────────

export const TRANCHES_AGE = ['Moins de 12 ans', '12 – 17 ans', '18 – 39 ans', '40 – 59 ans', '60 ans et plus'] as const

export function trancheAge(naissance: Date | null, maintenant: Date): number | null {
  if (!naissance) return null
  const n = jourLocal(naissance)
  const a = jourLocal(maintenant)
  const age = Number(a.slice(0, 4)) - Number(n.slice(0, 4)) - (a.slice(5) < n.slice(5) ? 1 : 0)
  return age < 12 ? 0 : age < 18 ? 1 : age < 40 ? 2 : age < 60 ? 3 : 4
}

/**
 * `arrivees` : pour chaque patient reçu au moins une fois (dans la portée de l'appelant), la création de sa fiche.
 * Un patient est « nouveau » l'année où sa fiche est née, pas à sa première visite enregistrée : sinon, toute la
 * patientèle reprise au démarrage du logiciel compterait comme nouvelle au premier mois.
 */
export function calculerPatients(
  f: Fenetre,
  rdvs: RdvStat[],
  arrivees: Map<string, Date>,
  naissances: Map<string, Date | null>,
) {
  const { courant, precedent } = separer(f, rdvs, (r) => r.debut)
  const hon = courant.filter((r) => estHonore(r, f.fin))
  const honN1 = precedent.filter((r) => estHonore(r, f.comparaison.fin))

  const visites = compterPar(hon, (r) => r.patientId)
  const recus = visites.size
  const recusN1 = new Set(honN1.map((r) => r.patientId)).size

  const fiches = [...arrivees.entries()].map(([patientId, creeLe]) => ({ patientId, creeLe }))
  const { courant: nouveaux, precedent: nouveauxN1 } = separer(f, fiches, (p) => p.creeLe)

  const ages = TRANCHES_AGE.map((libelle) => ({ libelle, valeur: 0 }))
  let ageInconnu = 0
  for (const id of visites.keys()) {
    const t = trancheAge(naissances.get(id) ?? null, f.fin)
    if (t === null) ageInconnu++
    else ages[t]!.valeur++
  }

  return {
    recus,
    recusN1,
    nouveaux: nouveaux.length,
    nouveauxN1: nouveauxN1.length,
    revenus: [...visites.values()].filter((n) => n >= 2).length,
    frequence: ['1 visite', '2 visites', '3 visites', '4 visites et plus'].map((libelle, i) => ({
      libelle,
      valeur: [...visites.values()].filter((n) => (i === 3 ? n >= 4 : n === i + 1)).length,
    })),
    courbe: courbe(f, nouveaux, nouveauxN1, (p) => p.creeLe, (l) => l.length),
    ages,
    ageInconnu,
  }
}
