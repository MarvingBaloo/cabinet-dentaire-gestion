import { z } from 'zod'

import { versInternational } from '@/lib/telephone'

// Un seul numéro de téléphone pour tout le logiciel (tour de l'application du
// 20/10) : la réservation en ligne refusait « 0690… » que l'accès patient
// acceptait, et la fiche créée au comptoir gardait « 0690 55 44 33 » tel quel —
// un numéro auquel aucun SMS ne part. Tapé comme on en a l'habitude, il est
// ramené au format international sous lequel les fiches sont enregistrées.
export const telephoneSaisi = z
  .string()
  .trim()
  .min(6, 'Numéro trop court.')
  .max(30, 'Numéro trop long.')
  .regex(/^[+0-9 .\-()]+$/, 'Numéro invalide.')
  .transform(versInternational)
  .pipe(
    z
      .string()
      .regex(
        /^\+[1-9]\d{7,14}$/,
        'Numéro invalide : tapez-le comme d’habitude (0690 12 34 56) ou avec l’indicatif (+590…).',
      ),
  )

/** Facultatif : chaîne vide → `null`, sinon même règle. */
export const telephoneFacultatif = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(telephoneSaisi.nullable())
