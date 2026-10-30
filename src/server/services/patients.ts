import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import type { DebloquerPatientInput, ModifierPatientInput } from '@/server/validation/patient'

/**
 * Rend la réservation en ligne à un patient bloqué par trois manquements (Q27).
 *
 * Le compteur retombe à zéro, il ne reste pas à trois avec une dérogation. Sans
 * cela, le patient débloqué ce matin se retrouverait bloqué à sa prochaine
 * absence, et le geste de l'administrateur n'aurait servi qu'une journée.
 *
 * ⚠ Ce qui n'est PAS effacé : les rendez-vous manqués eux-mêmes gardent leur
 * statut et leur drapeau. Le compteur repart de zéro, l'historique reste lisible
 * — et le journal d'audit garde trace de qui a levé la sanction.
 */
export async function debloquerPatient(ctx: AuthContext, input: DebloquerPatientInput) {
  await requirePermission(ctx, 'patient', 'debloquer')

  const actuel = await prisma.patient.findFirst({
    where: { id: input.id, actif: true },
    select: { id: true, manquements: true, reservationBloquee: true },
  })
  if (!actuel) throw new Error('Patient introuvable.')

  return prisma.$transaction(async (tx) => {
    const patient = await tx.patient.update({
      where: { id: actuel.id },
      data: { manquements: 0, reservationBloquee: false, debloqueLe: new Date() },
      // Nom et prénom sont rendus à l'appelant pour que l'écran puisse nommer
      // qui vient d'être débloqué : la ligne disparaît de la liste au même
      // instant, et un message anonyme laisserait un doute sur la personne.
      select: { id: true, nom: true, prenom: true, manquements: true, reservationBloquee: true },
    })

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'patient',
      entityId: patient.id,
      // Ni nom ni téléphone : l'entité suffit à retrouver qui, et le journal se
      // conserve bien plus longtemps que ce dont il porte la trace.
      metadata: { manquementsAvant: actuel.manquements, debloque: true },
    })

    return patient
  })
}

const CHAMPS_MODIFIABLES = [
  'nom',
  'prenom',
  'telephone',
  'dateNaissance',
  'email',
  'representantLegal',
  'telephoneRepresentant',
] as const

/**
 * Met à jour les coordonnées d'un patient (fiche patient, 19/10).
 *
 * La fiche est « complète » dès que la date de naissance est connue — même
 * règle qu'à la création (Q33) : c'est elle qui distingue deux homonymes.
 *
 * ⚠ Le téléphone identifie aussi le patient sur le portail (D23) et dans la
 * liste d'attente : le changer ici, c'est changer le numéro auquel il reçoit
 * ses codes et ses rappels. Ses inscriptions en liste d'attente gardent, elles,
 * le numéro avec lequel il s'est inscrit.
 */
export async function modifierPatient(ctx: AuthContext, input: ModifierPatientInput) {
  await requirePermission(ctx, 'patient', 'update')

  const actuel = await prisma.patient.findFirst({
    where: { id: input.id, actif: true },
    select: {
      nom: true,
      prenom: true,
      telephone: true,
      dateNaissance: true,
      email: true,
      representantLegal: true,
      telephoneRepresentant: true,
    },
  })
  if (!actuel) throw new Error('Patient introuvable.')

  const dateNaissance = input.dateNaissance ? new Date(`${input.dateNaissance}T00:00:00.000Z`) : null
  const nouveau = { ...input, dateNaissance }
  const changes = CHAMPS_MODIFIABLES.filter((c) => {
    const avant = actuel[c] instanceof Date ? (actuel[c] as Date).getTime() : actuel[c]
    const apres = nouveau[c] instanceof Date ? (nouveau[c] as Date).getTime() : nouveau[c]
    return avant !== apres
  })

  return prisma.$transaction(async (tx) => {
    const patient = await tx.patient.update({
      where: { id: input.id },
      data: {
        nom: input.nom,
        prenom: input.prenom,
        telephone: input.telephone,
        dateNaissance,
        email: input.email,
        representantLegal: input.representantLegal,
        telephoneRepresentant: input.telephoneRepresentant,
        profilComplet: Boolean(dateNaissance),
      },
      select: { id: true, prenom: true, nom: true },
    })

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'patient',
      entityId: patient.id,
      // Les noms des champs touchés, jamais leurs valeurs : le journal se garde
      // plus longtemps que la fiche n'a besoin d'être lue.
      metadata: { champs: changes },
    })

    return patient
  })
}
