import 'server-only'

import { Prisma } from '@prisma/client'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import { lireRetrocessionCabinet } from '@/server/queries/retrocession'

// Les gestes de la rétrocession (D81), tous à l'administrateur : régler la part de chaque praticien, le prix de
// chaque soin, et marquer un mois « versé ». Chacun laisse sa ligne au journal, sans donnée de santé.

export class DejaVerseError extends Error {
  constructor() {
    super('Ce mois est déjà marqué versé pour ce praticien.')
    this.name = 'DejaVerseError'
  }
}

export class SansPartError extends Error {
  constructor() {
    super('Ce praticien n’a pas de part réglée : rien à lui verser.')
    this.name = 'SansPartError'
  }
}

/** Marque le mois versé : le montant du relevé, à cet instant, est figé. */
export async function marquerVerse(ctx: AuthContext, input: { praticienId: string; mois: string }) {
  const ligne = (await lireRetrocessionCabinet(ctx, input.mois)).find((l) => l.praticien.id === input.praticienId)
  if (!ligne) throw new SansPartError()
  try {
    return await prisma.$transaction(async (tx) => {
      const versement = await tx.versementRetrocession.create({
        data: { praticienId: input.praticienId, mois: input.mois, montantCentimes: ligne.aVerserCentimes, verseParId: ctx.userId },
        select: { id: true, montantCentimes: true },
      })
      await recordAudit(tx, ctx, {
        action: 'CREATE',
        entityType: 'versement_retrocession',
        entityId: versement.id,
        metadata: { praticienId: input.praticienId, mois: input.mois, montantCentimes: versement.montantCentimes },
      })
      return versement
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DejaVerseError()
    throw e
  }
}

/** La part d'un praticien, en pour cent ; `null` : rien à lui reverser (le titulaire). */
export async function reglerPart(ctx: AuthContext, input: { praticienId: string; part: number | null }) {
  await requirePermission(ctx, 'statistiques', 'cabinet')
  return prisma.$transaction(async (tx) => {
    const avant = await tx.praticien.findUniqueOrThrow({ where: { id: input.praticienId }, select: { partRetrocession: true } })
    await tx.praticien.update({ where: { id: input.praticienId }, data: { partRetrocession: input.part } })
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'praticien',
      entityId: input.praticienId,
      metadata: { partRetrocession: { avant: avant.partRetrocession, apres: input.part } },
    })
  })
}

/** Le prix d'un soin, en centimes ; `null` : pas de prix, la secrétaire le saisit au passage en caisse. */
export async function reglerPrix(ctx: AuthContext, input: { motifId: string; prixCentimes: number | null }) {
  await requirePermission(ctx, 'motif', 'update')
  return prisma.$transaction(async (tx) => {
    const avant = await tx.motifConsultation.findUniqueOrThrow({ where: { id: input.motifId }, select: { prixCentimes: true } })
    await tx.motifConsultation.update({ where: { id: input.motifId }, data: { prixCentimes: input.prixCentimes } })
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'motif',
      entityId: input.motifId,
      metadata: { prixCentimes: { avant: avant.prixCentimes, apres: input.prixCentimes } },
    })
  })
}
