import { z } from 'zod'

// Liste d'attente (lot D, D29). Même remarque que pour le reste du dépôt : Zod
// vérifie la forme, le service revérifie ce qui est vrai du cabinet — motif
// actif, site existant, patient non bloqué (D21).

export const inscrireListeAttenteSchema = z.object({
  motifId: z.uuid(),
  siteId: z.uuid(),
  /** Facultatif : « peu importe qui », comme à la réservation. */
  praticienId: z.uuid().optional(),
})

export type InscrireListeAttenteInput = z.infer<typeof inscrireListeAttenteSchema>

export const desinscrireListeAttenteSchema = z.object({ id: z.uuid() })

export type DesinscrireListeAttenteInput = z.infer<typeof desinscrireListeAttenteSchema>
