import type { MetadataRoute } from 'next'

import { env } from '@/config/env'

// Référencement local (lot F, D36). Exclut tout ce qui est personnel ou
// interne : le personnel (`/tableau-de-bord`, `/connexion`) et l'accès
// patient par jeton (`/mes-rendez-vous`, `/rendez-vous/liste-attente`),
// qui n'ont ni l'un ni l'autre de contenu à indexer — une page vide de jeton
// affiche une simple demande de numéro, jamais une information publique.
//
// Chaque page listée ici porte aussi `robots: { index: false }` dans sa propre
// métadonnée (ou celle de son layout) : la redite est voulue, comme le README
// de `queries/public/` le fait pour la limitation de débit — un moteur qui
// ignorerait ce fichier ne doit pas se rabattre sur une page qui l'autorise.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/tableau-de-bord',
        '/connexion',
        '/mes-rendez-vous',
        '/rendez-vous/annuler',
        '/rendez-vous/liste-attente',
      ],
    },
    sitemap: `${env.APP_URL}/sitemap.xml`,
  }
}
