import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { filtrePraticien, filtreSite } from '@/server/auth/portee'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import { paire } from '@/server/domaine/chat'
import { sesPatients } from '@/server/queries/patients'

// Les gestes du chat interne (D82) : écrire à un collègue, marquer sa conversation lue, couper le son.

export class ChatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatError'
  }
}

export const LONGUEUR_MAX_MESSAGE = 2000

export type Cite = { type: 'patient'; id: string } | { type: 'rendezVous'; id: string }

/**
 * Envoie un message. La conversation naît au premier. Ce qui est cité doit être visible de l'auteur, comme dans le
 * reste du logiciel : un praticien qui n'administre pas ne cite que ses patients.
 */
export async function envoyerMessage(
  ctx: AuthContext,
  input: { collegueId: string; texte: string; cite: Cite | null },
) {
  const texte = input.texte.trim()
  if (!texte) throw new ChatError('Le message est vide.')
  if (texte.length > LONGUEUR_MAX_MESSAGE)
    throw new ChatError(`Un message tient en ${LONGUEUR_MAX_MESSAGE} caractères.`)
  if (input.collegueId === ctx.userId) throw new ChatError('On ne s’écrit pas à soi-même.')
  const collegue = await prisma.user.findFirst({
    where: { id: input.collegueId, actif: true },
    select: { id: true },
  })
  if (!collegue) throw new ChatError('Ce collègue n’a plus de compte actif.')

  let patientId: string | null = null
  let rendezVousId: string | null = null
  if (input.cite?.type === 'rendezVous') {
    const r = await prisma.rendezVous.findFirst({
      where: { id: input.cite.id, ...filtreSite(ctx), ...filtrePraticien(ctx) },
      select: { id: true, patientId: true },
    })
    if (!r) throw new ChatError('Ce rendez-vous n’est pas dans votre agenda.')
    rendezVousId = r.id
    patientId = r.patientId
  } else if (input.cite?.type === 'patient') {
    const p = await prisma.patient.findFirst({
      where: { id: input.cite.id, actif: true, ...sesPatients(ctx) },
      select: { id: true },
    })
    if (!p) throw new ChatError('Ce patient n’est pas dans vos fiches.')
    patientId = p.id
  }

  return prisma.$transaction(async (tx) => {
    const maintenant = new Date()
    const conversation = await tx.conversationChat.upsert({
      where: { userAId_userBId: paire(ctx.userId, input.collegueId) },
      create: {
        ...paire(ctx.userId, input.collegueId),
        dernierMessageLe: maintenant,
      },
      update: { dernierMessageLe: maintenant },
      select: { id: true },
    })
    const message = await tx.messageChat.create({
      data: {
        conversationId: conversation.id,
        auteurId: ctx.userId,
        texte,
        patientId,
        rendezVousId,
        envoyeLe: maintenant,
      },
      select: { id: true },
    })
    // Le journal garde le geste, jamais le texte : il peut parler d'un patient.
    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'message_chat',
      entityId: message.id,
      metadata: {
        conversationId: conversation.id,
        cite: rendezVousId ? 'rendez_vous' : patientId ? 'patient' : null,
      },
    })
    return message
  })
}

/** La conversation avec ce collègue est ouverte : ses messages sont lus, la pastille baisse d'autant. */
export async function marquerLu(ctx: AuthContext, collegueId: string): Promise<number> {
  const { count } = await prisma.messageChat.updateMany({
    where: {
      conversation: paire(ctx.userId, collegueId),
      auteurId: collegueId,
      luLe: null,
    },
    data: { luLe: new Date() },
  })
  return count
}

/** Le son des nouveaux messages, propre à chaque personne et retenu sur son compte. */
export async function reglerSon(ctx: AuthContext, coupe: boolean): Promise<void> {
  await prisma.user.update({
    where: { id: ctx.userId },
    data: { chatSonCoupe: coupe },
  })
}
