// Fuseau du cabinet. UTC-4 toute l'année, sans changement d'heure (D10).
//
// ⚠ TOUT ce fichier repose sur cette absence de changement d'heure. Le décalage
// fixe de quatre heures permet de convertir sans bibliothèque ; le jour où ce
// code servirait pour un fuseau à heure d'été, il faudrait une vraie
// bibliothèque de dates, pas un ajustement de constante.
//
// Ce n'est pas ce que D10 recommande — elle demande une bibliothèque de dates
// plutôt que `Date` natif. Aucune n'est installée à ce jour, et ajouter une
// dépendance se demande. En attendant, l'arithmétique reste cantonnée ici, sur
// des opérations que le décalage fixe rend sûres.

export const FUSEAU_CABINET = 'America/Guadeloupe'
const DECALAGE_MS = 4 * 60 * 60 * 1000

/** Le jour civil au cabinet, en `AAAA-MM-JJ`, pour un instant donné. */
export function jourLocal(instant: Date): string {
  return new Date(instant.getTime() - DECALAGE_MS).toISOString().slice(0, 10)
}

/** Aujourd'hui au cabinet — pas forcément le même jour qu'à Paris. */
export function aujourdHuiLocal(): string {
  return jourLocal(new Date())
}

/** Bornes UTC d'une journée civile du cabinet : `[minuit, minuit du lendemain)`. */
export function bornesDuJour(jour: string): { debut: Date; fin: Date } {
  const debut = new Date(`${jour}T00:00:00.000Z`).getTime() + DECALAGE_MS
  return { debut: new Date(debut), fin: new Date(debut + 86_400_000) }
}

/**
 * L'instant correspondant à une date et une heure lues au cabinet.
 *
 * C'est la conversion inverse de l'affichage : la secrétaire tape `09:30` en
 * pensant « 9h30 ici », et la base stocke de l'UTC. Sans ce passage, le
 * rendez-vous atterrit quatre heures trop tôt — à 5h30 du matin, donc hors des
 * heures de présence, et le domaine le refuse pour une raison qui n'a rien à
 * voir avec ce que la saisie avait de faux.
 *
 * Rend `null` sur une saisie malformée plutôt que de lever : l'appelant est un
 * formulaire, il doit pouvoir répondre « heure invalide » et non planter.
 */
export function instantCabinet(jour: string, heure: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null
  const m = /^(\d{2}):(\d{2})$/.exec(heure)
  if (!m) return null

  const heures = Number(m[1])
  const minutes = Number(m[2])
  if (heures > 23 || minutes > 59) return null

  const minuit = bornesDuJour(jour).debut
  if (Number.isNaN(minuit.getTime())) return null

  return new Date(minuit.getTime() + (heures * 60 + minutes) * 60_000)
}

/** Décale un jour civil de `n` jours. */
export function decalerJour(jour: string, n: number): string {
  const t = new Date(`${jour}T12:00:00.000Z`).getTime() + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

const heureFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  hour: '2-digit',
  minute: '2-digit',
})

const jourFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/** « 09:30 » à l'heure du cabinet. */
export function heureCabinet(instant: Date): string {
  return heureFormat.format(instant)
}

/** « lundi 5 avril 2027 » à l'heure du cabinet. */
export function jourEnToutesLettres(jour: string): string {
  return jourFormat.format(bornesDuJour(jour).debut)
}

/** Minutes écoulées depuis minuit au cabinet — sert à positionner un bloc. */
export function minutesDepuisMinuit(instant: Date, jour: string): number {
  return Math.round((instant.getTime() - bornesDuJour(jour).debut.getTime()) / 60_000)
}

const heureLocaleFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSEAU_CABINET,
  hour: 'numeric',
  hourCycle: 'h23',
})

/** L'heure (0-23) au cabinet pour un instant donné — sert aux fenêtres d'envoi. */
export function heureLocale(instant: Date): number {
  return Number(heureLocaleFormat.format(instant))
}

/**
 * La liste d'attente n'envoie pas de SMS entre 21h et 8h, heure du cabinet
 * (lot D, D29) : personne ne veut recevoir « une place s'est libérée » au
 * milieu de la nuit pour un rendez-vous qu'il ne prendra pas avant demain.
 */
export function dansLaFenetreEnvoi(instant: Date): boolean {
  const h = heureLocale(instant)
  return h >= 8 && h < 21
}

/**
 * Le prochain 8h du cabinet, à partir de `instant` — jamais dans le passé.
 *
 * Sert à programmer un envoi tombé dans la plage fermée (21h-8h) : un appel à
 * 22h30 rend 8h le lendemain, un appel à 3h rend 8h le jour même.
 */
export function prochainHuitHeures(instant: Date): Date {
  const jour = jourLocal(instant)
  const huitAujourdHui = instantCabinet(jour, '08:00') as Date
  if (instant.getTime() < huitAujourdHui.getTime()) return huitAujourdHui
  return instantCabinet(decalerJour(jour, 1), '08:00') as Date
}

