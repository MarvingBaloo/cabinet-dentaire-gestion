import 'server-only'

import { cookies } from 'next/headers'

import type { AuthContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'

export const NOM_COOKIE_CABINET = 'cabinet'

export type CabinetAccessible = { id: string; code: string; nom: string }

/**
 * Cabinets que l'appelant peut voir (D5) : tous pour une portée globale, sinon
 * ses seuls rattachements — en activité seulement (D74). Une absence de
 * rattachement ne donne rien à voir.
 */
export async function listerCabinetsAccessibles(ctx: AuthContext): Promise<CabinetAccessible[]> {
  return prisma.site.findMany({
    where: { id: { in: [...ctx.sitesAutorises] } },
    select: { id: true, code: true, nom: true },
    orderBy: { code: 'desc' },
  })
}

/**
 * Le cabinet affiché en haut à droite, retenu d'un écran à l'autre. Un cookie
 * qui désigne un cabinet hors portée — rattachement retiré entre-temps — est
 * ignoré : le premier cabinet accessible prend sa place.
 */
export async function lireCabinetChoisi(
  ctx: AuthContext,
): Promise<{ choisi: CabinetAccessible | null; cabinets: CabinetAccessible[] }> {
  const cabinets = await listerCabinetsAccessibles(ctx)
  const jar = await cookies()
  const demande = jar.get(NOM_COOKIE_CABINET)?.value
  const choisi = cabinets.find((c) => c.id === demande) ?? cabinets[0] ?? null
  return { choisi, cabinets }
}
