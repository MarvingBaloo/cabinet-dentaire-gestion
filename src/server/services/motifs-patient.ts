import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import type {
  CreerMotifPatientInput,
  ModifierMotifPatientInput,
} from '@/server/validation/agenda'

// Le menu que le patient parcourt sur le portail, tenu par le cabinet.
//
// POURQUOI CET ÉCRAN EXISTE. Sans lui, ajouter « Consultation de suivi —
// implants » demanderait une intervention sur le code. Le cabinet a demandé que
// son catalogue se paramètre (D14) ; la promesse ne vaut que s'il peut le faire
// lui-même.
//
// Réservé au rôle global : c'est ce que voient tous les patients, pas un réglage
// d'accueil.

export class ProfondeurMotifPatientError extends Error {
  constructor() {
    super('Le menu ne compte que deux niveaux : cette entrée en ferait un troisième.')
    this.name = 'ProfondeurMotifPatientError'
  }
}

export class MotifPatientUtiliseError extends Error {
  constructor() {
    super('Cette entrée porte des sous-entrées : retirez-les d’abord.')
    this.name = 'MotifPatientUtiliseError'
  }
}

export async function creerMotifPatient(ctx: AuthContext, input: CreerMotifPatientInput) {
  await requirePermission(ctx, 'motif', 'create')

  // Le trigger en base refuse déjà un troisième niveau. Le vérifier ici donne un
  // message lisible plutôt qu'une erreur de contrainte.
  if (input.parentId) {
    const parent = await prisma.motifPatient.findUnique({
      where: { id: input.parentId },
      select: { parentId: true },
    })
    if (!parent) throw new Error('Entrée parente introuvable.')
    if (parent.parentId) throw new ProfondeurMotifPatientError()
  }

  return prisma.$transaction(async (tx) => {
    const entree = await tx.motifPatient.create({
      data: {
        libelle: input.libelle,
        aide: input.aide ?? null,
        parentId: input.parentId ?? null,
        motifId: input.motifId ?? null,
        ordre: input.ordre,
      },
      select: { id: true, libelle: true },
    })

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'motif',
      entityId: entree.id,
      // Le libellé est destiné au public : il n'a rien de sensible.
      metadata: { libelle: entree.libelle, sousEntree: Boolean(input.parentId) },
    })

    return entree
  })
}

export async function modifierMotifPatient(ctx: AuthContext, input: ModifierMotifPatientInput) {
  await requirePermission(ctx, 'motif', 'update')

  const avant = await prisma.motifPatient.findUnique({
    where: { id: input.id },
    select: { id: true, libelle: true, motifId: true, actif: true, ordre: true },
  })
  if (!avant) throw new Error('Entrée introuvable.')

  return prisma.$transaction(async (tx) => {
    const apres = await tx.motifPatient.update({
      where: { id: input.id },
      data: {
        ...(input.libelle !== undefined ? { libelle: input.libelle } : {}),
        ...(input.aide !== undefined ? { aide: input.aide } : {}),
        ...(input.motifId !== undefined ? { motifId: input.motifId } : {}),
        ...(input.ordre !== undefined ? { ordre: input.ordre } : {}),
        ...(input.actif !== undefined ? { actif: input.actif } : {}),
      },
      select: { id: true, libelle: true, motifId: true, actif: true },
    })

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'motif',
      entityId: apres.id,
      metadata: {
        libelleAvant: avant.libelle,
        libelleApres: apres.libelle,
        acteRattache: apres.motifId !== null,
        actif: apres.actif,
      },
    })

    return apres
  })
}

/**
 * Retire une entrée du menu.
 *
 * Supprimée et non désactivée : contrairement à un motif d'agenda, une entrée de
 * menu n'est référencée par aucun rendez-vous passé — elle n'a servi qu'à
 * orienter un clic. La désactivation reste possible pour la masquer sans la
 * perdre.
 */
export async function supprimerMotifPatient(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'motif', 'update')

  const entree = await prisma.motifPatient.findUnique({
    where: { id },
    select: { id: true, libelle: true, _count: { select: { enfants: true } } },
  })
  if (!entree) throw new Error('Entrée introuvable.')
  if (entree._count.enfants > 0) throw new MotifPatientUtiliseError()

  return prisma.$transaction(async (tx) => {
    await tx.motifPatient.delete({ where: { id } })

    await recordAudit(tx, ctx, {
      action: 'DELETE',
      entityType: 'motif',
      entityId: id,
      metadata: { libelle: entree.libelle },
    })
  })
}
