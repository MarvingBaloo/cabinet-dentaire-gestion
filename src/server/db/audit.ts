import 'server-only'

import type { AuditAction, Prisma, RoleName } from '@prisma/client'

import type { AuthContext } from '@/server/auth/context'

import { prisma } from './client'

// D9 : toute lecture comme toute écriture est journalisée.
//
// UNE LIGNE = UNE OPÉRATION D'ACCÈS, pas une ligne lue. `itemCount` porte le
// volume. Une ligne par enregistrement rendrait le journal ingérable dès la
// première vue d'agenda hebdomadaire, sans rien apprendre de plus.

/** Accepte le client global ou un client de transaction : l'entrée d'audit doit
 *  pouvoir être écrite DANS la transaction de la mutation qu'elle trace. */
export type Db = Prisma.TransactionClient | typeof prisma

export type AuditEntry = {
  action: AuditAction
  entityType: string
  entityId?: string | null
  itemCount?: number | null
  succeeded?: boolean
  deniedReason?: string | null
  /** ⚠ JAMAIS de donnée de santé ici : c'est la voie de fuite la plus probable
   *  vers un journal exporté ou moins protégé que sa source (D9). */
  metadata?: Prisma.InputJsonValue | null
}

export async function recordAudit(db: Db, ctx: AuthContext, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      itemCount: entry.itemCount ?? null,
      succeeded: entry.succeeded ?? true,
      deniedReason: entry.deniedReason ?? null,
      // Champ omis plutôt que mis à undefined : Prisma distingue les deux, et
      // `exactOptionalPropertyTypes` nous oblige à le dire explicitement.
      ...(entry.metadata != null ? { metadata: entry.metadata } : {}),

      // Acteur figé au moment de l'action : l'email et les rôles doivent rester
      // lisibles même si le compte est désactivé ou ses rôles modifiés ensuite.
      actorId: ctx.userId,
      actorEmail: ctx.email,
      actorRoles: ctx.roles,

      siteId: ctx.siteId,
      workstationId: ctx.workstationId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  })
}

/** Trace une opération de lecture. `count` est le nombre d'enregistrements
 *  renvoyés, pas le nombre de lignes d'audit à écrire. */
export async function recordRead(
  ctx: AuthContext,
  entityType: string,
  count: number,
  entityId?: string | null,
): Promise<void> {
  await recordAudit(prisma, ctx, {
    action: 'READ',
    entityType,
    entityId: entityId ?? null,
    itemCount: count,
  })
}

/**
 * Convention de l'acteur « système » : une mutation posée par le worker
 * (`scripts/worker-notifications.ts`), sans utilisateur humain derrière
 * l'action — ex. l'absence automatique 20 minutes après le début (Q27,
 * `marquerAbsentsAutomatiques`, `src/server/services/agenda.ts`).
 *
 * `actorId` reste `null`, comme pour un échec de login sur un identifiant
 * inconnu (`recordAuthEvent`) : ce n'est PAS le même cas — celui-ci est un
 * acteur délibérément non humain, celui-là un acteur inconnu — mais la
 * colonne ne distingue que « personne d'identifié », d'où `actorEmail` fixé à
 * `'système'` pour que le journal les distingue à la lecture. `ipAddress` est
 * requise par le schéma (D9) ; le worker n'a pas de requête HTTP réelle,
 * d'où la boucle locale plutôt qu'une chaîne vide ou inventée.
 */
export const ACTEUR_SYSTEME = {
  actorId: null,
  actorEmail: 'système',
  actorRoles: [] as RoleName[],
  ipAddress: '127.0.0.1',
  userAgent: 'worker-notifications',
} as const

/** Trace une mutation posée par l'acteur système (voir `ACTEUR_SYSTEME`), DANS
 *  la même transaction que l'écriture qu'elle accompagne — même règle que
 *  `recordAudit` (D9). `siteId`/`workstationId` restent ceux du rendez-vous ou
 *  de l'entité concernée, pas ceux d'un poste : le worker n'en a aucun. */
export async function recordSystemAudit(
  db: Db,
  entry: AuditEntry & { siteId?: string | null; workstationId?: string | null },
): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      itemCount: entry.itemCount ?? null,
      succeeded: entry.succeeded ?? true,
      deniedReason: entry.deniedReason ?? null,
      ...(entry.metadata != null ? { metadata: entry.metadata } : {}),

      actorId: ACTEUR_SYSTEME.actorId,
      actorEmail: ACTEUR_SYSTEME.actorEmail,
      actorRoles: ACTEUR_SYSTEME.actorRoles,

      siteId: entry.siteId ?? null,
      workstationId: entry.workstationId ?? null,
      ipAddress: ACTEUR_SYSTEME.ipAddress,
      userAgent: ACTEUR_SYSTEME.userAgent,
    },
  })
}

/** Journalise un événement d'authentification, pour lequel il n'existe pas
 *  toujours d'acteur identifié (échec de login sur un identifiant inconnu). */
export async function recordAuthEvent(params: {
  action: Extract<
    AuditAction,
    'LOGIN_SUCCESS' | 'LOGIN_FAILURE' | 'LOGOUT' | 'SECOND_FACTEUR_INDISPONIBLE'
  >
  actorId?: string | null
  actorEmail?: string | null
  succeeded: boolean
  deniedReason?: string | null
  ipAddress: string
  userAgent?: string | null
  workstationId?: string | null
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: params.action,
      entityType: 'session',
      succeeded: params.succeeded,
      deniedReason: params.deniedReason ?? null,
      actorId: params.actorId ?? null,
      actorEmail: params.actorEmail ?? null,
      actorRoles: [],
      ipAddress: params.ipAddress,
      userAgent: params.userAgent ?? null,
      workstationId: params.workstationId ?? null,
    },
  })
}