// ─── Horaires d'ouverture dérivés (lot E, D34) ─────────────────────────────

/**
 * Un jour par index JS (`Date.getUTCDay()`, 0 = dimanche) : le libellé affiché
 * et le nom anglais attendu par `DayOfWeek` (schema.org, JSON-LD `Dentist`,
 * lot F) — ce dernier est une énumération du vocabulaire, pas une traduction.
 * Un seul tableau plutôt que deux parallèles : indexer l'un sans l'autre ne
 * peut alors plus désynchroniser les deux noms d'un même jour.
 */
const JOURS_SEMAINE = [
  { jour: 'Dimanche', jourSchemaOrg: 'Sunday' },
  { jour: 'Lundi', jourSchemaOrg: 'Monday' },
  { jour: 'Mardi', jourSchemaOrg: 'Tuesday' },
  { jour: 'Mercredi', jourSchemaOrg: 'Wednesday' },
  { jour: 'Jeudi', jourSchemaOrg: 'Thursday' },
  { jour: 'Vendredi', jourSchemaOrg: 'Friday' },
  { jour: 'Samedi', jourSchemaOrg: 'Saturday' },
] as const

/** Lundi d'abord, comme le lit un patient — pas l'ordre JS où dimanche vaut 0. */
const ORDRE_AFFICHAGE_SEMAINE = [1, 2, 3, 4, 5, 6, 0]

export type IntervalleMinutes = { debut: number; fin: number }

export type HoraireJour = {
  jour: string
  /** Pour `openingHoursSpecification` (schema.org), voir `JOURS_SCHEMA_ORG`. */
  jourSchemaOrg: (typeof JOURS_SEMAINE)[number]['jourSchemaOrg']
  intervalles: IntervalleMinutes[]
}

