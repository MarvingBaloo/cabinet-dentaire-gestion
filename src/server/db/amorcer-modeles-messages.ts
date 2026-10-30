// ⚠ PAS de `import 'server-only'` ici, à la différence du reste de
// `src/server/` — et c'est volontaire. `prisma/seed.ts` doit pouvoir importer
// cette fonction, et il tourne via `tsx prisma/seed.ts` (`npm run db:seed`),
// SANS le `--conditions react-server` qui neutralise `server-only` pour
// `scripts/worker-notifications.ts`. L'importer ici ferait échouer le seed dès
// son premier import, avant même la moindre ligne de log.
//
// Extraite de `prisma/seed.ts` pour rester testable sans faire tourner tout le
// seed (rôles, permissions, sites, fauteuils, catalogue…) — voir
// `tests/modeles-messages-action.test.ts`.

import type { Prisma, PrismaClient } from '@prisma/client'
import { CanalNotification } from '@prisma/client'

import { TYPES_MODELISABLES, modeleParDefaut } from '@/lib/modeles-messages'

type ClientAmorce = PrismaClient | Prisma.TransactionClient

/**
 * Sème un modèle par (type, canal) modélisable — SEULEMENT s'il est absent
 * (`skipDuplicates`, contrainte `@@unique([type, canal])`). Jamais de
 * condition « table vide » comme pour le catalogue des motifs : la clé est
 * stable ici (pas un libellé que le cabinet peut renommer), donc
 * `skipDuplicates` seul suffit, à chaque appel — un modèle modifié par le
 * cabinet n'est JAMAIS touché.
 *
 * Un modèle semé et jamais modifié (`modifieParId` nul) suit en revanche le
 * défaut du code : sans cela, un texte par défaut amélioré (le lien vers
 * l'espace patient, 19/10) n'atteindrait jamais une base déjà semée.
 *
 * Rend le nombre de lignes réellement créées.
 */
export async function amorcerModelesMessages(db: ClientAmorce): Promise<number> {
  const donnees = TYPES_MODELISABLES.flatMap((type) =>
    ([CanalNotification.SMS, CanalNotification.EMAIL] as const).map((canal) => {
      const defaut = modeleParDefaut(type, canal)
      return { type, canal, sujet: defaut.sujet, corps: defaut.corps }
    }),
  )

  const { count } = await db.modeleMessage.createMany({ data: donnees, skipDuplicates: true })
  for (const d of donnees) {
    await db.modeleMessage.updateMany({
      where: { type: d.type, canal: d.canal, modifieParId: null },
      data: { sujet: d.sujet, corps: d.corps },
    })
  }
  return count
}
