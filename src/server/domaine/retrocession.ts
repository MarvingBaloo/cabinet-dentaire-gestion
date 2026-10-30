import { bornesDuJour, jourLocal } from '@/lib/dates'

// La rétrocession (D81), sans base : ce que le titulaire reverse à chaque praticien pour un mois, c'est le total
// des soins passés en caisse dans le mois (au montant validé) multiplié par sa part.

/** « AAAA-MM » du mois du cabinet où tombe cet instant. */
export function moisDe(instant: Date): string {
  return jourLocal(instant).slice(0, 7)
}

/** Le mois d'une adresse s'il est bien formé, sinon le mois en cours. */
export function moisValide(demande: string | undefined, maintenant: Date): string {
  return demande && /^\d{4}-(0[1-9]|1[0-2])$/.test(demande) ? demande : moisDe(maintenant)
}

/** Le premier instant du mois et le premier du suivant, heure du cabinet. */
export function bornesMois(mois: string): { debut: Date; fin: Date } {
  const premier = `${mois}-01`
  const suivant = decalerMois(mois, 1)
  return { debut: bornesDuJour(premier).debut, fin: bornesDuJour(`${suivant}-01`).debut }
}

export function decalerMois(mois: string, n: number): string {
  const [a, m] = mois.split('-').map(Number) as [number, number]
  const total = a * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Ce qui revient au praticien : sa part du total, arrondie au centime. */
export function partDe(totalCentimes: number, part: number): number {
  return Math.round((totalCentimes * part) / 100)
}

const moisFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
/** « Octobre 2026 ». */
export function moisEnClair(mois: string): string {
  const texte = moisFormat.format(new Date(`${mois}-15T12:00:00Z`))
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}
