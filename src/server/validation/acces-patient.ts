import { z } from 'zod'

import { telephoneSaisi } from './telephone'

// Le numéro est la seule identité du patient (D8) : il se valide comme celui
// d'une réservation, ni plus ni moins strictement — une règle plus sévère ici
// empêcherait d'annuler un rendez-vous qu'on a pu prendre.
// Sans la conversion vers le format international, « 0690… » ne retrouvait
// personne et l'écran annonçait quand même un code envoyé.
const telephone = telephoneSaisi

export const demanderAccesSchema = z.object({ telephone })

export const verifierAccesSchema = z.object({
  telephone,
  code: z.string().trim().regex(/^\d{6}$/, 'le code compte six chiffres'),
})

export const annulerParPatientSchema = z.object({ rendezVousId: z.uuid() })

export const creneauxPourDeplacementSchema = z.object({ rendezVousId: z.uuid() })

// Même forme que `demarrerReservationSchema` (validation/reservation.ts) pour
// l'instant : Zod vérifie la forme, le service revérifie ce qui est vrai du
// cabinet — même motif, même site, horizon, praticien qualifié (D28).
const instant = z.union([z.iso.datetime(), z.date()]).pipe(z.coerce.date())

export const deplacerParPatientSchema = z.object({
  rendezVousId: z.uuid(),
  nouveauDebut: instant,
  nouveauPraticienId: z.uuid(),
})

export type DemanderAccesInput = z.infer<typeof demanderAccesSchema>
export type VerifierAccesInput = z.infer<typeof verifierAccesSchema>
