import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// `secretHash` n'est jamais sélectionné : c'est l'équivalent d'un mot de passe
// pour la machine, il n'a aucune raison de quitter la couche serveur.
export async function listerPostes(ctx: AuthContext) {
  await requirePermission(ctx, 'workstation', 'read')

  const postes = await prisma.workstation.findMany({
    // Le poste d'un cabinet décoché disparaît avec lui (D74) ; un poste sans cabinet reste.
    where: { OR: [{ siteId: null }, { site: { actif: true } }] },
    select: {
      id: true,
      nom: true,
      actif: true,
      lastSeenAt: true,
      createdAt: true,
      site: { select: { id: true, code: true, nom: true } },
    },
    orderBy: [{ actif: 'desc' }, { lastSeenAt: 'desc' }],
  })

  await recordRead(ctx, 'workstation', postes.length)
  return postes
}
