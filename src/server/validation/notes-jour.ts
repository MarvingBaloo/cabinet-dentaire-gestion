import { z } from 'zod'

import { instantCabinet } from '@/lib/dates'
import { TEXTE_NOTE_MAX, dateNoteVersJour, jourVersDateNote } from '@/lib/notes-jour'

const texte = z
  .string()
  .trim()
  .min(1, 'La note est vide.')
  .max(TEXTE_NOTE_MAX, `La note dépasse ${TEXTE_NOTE_MAX} caractères.`)

const jour = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Jour invalide.')
  // Le détour par la date écarte « 2026-02-31 », que `Date` reporterait au mois suivant.
  .refine(
    (j) => instantCabinet(j, '00:00') !== null && dateNoteVersJour(jourVersDateNote(j)) === j,
    'Jour invalide.',
  )

export const creerNoteJourSchema = z.object({ siteId: z.uuid(), jour, texte })
export const modifierNoteJourSchema = z.object({ id: z.uuid(), texte })
export const supprimerNoteJourSchema = z.object({ id: z.uuid() })

export type CreerNoteJourInput = z.infer<typeof creerNoteJourSchema>
export type ModifierNoteJourInput = z.infer<typeof modifierNoteJourSchema>
export type SupprimerNoteJourInput = z.infer<typeof supprimerNoteJourSchema>
