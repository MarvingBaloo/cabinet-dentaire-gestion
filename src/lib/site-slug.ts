import { SiteCode } from '@prisma/client'

// Slug d'URL pour la page publique d'un cabinet (lot E, D34).
//
// Dérivé de `SiteCode`, pas une colonne à part : l'enum est déjà stable et
// unique (deux sites, définitifs, D5) — une colonne aurait dupliqué une
// identité qui existe déjà, pour un besoin que la table `Site` couvre déjà.
//
// Partagé serveur/client : ni `'use client'` ni `server-only`, comme
// `src/lib/statuts.ts`. Une page serveur compose l'URL, un composant client
// (lien « en savoir plus ») en a besoin tout autant.

const SLUGS: Record<SiteCode, string> = {
  MARIE_GALANTE: 'marie-galante',
  GUADELOUPE: 'guadeloupe',
}

export function slugDuSite(code: SiteCode): string {
  return SLUGS[code]
}

/** `null` si le slug ne correspond à aucun cabinet — jamais une exception :
 *  l'appelant (une page) doit pouvoir répondre 404, pas planter. */
export function siteCodeDuSlug(slug: string): SiteCode | null {
  const entree = (Object.entries(SLUGS) as [SiteCode, string][]).find(([, s]) => s === slug)
  return entree ? entree[0] : null
}
