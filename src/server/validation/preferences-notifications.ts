import { z } from 'zod'

// Préférences patient par canal (phase 4, lot 5b, D44). Comme le reste du
// portail : Zod vérifie la forme, le service revérifie ce qui est vrai — ici
// surtout que l'adresse e-mail, si des préférences la concernent, appartient
// bien au numéro authentifié par le jeton (jamais reçue du navigateur).

const preferenceCanalSchema = z.object({
  rappels: z.boolean(),
  nonEssentiels: z.boolean(),
})

export const enregistrerPreferencesSchema = z.object({
  sms: preferenceCanalSchema,
  // Absent : la page n'a proposé aucun canal e-mail pour ce numéro (pas
  // d'adresse connue) — aucune préférence e-mail n'est touchée.
  email: preferenceCanalSchema.optional(),
})

export type EnregistrerPreferencesInput = z.infer<typeof enregistrerPreferencesSchema>
