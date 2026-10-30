import 'server-only'

import type { RoleName } from '@prisma/client'

import { prisma } from '@/server/db/client'

// Le contexte est construit UNE FOIS par requête, à partir de la session, et
// traverse ensuite toute la couche d'accès aux données. Aucune fonction de la
// DAL ne doit relire la session elle-même : deux lectures de la session, c'est
// deux occasions de diverger sur qui est l'appelant.

export type PermissionKey = `${string}:${string}`

export type AuthContext = {
  userId: string
  email: string
  roles: RoleName[]
  /** Permissions effectives : union des rôles portés (D4). */
  permissions: ReadonlySet<PermissionKey>
  /**
   * Sites que l'appelant peut voir : sa portée de lecture (D5, révisée le
   * 2026-09-10). Ses rattachements `UserSite` ; tous les sites pour une portée
   * globale. Dans les deux cas, seulement les cabinets en activité (D74) : un
   * cabinet décoché n'existe plus pour personne, administrateur compris.
   *
   * Un ensemble et non un site unique, parce qu'un praticien qui tient les deux
   * cabinets est rattaché aux deux et doit voir les deux.
   */
  sitesAutorises: ReadonlySet<string>
  /**
   * Affranchit du cloisonnement par site. Porté par le rôle ADMIN, donc par le
   * « super-admin praticien » que le cabinet décrit : les rôles étant cumulables
   * (D4), le praticien référent porte PRATICIEN + ADMIN, et ses confrères
   * restent cantonnés à leurs rattachements.
   */
  porteeGlobale: boolean
  /**
   * Le praticien auquel l'appelant est cantonné (Marving, 27/10) : un praticien qui n'est pas administrateur ne
   * voit que ses rendez-vous, ses patients et ses chiffres. `null` (ou absent) : la secrétaire, l'assistante,
   * l'administrateur — ils voient tout le cabinet.
   */
  praticienRestreint?: string | null
  /** Site DEPUIS lequel l'action est faite — une étiquette d'origine, à ne pas
   *  confondre avec `sitesAutorises`, qui décide de ce qu'on a le droit de lire. */
  siteId: string | null
  workstationId: string | null
  ipAddress: string
  userAgent: string | null
}

/** Origine technique de la requête, connue du transport, pas du domaine. */
export type RequestOrigin = {
  ipAddress: string
  userAgent?: string | null
  siteId?: string | null
  workstationId?: string | null
}

export const permissionKey = (resource: string, action: string): PermissionKey =>
  `${resource}:${action}`

export async function loadAuthContext(
  userId: string,
  origin: RequestOrigin,
): Promise<AuthContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      actif: true,
      roles: {
        select: {
          role: {
            select: {
              name: true,
              permissions: { select: { permission: { select: { resource: true, action: true } } } },
            },
          },
        },
      },
      sites: { select: { siteId: true } },
      praticien: { select: { id: true } },
    },
  })

  // Un compte désactivé n'a pas de contexte : il ne s'agit pas de lui retirer
  // des permissions une à une, mais de ne lui en accorder aucune.
  if (!user || !user.actif) return null

  const roles = user.roles.map((r) => r.role.name)
  const porteeGlobale = roles.includes('ADMIN')
  const sitesActifs = new Set(
    (await prisma.site.findMany({ where: { actif: true }, select: { id: true } })).map((s) => s.id),
  )
  const permissions = new Set<PermissionKey>()
  for (const { role } of user.roles) {
    for (const { permission } of role.permissions) {
      permissions.add(permissionKey(permission.resource, permission.action))
    }
  }

  return {
    userId: user.id,
    email: user.email,
    roles,
    permissions,
    sitesAutorises: porteeGlobale ? sitesActifs : new Set(user.sites.map((s) => s.siteId).filter((id) => sitesActifs.has(id))),
    // Seul ADMIN affranchit du cloisonnement. Un praticien sans ce rôle reste
    // cantonné à ses rattachements : un droit dit ce qu'on peut faire, pas où on
    // peut le voir.
    porteeGlobale,
    praticienRestreint: roles.includes('PRATICIEN') && !porteeGlobale ? (user.praticien?.id ?? null) : null,
    siteId: origin.siteId ?? null,
    workstationId: origin.workstationId ?? null,
    ipAddress: origin.ipAddress,
    userAgent: origin.userAgent ?? null,
  }
}
