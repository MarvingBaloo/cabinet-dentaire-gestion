import 'server-only'

import { dateNoteVersJour, jourVersDateNote, type NoteJourVue } from '@/lib/notes-jour'
import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { exigerAccesSite, filtreSite } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import { recordRead } from '@/server/db/audit'

/** Notes du jour d'une période (jours civils, bornes incluses). */
export async function listerNotesJour(
  ctx: AuthContext,
  periode: { premierJour: string; dernierJour: string },
  options: { siteId?: string } = {},
): Promise<NoteJourVue[]> {
  await requirePermission(ctx, 'note', 'read')
  if (options.siteId) await exigerAccesSite(ctx, options.siteId)

  const notes = await prisma.noteJour.findMany({
    where: {
      // AND : un étalement écraserait `filtreSite` (défaut de sécurité).
      AND: [filtreSite(ctx), options.siteId ? { siteId: options.siteId } : {}],
      jour: { gte: jourVersDateNote(periode.premierJour), lte: jourVersDateNote(periode.dernierJour) },
    },
    select: {
      id: true,
      jour: true,
      texte: true,
      updatedAt: true,
      site: { select: { id: true, code: true, nom: true } },
      auteur: { select: { prenom: true, nom: true } },
    },
    orderBy: [{ jour: 'asc' }, { createdAt: 'asc' }],
  })

  await recordRead(ctx, 'note_jour', notes.length)

  return notes.map((n) => ({
    id: n.id,
    jour: dateNoteVersJour(n.jour),
    texte: n.texte,
    site: n.site,
    auteur: `${n.auteur.prenom} ${n.auteur.nom.toUpperCase()}`,
    modifieeLe: n.updatedAt.toISOString(),
  }))
}
