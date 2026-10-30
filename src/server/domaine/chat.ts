import { decalerJour, heureCabinet, jourEnCourt, jourEnToutesLettres, jourLocal } from '@/lib/dates'

// Le chat interne (D82) : ce qui se calcule sans base, testé à part.

/** La paire rangée d'une conversation : une seule entre deux personnes, quel que soit celui qui écrit le premier. */
export function paire(moi: string, collegue: string): { userAId: string; userBId: string } {
  return moi < collegue ? { userAId: moi, userBId: collegue } : { userAId: collegue, userBId: moi }
}

/** L'heure d'un message dans la liste des conversations : « 10:14 », « hier », « lun. 26 oct. ». */
export function quandCourt(instant: Date, maintenant: Date): string {
  const jour = jourLocal(instant)
  const aujourdhui = jourLocal(maintenant)
  if (jour === aujourdhui) return heureCabinet(instant)
  if (jour === decalerJour(aujourdhui, -1)) return 'hier'
  return jourEnCourt(jour)
}

/** Le séparateur des jours dans une conversation : « Aujourd'hui », « Hier », « Lundi 26 octobre 2026 ». */
export function separateurJour(jour: string, maintenant: Date): string {
  const aujourdhui = jourLocal(maintenant)
  if (jour === aujourdhui) return 'Aujourd’hui'
  if (jour === decalerJour(aujourdhui, -1)) return 'Hier'
  const texte = jourEnToutesLettres(jour)
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}
