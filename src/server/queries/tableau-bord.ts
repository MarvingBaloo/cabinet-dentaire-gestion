import 'server-only'

import type { AuditAction } from '@prisma/client'

import type { AuthContext } from '@/server/auth/context'
import { hasPermission, requirePermission } from '@/server/auth/permissions'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// Indicateurs du tableau de bord.
//
// Chacun répond à une question qu'on se pose vraiment sur ce logiciel : qui n'a
// pas encore activé sa double authentification, quelles machines ne sont
// rattachées à aucun site (leurs actions sont alors tracées sans site), et que
// s'est-il passé récemment. Rien de décoratif.

export type Indicateurs = {
  comptesActifs: number
  comptesDesactives: number
  sansMfa: number
  postesActifs: number
  postesSansSite: number
  audit: {
    connexionsReussies24h: number
    echecsConnexion24h: number
    refusPermission24h: number
  } | null
}

export async function lireIndicateurs(ctx: AuthContext): Promise<Indicateurs> {
  await requirePermission(ctx, 'utilisateur', 'read')

  const depuis24h = new Date(Date.now() - 24 * 3_600_000)

  const [comptesActifs, comptesDesactives, sansMfa, postesActifs, postesSansSite] = await Promise.all([
    prisma.user.count({ where: { actif: true } }),
    prisma.user.count({ where: { actif: false } }),
    prisma.user.count({ where: { actif: true, mfaEnrolledAt: null } }),
    prisma.workstation.count({ where: { actif: true } }),
    prisma.workstation.count({ where: { actif: true, siteId: null } }),
  ])

  // Le journal n'est lisible que par qui en a le droit (D4). On renvoie null
  // plutôt que de lever : le reste du tableau de bord reste utile sans.
  let audit: Indicateurs['audit'] = null
  if (hasPermission(ctx, 'audit', 'read')) {
    const [connexionsReussies24h, echecsConnexion24h, refusPermission24h] = await Promise.all([
      prisma.auditLog.count({
        where: { action: 'LOGIN_SUCCESS', occurredAt: { gte: depuis24h } },
      }),
      prisma.auditLog.count({
        where: { action: 'LOGIN_FAILURE', occurredAt: { gte: depuis24h } },
      }),
      prisma.auditLog.count({
        where: { action: 'PERMISSION_DENIED', occurredAt: { gte: depuis24h } },
      }),
    ])
    audit = { connexionsReussies24h, echecsConnexion24h, refusPermission24h }
  }

  await recordRead(ctx, 'tableau-de-bord', 1)
  return { comptesActifs, comptesDesactives, sansMfa, postesActifs, postesSansSite, audit }
}

/** Ce que montre le Journal : connexions, refus et créations — pas les lectures. */
const ACTIONS_JOURNAL: AuditAction[] = ['LOGIN_SUCCESS', 'LOGIN_FAILURE', 'PERMISSION_DENIED', 'CREATE']

/** Combien de lignes compte le Journal, et combien de refus, pour ses pages et son bandeau (Marving, 29/10). */
export async function compterJournal(ctx: AuthContext) {
  await requirePermission(ctx, 'audit', 'read')
  const [total, refus] = await Promise.all([
    prisma.auditLog.count({ where: { action: { in: ACTIONS_JOURNAL } } }),
    prisma.auditLog.count({ where: { action: { in: ['LOGIN_FAILURE', 'PERMISSION_DENIED'] } } }),
  ])
  return { total, refus }
}

/** Dernières entrées du journal, pour qui a le droit de le lire. */
export async function lireActiviteRecente(ctx: AuthContext, limite = 8, decalage = 0) {
  await requirePermission(ctx, 'audit', 'read')

  const entrees = await prisma.auditLog.findMany({
    where: { action: { in: ACTIONS_JOURNAL } },
    select: {
      id: true,
      occurredAt: true,
      action: true,
      actorEmail: true,
      succeeded: true,
      deniedReason: true,
      entityType: true,
      workstation: { select: { nom: true } },
      site: { select: { nom: true } },
    },
    // L'id départage deux lignes de la même milliseconde : sans lui, une page pourrait en répéter une de la précédente.
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limite,
    skip: decalage,
  })

  // Le nom de la personne plutôt que son adresse (Journal, tour du 20/10).
  const emails = [...new Set(entrees.map((e) => e.actorEmail).filter((e): e is string => Boolean(e)))]
  const personnes = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true, prenom: true, nom: true } })
    : []

  await recordRead(ctx, 'audit', entrees.length)
  return entrees.map((e) => {
    const p = personnes.find((x) => x.email === e.actorEmail)
    return { ...e, personne: p ? `${p.prenom} ${p.nom}` : null }
  })
}
