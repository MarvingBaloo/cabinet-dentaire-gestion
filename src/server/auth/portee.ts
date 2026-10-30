import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

/**
 * Cloisonnement par site (D5, révisée le 2026-09-10).
 *
 * Une permission dit ce qu'on a le droit de FAIRE ; la portée dit OÙ. Les deux
 * gardes sont donc distincts et s'appliquent l'un après l'autre : une secrétaire
 * porte `agenda:read`, et ne lit pourtant pas l'agenda du site où elle ne
 * travaille pas.
 *
 * ⚠ Ce fichier existe parce que la décision a été retournée. Jusqu'au
 * 2026-09-10, le dépôt affirmait l'inverse — `siteId` étiquetait sans filtrer —
 * et interdisait explicitement d'écrire une requête restreignant une lecture au
 * site de l'appelant. Le cabinet a tranché dans l'autre sens.
 */

export class PorteeSiteError extends Error {
  constructor(readonly siteId: string) {
    super(`Site hors de la portée de l’appelant : ${siteId}`)
    this.name = 'PorteeSiteError'
  }
}

/** L'appelant peut-il voir ce site ? `sitesAutorises` porte déjà tout : portée globale et cabinets en activité. */
export function peutVoirSite(ctx: AuthContext, siteId: string): boolean {
  return ctx.sitesAutorises.has(siteId)
}

/**
 * Clause `where` à poser sur toute lecture portant un `siteId`.
 *
 * Toujours une clause `in`, portée globale comprise : depuis D74, « tout voir »
 * veut dire tous les cabinets EN ACTIVITÉ, et un cabinet décoché disparaît
 * aussi pour l'administrateur. Quand l'appelant n'est rattaché à aucun site, la
 * liste vide ne rend aucune ligne, ce qui est le comportement voulu. Une absence
 * de rattachement ne doit jamais s'interpréter comme « tout voir ».
 */
export function filtreSite(ctx: AuthContext): { siteId: { in: string[] } } {
  return { siteId: { in: [...ctx.sitesAutorises] } }
}

/**
 * Clause `where` à poser sur toute lecture de rendez-vous : un praticien qui n'administre pas ne lit que les
 * siens (Marving, 27/10). Vide pour les autres.
 */
export function filtrePraticien(ctx: AuthContext): { praticienId?: string } {
  return ctx.praticienRestreint ? { praticienId: ctx.praticienRestreint } : {}
}

/**
 * Garde d'écriture : refuse d'agir sur un site hors portée, et trace le refus.
 *
 * Le refus est journalisé avant d'être levé, comme pour les permissions : une
 * tentative d'écriture sur un site interdit est précisément ce qu'un contrôle
 * veut pouvoir retrouver.
 */
export async function exigerAccesSite(ctx: AuthContext, siteId: string): Promise<void> {
  if (peutVoirSite(ctx, siteId)) return

  await recordAudit(prisma, ctx, {
    action: 'PERMISSION_DENIED',
    entityType: 'site',
    entityId: siteId,
    succeeded: false,
    deniedReason: `portee:site`,
  })

  throw new PorteeSiteError(siteId)
}

/** Refus de la vue consolidée des deux cabinets à un compte qui n'a pas la
 *  portée globale (lot 4, vues de l'agenda). */
export class PorteeConsolideeError extends Error {
  constructor() {
    super('La vue consolidée des deux cabinets est réservée aux comptes qui voient tous les sites.')
    this.name = 'PorteeConsolideeError'
  }
}

/**
 * Garde de la vue consolidée : contrairement à `exigerAccesSite`, il ne s'agit
 * pas de vérifier un site précis mais d'exiger la portée globale elle-même —
 * un compte mono-site ne doit jamais recevoir les rendez-vous des deux
 * cabinets mélangés, même en demandant chaque site l'un après l'autre serait
 * autorisé isolément.
 */
export async function exigerPorteeGlobale(ctx: AuthContext): Promise<void> {
  if (ctx.porteeGlobale) return

  await recordAudit(prisma, ctx, {
    action: 'PERMISSION_DENIED',
    entityType: 'site',
    succeeded: false,
    deniedReason: 'portee:consolidee',
  })

  throw new PorteeConsolideeError()
}
