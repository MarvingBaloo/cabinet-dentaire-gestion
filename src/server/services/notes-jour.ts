import 'server-only'

import { jourVersDateNote } from '@/lib/notes-jour'
import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { exigerAccesSite } from '@/server/auth/portee'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import type {
  CreerNoteJourInput,
  ModifierNoteJourInput,
  SupprimerNoteJourInput,
} from '@/server/validation/notes-jour'

// Le texte d'une note n'entre JAMAIS dans `metadata` : il peut nommer un
// patient (D9). Aucune restriction à l'auteur : le droit et la portée du site
// suffisent.

export class NoteJourIntrouvableError extends Error {
  constructor() {
    super('Note introuvable.')
    this.name = 'NoteJourIntrouvableError'
  }
}

export async function creerNoteJour(ctx: AuthContext, input: CreerNoteJourInput) {
  await requirePermission(ctx, 'note', 'create')
  await exigerAccesSite(ctx, input.siteId)

  return prisma.$transaction(async (tx) => {
    const creee = await tx.noteJour.create({
      data: {
        siteId: input.siteId,
        jour: jourVersDateNote(input.jour),
        texte: input.texte,
        auteurId: ctx.userId,
      },
      select: { id: true },
    })
    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'note_jour',
      entityId: creee.id,
      metadata: { siteId: input.siteId, jour: input.jour },
    })
    return creee
  })
}

async function existante(id: string) {
  const note = await prisma.noteJour.findUnique({ where: { id }, select: { id: true, siteId: true, jour: true } })
  if (!note) throw new NoteJourIntrouvableError()
  return note
}

export async function modifierNoteJour(ctx: AuthContext, input: ModifierNoteJourInput) {
  const note = await existante(input.id)
  await requirePermission(ctx, 'note', 'update')
  await exigerAccesSite(ctx, note.siteId)

  await prisma.$transaction(async (tx) => {
    await tx.noteJour.update({ where: { id: note.id }, data: { texte: input.texte } })
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'note_jour',
      entityId: note.id,
      metadata: { siteId: note.siteId, jour: note.jour.toISOString().slice(0, 10) },
    })
  })
}

export async function supprimerNoteJour(ctx: AuthContext, input: SupprimerNoteJourInput) {
  const note = await existante(input.id)
  await requirePermission(ctx, 'note', 'delete')
  await exigerAccesSite(ctx, note.siteId)

  await prisma.$transaction(async (tx) => {
    await tx.noteJour.delete({ where: { id: note.id } })
    await recordAudit(tx, ctx, {
      action: 'DELETE',
      entityType: 'note_jour',
      entityId: note.id,
      metadata: { siteId: note.siteId, jour: note.jour.toISOString().slice(0, 10) },
    })
  })
}
