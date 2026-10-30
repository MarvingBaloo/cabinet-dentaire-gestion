'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { exigerContexte } from '@/server/auth/session-courante'
import { type CitationTrouvee, chercherCitations, compterNonLus } from '@/server/queries/chat'
import { ChatError, LONGUEUR_MAX_MESSAGE, envoyerMessage, marquerLu, reglerSon } from '@/server/services/chat'

// Le chat interne (D82) : Server Actions minces, les gardes sont dans le service.

const envoiSchema = z.object({
  collegueId: z.uuid(),
  texte: z.string().max(LONGUEUR_MAX_MESSAGE * 2),
  cite: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('patient'), id: z.uuid() }),
      z.object({ type: z.literal('rendezVous'), id: z.uuid() }),
    ])
    .nullable(),
})

export async function envoyerMessageAction(entree: unknown): Promise<{ erreur?: string }> {
  const ctx = await exigerContexte()
  const saisie = envoiSchema.safeParse(entree)
  if (!saisie.success) return { erreur: 'Message invalide.' }
  try {
    await envoyerMessage(ctx, saisie.data)
  } catch (e) {
    if (e instanceof ChatError) return { erreur: e.message }
    throw e
  }
  revalidatePath('/tableau-de-bord/chat', 'layout')
  return {}
}

export async function marquerLuAction(collegueId: string): Promise<number> {
  const ctx = await exigerContexte()
  if (!z.uuid().safeParse(collegueId).success) return compterNonLus(ctx)
  await marquerLu(ctx, collegueId)
  return compterNonLus(ctx)
}

export async function compterNonLusAction(): Promise<number> {
  return compterNonLus(await exigerContexte())
}

export async function reglerSonAction(coupe: boolean): Promise<void> {
  await reglerSon(await exigerContexte(), coupe === true)
}

export async function chercherCitationsAction(terme: string): Promise<CitationTrouvee[]> {
  const ctx = await exigerContexte()
  if (typeof terme !== 'string' || terme.length > 60) return []
  return chercherCitations(ctx, terme)
}
