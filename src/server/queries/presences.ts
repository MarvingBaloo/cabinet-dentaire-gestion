import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { filtreSite } from '@/server/auth/portee'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// Lectures de la semaine type et de ses exceptions (compléments d'agenda, lot 1).
// Même enchaînement que le reste de la DAL (D4, D9) : permission, portée si
// pertinente, puis trace d'audit.

/**
 * La semaine type, filtrée aux sites de l'appelant (D5) : chaque ligne porte
 * un `siteId`, exactement comme `PlageDePresence` (`listerPresences`,
 * src/server/queries/agenda.ts) — même donnée, même garde.
 */
export async function listerSemaineType(ctx: AuthContext, options: { praticienId?: string } = {}) {
  await requirePermission(ctx, 'presence', 'read')

  const lignes = await prisma.presenceHebdomadaire.findMany({
    where: { ...filtreSite(ctx), ...(options.praticienId ? { praticienId: options.praticienId } : {}) },
    select: {
      id: true,
      praticienId: true,
      jourSemaine: true,
      heureDebut: true,
      heureFin: true,
      pauseDebut: true,
      pauseFin: true,
      site: { select: { id: true, nom: true } },
      fauteuil: { select: { id: true, nom: true } },
    },
    orderBy: [{ praticienId: 'asc' }, { jourSemaine: 'asc' }],
  })

  await recordRead(ctx, 'presence', lignes.length)
  return lignes
}

/** Le fauteuil fixe de chaque praticien, dans les cabinets de l'appelant (D5). */
export async function listerFauteuilsPraticiens(ctx: AuthContext) {
  await requirePermission(ctx, 'presence', 'read')
  return prisma.fauteuilPraticien.findMany({
    where: filtreSite(ctx),
    select: { praticienId: true, siteId: true, fauteuilId: true },
  })
}

/**
 * Les exceptions, TOUS SITES CONFONDUS — sans `filtreSite`, et c'est délibéré,
 * comme pour `listerPraticiens` (agenda.ts) : un RETRAIT ne porte aucun site,
 * et une exception se lit avec le praticien auquel elle appartient, pas avec
 * un cabinet. `options.depuis` borne aux exceptions encore pertinentes — un
 * jour déjà passé n'a plus d'effet sur la génération.
 */
export async function listerExceptions(
  ctx: AuthContext,
  options: { praticienId?: string; depuis?: string } = {},
) {
  await requirePermission(ctx, 'presence', 'read')

  const exceptions = await prisma.exceptionPresence.findMany({
    where: {
      ...(options.praticienId ? { praticienId: options.praticienId } : {}),
      ...(options.depuis ? { date: { gte: new Date(`${options.depuis}T00:00:00.000Z`) } } : {}),
    },
    select: {
      id: true,
      praticienId: true,
      date: true,
      type: true,
      motif: true,
      heureDebut: true,
      heureFin: true,
      site: { select: { id: true, nom: true } },
      fauteuil: { select: { id: true, nom: true } },
    },
    orderBy: { date: 'asc' },
  })

  await recordRead(ctx, 'presence', exceptions.length)
  return exceptions
}
