import 'server-only'

import { UsageAssistant } from '@prisma/client'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// Les demandes d'urgence que l'assistant a transmises au praticien faute de place dans le délai (D79) : le cabinet
// rappelle le patient, et le praticien peut le prendre en plus. Elles concernent le cabinet tout entier — le patient
// n'a pas encore de rendez-vous, donc pas de cabinet : tout le personnel qui lit l'agenda les voit.

export async function listerDemandesUrgence(ctx: AuthContext) {
  await requirePermission(ctx, 'agenda', 'read')
  const demandes = await prisma.conversationAssistant.findMany({
    where: { usage: UsageAssistant.URGENCES, demandeLe: { not: null }, demandeTraiteeLe: null },
    orderBy: { demandeLe: 'asc' },
    select: {
      id: true,
      niveau: true,
      resume: true,
      contactPrenom: true,
      contactNom: true,
      contactTelephone: true,
      demandeLe: true,
    },
  })
  await recordRead(ctx, 'assistant', demandes.length)
  return demandes
}