/** « 7h30 » à l'heure du cabinet — pour l'affichage, jamais pour le JSON-LD. */
export function formatHeureMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** « 07:30 » — format attendu par `opens`/`closes` du JSON-LD `Dentist` (lot F). */
export function formatHeureMinutesISO(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * L'inverse de `formatHeureMinutesISO` : « 09:30 » → 570. `null` sur une saisie
 * malformée — même convention que `instantCabinet`, dont c'est la brique.
 *
 * Sans jour associé : sert la semaine type des présences (compléments
 * d'agenda, lot 1), où l'heure ne dépend d'aucune date précise.
 */
export function heureMinutesDepuisHHMM(heure: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(heure)
  if (!m) return null
  const heures = Number(m[1])
  const minutes = Number(m[2])
  if (heures > 23 || minutes > 59) return null
  return heures * 60 + minutes
}

/**
 * Horaires d'ouverture d'un cabinet, déduits des plages de présence
 * effectivement posées en base — jamais écrits en dur (D34). Regroupe par
 * jour de semaine du cabinet, fusionne les plages qui se chevauchent ou se
 * touchent, et rend un jour absent plutôt qu'un « fermé » que rien ne vient
 * confirmer.
 *
 * Pure : ne lit pas l'horloge, se contente des plages qu'on lui donne — c'est
 * à l'appelant de les avoir bornées à la fenêtre qui l'intéresse.
 *
 * Simplification assumée, sans plage connue qui la mette en défaut à ce jour :
 * une plage qui déborderait sur le jour suivant est coupée à minuit plutôt que
 * scindée en deux lignes — ce cabinet n'a pas de plage à cheval sur minuit.
 */
export function horairesOuvertureCabinet(plages: { debut: Date; fin: Date }[]): HoraireJour[] {
  const parJour = new Map<number, IntervalleMinutes[]>()

  for (const p of plages) {
    const jour = jourLocal(p.debut)
    const indexSemaine = new Date(p.debut.getTime() - DECALAGE_MS).getUTCDay()
    const debut = minutesDepuisMinuit(p.debut, jour)
    const fin = Math.min(minutesDepuisMinuit(p.fin, jour), 24 * 60)
    if (fin <= debut) continue

    const liste = parJour.get(indexSemaine) ?? []
    liste.push({ debut, fin })
    parJour.set(indexSemaine, liste)
  }

  const resultat: HoraireJour[] = []
  for (const indexSemaine of ORDRE_AFFICHAGE_SEMAINE) {
    const intervalles = parJour.get(indexSemaine)
    if (!intervalles || intervalles.length === 0) continue

    const tries = [...intervalles].sort((a, b) => a.debut - b.debut)
    const fusion: IntervalleMinutes[] = []
    for (const c of tries) {
      const dernier = fusion.at(-1)
      if (dernier && c.debut <= dernier.fin) {
        dernier.fin = Math.max(dernier.fin, c.fin)
      } else {
        fusion.push({ ...c })
      }
    }

    // `indexSemaine` vient de `ORDRE_AFFICHAGE_SEMAINE`, toujours 0-6 : l'accès
    // ne peut pas manquer, mais `noUncheckedIndexedAccess` ne le sait pas.
    const { jour, jourSchemaOrg } = JOURS_SEMAINE[indexSemaine]!
    resultat.push({ jour, jourSchemaOrg, intervalles: fusion })
  }

  return resultat
}

// ─── Semaine et mois (vues de l'agenda, lot 4) ─────────────────────────────

function indexSemaineJour(jour: string): number {
  return new Date(`${jour}T12:00:00.000Z`).getUTCDay()
}

/** Le lundi de la semaine civile du cabinet contenant `jour`. */
export function lundiDeSemaine(jour: string): string {
  const idx = indexSemaineJour(jour)
  // Dimanche vaut 0 en JS : le ramener à -6 plutôt qu'à +1 le remet dans la
  // semaine qui vient de se terminer, pas dans celle qui commence.
  const decalage = idx === 0 ? -6 : 1 - idx
  return decalerJour(jour, decalage)
}

/**
 * `n` jours consécutifs à partir du lundi de la semaine de `jour`.
 *
 * Par défaut 6 (lundi→samedi) : les deux sites du cabinet sont fermés le
 * dimanche — Marie-Galante du lundi au samedi, la Guadeloupe le vendredi
 * seulement (CLAUDE.md) — c'est une fermeture systématique, pas une absence
 * de données à constater semaine après semaine. Passer `n: 7` rend la semaine
 * complète, utile pour border une grille mensuelle.
 */
export function joursSemaineAffiches(jour: string, n = 6): string[] {
  const lundi = lundiDeSemaine(jour)
  return Array.from({ length: n }, (_, i) => decalerJour(lundi, i))
}

/** Premier jour du mois civil du cabinet contenant `jour`. */
export function premierJourMois(jour: string): string {
  return `${jour.slice(0, 7)}-01`
}

/** Dernier jour du mois civil du cabinet contenant `jour`. */
export function dernierJourMois(jour: string): string {
  const annee = Number(jour.slice(0, 4))
  const mois = Number(jour.slice(5, 7))
  const premierDuSuivant =
    mois === 12 ? `${annee + 1}-01-01` : `${annee}-${String(mois + 1).padStart(2, '0')}-01`
  return decalerJour(premierDuSuivant, -1)
}

/** Le premier jour du mois précédent celui de `jour` — ancre de navigation. */
export function moisPrecedent(jour: string): string {
  return decalerJour(premierJourMois(jour), -1)
}

/** Le premier jour du mois suivant celui de `jour` — ancre de navigation. */
export function moisSuivant(jour: string): string {
  return decalerJour(dernierJourMois(jour), 1)
}

/**
 * La grille calendaire complète du mois de `jour` : des semaines de 7 jours
 * (lundi→dimanche), débordant sur le mois précédent et le suivant pour
 * compléter la première et la dernière semaine — la mise en page usuelle d'un
 * calendrier mensuel.
 */
export function grilleMois(jour: string): string[][] {
  const debutGrille = lundiDeSemaine(premierJourMois(jour))
  const finGrille = decalerJour(lundiDeSemaine(dernierJourMois(jour)), 6)

  const semaines: string[][] = []
  let curseur = debutGrille
  while (curseur <= finGrille) {
    semaines.push(Array.from({ length: 7 }, (_, i) => decalerJour(curseur, i)))
    curseur = decalerJour(curseur, 7)
  }
  return semaines
}

const jourCourtFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

/** « lun. 5 avr. » à l'heure du cabinet — en-tête compact d'une colonne de semaine. */
export function jourEnCourt(jour: string): string {
  return jourCourtFormat.format(bornesDuJour(jour).debut)
}

const moisFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  month: 'long',
  year: 'numeric',
})

/** « avril 2027 » à l'heure du cabinet. */
export function moisEnToutesLettres(jour: string): string {
  return moisFormat.format(bornesDuJour(jour).debut)
}

const jourMoisCourtFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  day: 'numeric',
  month: 'short',
})

/**
 * « 12 oct. → 17 oct. 2026 » : la plage d'une semaine affichée. L'année suit
 * la dernière date ; elle est aussi donnée à la première quand la semaine
 * enjambe deux années.
 */
export function plageSemaineCourte(jours: string[]): string {
  const premier = jours[0]
  const dernier = jours.at(-1)
  if (!premier || !dernier) return ''
  const debut = jourMoisCourtFormat.format(bornesDuJour(premier).debut)
  const fin = jourMoisCourtFormat.format(bornesDuJour(dernier).debut)
  const anneeFin = dernier.slice(0, 4)
  const anneeDebut = premier.slice(0, 4)
  return `${debut}${anneeDebut === anneeFin ? '' : ` ${anneeDebut}`} → ${fin} ${anneeFin}`
}
