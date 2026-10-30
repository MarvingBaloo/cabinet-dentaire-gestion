import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

/**
 * Nomme un poste et le rattache à un site.
 *
 * Le rattachement au site n'est pas cosmétique : c'est de lui que le journal
 * d'audit tire le site de chaque action (D7). Un poste sans site produit des
 * entrées sans site, et l'exigence « depuis quel site » n'est pas satisfaite.
 */
export async function nommerPoste(
  ctx: AuthContext,
  id: string,
  input: { nom: string; siteId: string | null },
) {
  await requirePermission(ctx, 'workstation', 'update')

  return prisma.$transaction(async (tx) => {
    const poste = await tx.workstation.update({
      where: { id },
      data: { nom: input.nom, siteId: input.siteId },
      select: { id: true, nom: true },
    })

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'workstation',
      entityId: id,
      metadata: { nom: input.nom, siteId: input.siteId },
    })

    return poste
  })
}

/**
 * Désactive un poste : son cookie n'est plus reconnu.
 *
 * Cas d'usage : machine mise au rebut ou volée. On ne supprime pas la ligne —
 * le journal d'audit y fait référence sur des années d'historique.
 */
export async function desactiverPoste(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'workstation', 'delete')

  return prisma.$transaction(async (tx) => {
    const poste = await tx.workstation.update({
      where: { id },
      data: { actif: false },
      select: { id: true, nom: true },
    })

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'workstation',
      entityId: id,
      metadata: { desactive: true },
    })

    return poste
  })
}
