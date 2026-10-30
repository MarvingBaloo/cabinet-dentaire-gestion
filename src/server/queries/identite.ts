import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'

export type Identite = { prenom: string; nom: string; praticienId: string | null; chatSonCoupe: boolean }

/** Le nom de la personne connectée, pour la saluer et pour ses initiales. */
export async function lireIdentite(ctx: AuthContext): Promise<Identite> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { prenom: true, nom: true, chatSonCoupe: true, praticien: { select: { id: true } } },
  })
  return { prenom: user.prenom, nom: user.nom, praticienId: user.praticien?.id ?? null, chatSonCoupe: user.chatSonCoupe }
}
