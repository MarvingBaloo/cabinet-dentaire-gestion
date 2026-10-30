import 'server-only'

import { CanalNotification } from '@prisma/client'

import { TYPES_MODELISABLES, type TypeModelisable, modeleParDefaut, validerModele } from '@/lib/modeles-messages'
import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// Écran de paramétrage des modèles de messages (lot 5a) : une permission
// unique, `notifications:modeles`, gouverne aussi bien la consultation que
// l'enregistrement — l'écran n'a pas d'usage en lecture seule qui justifierait
// de la scinder, contrairement à `motif:read` / `motif:update`.

export class ModeleMessageInvalideError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModeleMessageInvalideError'
  }
}

export type LigneModeleMessage = {
  type: TypeModelisable
  canal: CanalNotification
  sujet: string | null
  corps: string
  /** `true` : rien en base, le défaut du code s'applique — voir
   *  `src/lib/modeles-messages.ts`. Distinct d'un modèle enregistré tel quel
   *  le défaut : l'écran doit pouvoir dire « c'est le texte d'origine ». */
  parDefaut: boolean
  modifieLe: Date | null
}

export async function listerModelesMessages(ctx: AuthContext): Promise<LigneModeleMessage[]> {
  await requirePermission(ctx, 'notifications', 'modeles')

  const enBase = await prisma.modeleMessage.findMany({
    select: { type: true, canal: true, sujet: true, corps: true, updatedAt: true },
  })
  const parCle = new Map(enBase.map((m) => [`${m.type}:${m.canal}`, m]))

  const lignes: LigneModeleMessage[] = []
  for (const type of TYPES_MODELISABLES) {
    for (const canal of [CanalNotification.SMS, CanalNotification.EMAIL] as const) {
      const existant = parCle.get(`${type}:${canal}`)
      if (existant) {
        lignes.push({
          type,
          canal,
          sujet: existant.sujet,
          corps: existant.corps,
          parDefaut: false,
          modifieLe: existant.updatedAt,
        })
      } else {
        const defaut = modeleParDefaut(type, canal)
        lignes.push({ type, canal, sujet: defaut.sujet, corps: defaut.corps, parDefaut: true, modifieLe: null })
      }
    }
  }
  return lignes
}

export type EnregistrerModeleMessageInput = {
  type: TypeModelisable
  canal: CanalNotification
  sujet: string | null
  corps: string
}

/** Enregistre un modèle. Revalide côté serveur (jamais sur la foi de l'écran) —
 *  refuse avec `ModeleMessageInvalideError` si `validerModele` refuse. */
export async function enregistrerModeleMessage(
  ctx: AuthContext,
  input: EnregistrerModeleMessageInput,
): Promise<{ avertissement?: string }> {
  await requirePermission(ctx, 'notifications', 'modeles')

  const verdict = validerModele(input.type, input.canal, input.corps, input.sujet)
  if (!verdict.ok) throw new ModeleMessageInvalideError(verdict.erreur)

  // Un sujet n'a de sens que pour l'e-mail : vidé sur SMS plutôt que gardé en
  // base sans jamais être lu, ce qui laisserait croire à un sujet actif.
  const sujet = input.canal === CanalNotification.EMAIL ? (input.sujet?.trim() || null) : null
  const corps = input.corps.trim()

  await prisma.$transaction(async (tx) => {
    await tx.modeleMessage.upsert({
      where: { type_canal: { type: input.type, canal: input.canal } },
      update: { sujet, corps, modifieParId: ctx.userId },
      create: { type: input.type, canal: input.canal, sujet, corps, modifieParId: ctx.userId },
    })

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'modele_message',
      entityId: `${input.type}:${input.canal}`,
      metadata: { type: input.type, canal: input.canal },
    })
  })

  return verdict.avertissement !== undefined ? { avertissement: verdict.avertissement } : {}
}

/** Revient au texte par défaut du code : supprime la ligne en base, s'il y en
 *  a une. Rien à revalider — le défaut du code est réputé valide. */
export async function reinitialiserModeleMessage(
  ctx: AuthContext,
  type: TypeModelisable,
  canal: CanalNotification,
): Promise<void> {
  await requirePermission(ctx, 'notifications', 'modeles')

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.modeleMessage.deleteMany({ where: { type, canal } })
    if (count === 0) return

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'modele_message',
      entityId: `${type}:${canal}`,
      metadata: { type, canal, reinitialise: true },
    })
  })
}
