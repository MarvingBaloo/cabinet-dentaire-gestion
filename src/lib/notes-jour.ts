export const TEXTE_NOTE_MAX = 280

/** Une colonne @db.Date revient à minuit UTC : on la lit en UTC, jamais avec
 *  `jourLocal`, qui reculerait d'un jour. */
export function jourVersDateNote(jour: string): Date {
  return new Date(`${jour}T00:00:00.000Z`)
}

export function dateNoteVersJour(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export type NoteJourVue = {
  id: string
  jour: string
  texte: string
  site: { id: string; code: string; nom: string }
  /** « Prénom NOM » */
  auteur: string
  /** Date ISO de `updatedAt`. */
  modifieeLe: string
}
