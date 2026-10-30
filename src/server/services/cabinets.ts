import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { recordAudit, recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// Cabinets en activité (D74). Décoché, un cabinet n'existe plus pour personne — site public, réservation,
// espace du cabinet — sauf ici, d'où l'administrateur le réactive. Ses rendez-vous, présences et réglages restent.

export class DernierCabinetError extends Error {
  constructor() {
    super('Il faut au moins un cabinet en activité.')
    this.name = 'DernierCabinetError'
  }
}

/** Tous les cabinets, décochés compris : c'est le seul écran qui les montre. */
export async function listerCabinetsReglage(ctx: AuthContext) {
  await requirePermission(ctx, 'site', 'update')
  const cabinets = await prisma.site.findMany({
    select: { id: true, code: true, nom: true, actif: true, _count: { select: { fauteuils: true } } },
    orderBy: { code: 'desc' },
  })
  await recordRead(ctx, 'site', cabinets.length)
  return cabinets
}

export async function changerActiviteCabinet(ctx: AuthContext, siteId: string, actif: boolean): Promise<void> {
  await requirePermission(ctx, 'site', 'update')
  await prisma.$transaction(async (tx) => {
    // Le dernier cabinet ne se décoche pas : l'agenda, le site et la réservation n'auraient plus rien à montrer.
    if (!actif && (await tx.site.count({ where: { actif: true, id: { not: siteId } } })) === 0) {
      throw new DernierCabinetError()
    }
    await tx.site.update({ where: { id: siteId }, data: { actif } })
    await recordAudit(tx, ctx, { action: 'UPDATE', entityType: 'site', entityId: siteId, metadata: { actif } })
  })
}
