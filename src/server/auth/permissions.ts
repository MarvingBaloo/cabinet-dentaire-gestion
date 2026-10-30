import 'server-only'

import { type AuthContext, permissionKey } from '@/server/auth/context'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// D4 : le garde vit DANS la fonction d'accès, jamais chez son appelant.
// Un appelant distrait ne doit pas pouvoir ouvrir un accès en omettant l'appel.

export class PermissionDeniedError extends Error {
  constructor(
    readonly resource: string,
    readonly action: string,
  ) {
    super(`Permission refusée : ${resource}:${action}`)
    this.name = 'PermissionDeniedError'
  }
}

export function hasPermission(ctx: AuthContext, resource: string, action: string): boolean {
  return ctx.permissions.has(permissionKey(resource, action))
}

/**
 * Vérifie une permission, journalise le refus, et lève.
 *
 * Le refus est journalisé AVANT de lever : une tentative d'accès non autorisée
 * est précisément l'événement qu'un contrôle veut retrouver dans le journal.
 * La lever sans la tracer reviendrait à protéger la donnée en effaçant la trace
 * de qui a essayé d'y accéder.
 */
export async function requirePermission(
  ctx: AuthContext,
  resource: string,
  action: string,
): Promise<void> {
  if (hasPermission(ctx, resource, action)) return

  await recordAudit(prisma, ctx, {
    action: 'PERMISSION_DENIED',
    entityType: resource,
    succeeded: false,
    deniedReason: `${resource}:${action}`,
  })

  throw new PermissionDeniedError(resource, action)
}
