import { CanalNotification } from '@prisma/client'
import { z } from 'zod'

import { TYPES_MODELISABLES, type TypeModelisable } from '@/lib/modeles-messages'

// Vérifie la FORME de la saisie — le fond (champ de fusion connu et
// disponible pour ce type, longueur en SMS) revient à `validerModele`
// (src/lib/modeles-messages.ts), rejoué côté serveur dans le service, jamais
// sur la seule foi de ce schéma.

const typeModelisableSchema = z.enum(
  TYPES_MODELISABLES as unknown as [TypeModelisable, ...TypeModelisable[]],
)

export const enregistrerModeleMessageSchema = z.object({
  type: typeModelisableSchema,
  canal: z.enum(CanalNotification),
  /** Chaîne vide traitée comme absente : un sujet ne s'écrit que pour l'e-mail. */
  sujet: z.string().trim().max(200).optional(),
  corps: z.string().trim().min(1, 'Le corps du message ne peut pas être vide.').max(2000),
})

export type EnregistrerModeleMessageInput = z.infer<typeof enregistrerModeleMessageSchema>

export const reinitialiserModeleMessageSchema = z.object({
  type: typeModelisableSchema,
  canal: z.enum(CanalNotification),
})

export type ReinitialiserModeleMessageInput = z.infer<typeof reinitialiserModeleMessageSchema>
