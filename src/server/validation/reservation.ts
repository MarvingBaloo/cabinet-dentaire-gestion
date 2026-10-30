import { z } from 'zod'

import { telephoneSaisi } from './telephone'

// Validation de ce qui arrive du portail public — donc de n'importe qui.
//
// Ce qui n'est PAS validé ici : que le créneau soit libre, que le praticien
// pratique l'acte, que le site existe. Zod vérifie la forme ; le domaine et le
// service vérifient ce qui est vrai du cabinet (D11).

const instant = z.union([z.iso.datetime(), z.date()]).pipe(z.coerce.date())

// « 0690… » est guadeloupéen, « 06… » métropolitain : la règle commune tranche.
const telephone = telephoneSaisi

export const demarrerReservationSchema = z.object({
  motifId: z.uuid(),
  praticienId: z.uuid(),
  siteId: z.uuid(),
  debut: instant,
  nom: z.string().trim().min(1, 'nom requis').max(100),
  prenom: z.string().trim().min(1, 'prénom requis').max(100),
  telephone,
})

export type DemarrerReservationInput = z.infer<typeof demarrerReservationSchema>

export const confirmerReservationSchema = z.object({
  id: z.uuid(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'code à six chiffres'),
})

export type ConfirmerReservationInput = z.infer<typeof confirmerReservationSchema>
