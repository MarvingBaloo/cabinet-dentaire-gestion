import type { MetadataRoute } from 'next'

import { env } from '@/config/env'
import { slugDuSite } from '@/lib/site-slug'
import { listerSitesPublics } from '@/server/queries/public/catalogue'

// Référencement local (lot F, D36). Seules les pages publiques et sans jeton
// y figurent — voir `robots.ts` pour ce qu'on exclut et pourquoi.
// Généré à chaque requête, jamais à la construction : la liste des cabinets vient de
// la base, absente d'un `docker build` (NAS, hébergeur HDS). La CI, qui a une base,
// ne voyait pas l'échec.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sites = await listerSitesPublics()
  const maintenant = new Date()

  return [
    { url: env.APP_URL, lastModified: maintenant, changeFrequency: 'monthly', priority: 1 },
    {
      url: `${env.APP_URL}/rendez-vous`,
      lastModified: maintenant,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...sites.map((s) => ({
      url: `${env.APP_URL}/cabinets/${slugDuSite(s.code)}`,
      lastModified: maintenant,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ]
}
