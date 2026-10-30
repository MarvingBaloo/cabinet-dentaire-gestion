// Jours fériés du cabinet (compléments d'agenda, lot 2 — Q29, Q30).
//
// ⚠ Liste à confirmer par le cabinet (Q30) : Marving a tranché les 11 fériés
// légaux français plus le 27 mai (abolition de l'esclavage en Guadeloupe),
// RIEN d'autre — ni Vendredi saint, ni Mardi gras, ni aucune fête coutumière.
// Le cabinet n'a pas encore validé cette liste.
//
// Ni `'use client'` ni `server-only` — même règle que `src/lib/dates.ts` et
// `src/lib/statuts.ts` : lu par le domaine des présences (fermeture par
// défaut d'un jour férié, `src/server/domaine/presences.ts`) ET par l'écran
// Présences, côté client, pour afficher les fériés à venir. Exportée depuis un
// fichier `'use client'`, une constante n'arrive pas dans un composant serveur
// (CLAUDE.md).

import { decalerJour } from './dates'

export type JourFerie = { date: string; libelle: string }

/**
 * Dimanche de Pâques, calendrier grégorien — algorithme de Meeus/Butcher.
 * Pâques lui-même n'est pas un jour férié en France ; il sert d'ancre pour
 * calculer le lundi de Pâques, l'Ascension et le lundi de Pentecôte.
 */
function datePaques(annee: number): string {
  const a = annee % 19
  const b = Math.floor(annee / 100)
  const c = annee % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const numerateur = h + l - 7 * m + 114
  const mois = Math.floor(numerateur / 31) // 3 = mars, 4 = avril
  const jour = (numerateur % 31) + 1
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

/**
 * Les jours fériés d'UNE année civile, triés. Les 11 fériés légaux français,
 * plus le 27 mai — rien d'autre (voir l'avertissement en tête de fichier).
 */
export function joursFeriesAnnee(annee: number): JourFerie[] {
  const paques = datePaques(annee)
  return [
    { date: `${annee}-01-01`, libelle: 'Jour de l’an' },
    { date: decalerJour(paques, 1), libelle: 'Lundi de Pâques' },
    { date: `${annee}-05-01`, libelle: 'Fête du travail' },
    { date: `${annee}-05-08`, libelle: 'Victoire 1945' },
    { date: `${annee}-05-27`, libelle: 'Abolition de l’esclavage (Guadeloupe)' },
    { date: decalerJour(paques, 39), libelle: 'Ascension' },
    { date: decalerJour(paques, 50), libelle: 'Lundi de Pentecôte' },
    { date: `${annee}-07-14`, libelle: 'Fête nationale' },
    { date: `${annee}-08-15`, libelle: 'Assomption' },
    { date: `${annee}-11-01`, libelle: 'Toussaint' },
    { date: `${annee}-11-11`, libelle: 'Armistice' },
    { date: `${annee}-12-25`, libelle: 'Noël' },
  ].sort((x, y) => (x.date < y.date ? -1 : 1))
}

// Calcul déterministe, sans horloge : un cache par année ne fait donc courir
// aucun risque de valeur périmée, seulement d'éviter de refaire cinq fois le
// même calcul sur un horizon de deux mois qui tient parfois sur deux années.
const cacheParAnnee = new Map<number, JourFerie[]>()
function feriesAnnee(annee: number): JourFerie[] {
  let feries = cacheParAnnee.get(annee)
  if (!feries) {
    feries = joursFeriesAnnee(annee)
    cacheParAnnee.set(annee, feries)
  }
  return feries
}

/** `jour` ("AAAA-MM-JJ") tombe-t-il un jour férié ? */
export function estJourFerie(jour: string): boolean {
  return feriesAnnee(Number(jour.slice(0, 4))).some((f) => f.date === jour)
}

/** Le libellé du jour férié, ou `null` si `jour` n'en est pas un. */
export function libelleFerie(jour: string): string | null {
  return feriesAnnee(Number(jour.slice(0, 4))).find((f) => f.date === jour)?.libelle ?? null
}

/** Les jours fériés entre `debut` et `fin` INCLUS (bornes "AAAA-MM-JJ"). */
export function joursFeriesEntre(debut: string, fin: string): JourFerie[] {
  const anneeDebut = Number(debut.slice(0, 4))
  const anneeFin = Number(fin.slice(0, 4))
  const resultat: JourFerie[] = []
  for (let annee = anneeDebut; annee <= anneeFin; annee++) {
    for (const f of feriesAnnee(annee)) {
      if (f.date >= debut && f.date <= fin) resultat.push(f)
    }
  }
  return resultat.sort((a, b) => (a.date < b.date ? -1 : 1))
}
