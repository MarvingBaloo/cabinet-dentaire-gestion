import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// Lectures du personnel interne. Chaque fonction commence par son garde et se
// termine par sa trace d'audit : c'est le seul chemin par lequel ces données
// sortent de la base (D4, D9).
//
// `select` explicite plutôt que l'entité entière : `password_hash` et
// `mfa_secret` ne doivent jamais quitter la couche serveur, et un `include`
// large les emporterait sans que personne le remarque.

const CHAMPS_PUBLICS = {
  id: true,
  email: true,
  nom: true,
  prenom: true,
  actif: true,
  lastLoginAt: true,
  mfaEnrolledAt: true,
  roles: { select: { role: { select: { name: true } } } },
  sites: { select: { site: { select: { id: true, code: true, nom: true } } } },
} as const

export async function listerUtilisateurs(ctx: AuthContext) {
  await requirePermission(ctx, 'utilisateur', 'read')

  // Pas de filtre par site : qui a `utilisateur:read` voit tout le personnel (D5). Secrétariat et
  // assistanat ne l'ont plus (D67).
  const utilisateurs = await prisma.user.findMany({
    select: CHAMPS_PUBLICS,
    orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
  })

  await recordRead(ctx, 'utilisateur', utilisateurs.length)
  return utilisateurs
}

export async function lireUtilisateur(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'utilisateur', 'read')

  const utilisateur = await prisma.user.findUnique({ where: { id }, select: CHAMPS_PUBLICS })

  // Tracé même quand rien n'est trouvé : une série de lectures sur des
  // identifiants inexistants est un motif de balayage, et c'est exactement ce
  // qu'un journal d'accès doit permettre de reconstituer.
  await recordRead(ctx, 'utilisateur', utilisateur ? 1 : 0, id)
  return utilisateur
}

export async function listerSites(ctx: AuthContext) {
  await requirePermission(ctx, 'site', 'read')

  // Les rattachements proposés aux comptes et aux postes : les cabinets en activité seulement (D74).
  const sites = await prisma.site.findMany({ where: { actif: true }, orderBy: { code: 'asc' } })

  await recordRead(ctx, 'site', sites.length)
  return sites
}
