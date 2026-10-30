// Couleurs et badges des deux cabinets, pour la vue consolidée de l'agenda
// (lot 4). Un cabinet s'y distingue par la couleur ET par un badge textuel,
// jamais la couleur seule (RGAA) — voir `LegendeSites` et son usage dans
// `grille-jour.tsx` / `grille-semaine.tsx`.
//
// Deux sites, fixes et permanents (D5) : une table figée plutôt qu'un calcul,
// cohérente avec `SiteCode` posé en enum pour la même raison.
//
// Module neutre, ni `'use client'` ni `server-only` — même règle que
// `src/lib/statuts.ts` et `src/lib/jours-feries.ts` : lu depuis des composants
// serveur aujourd'hui, potentiellement depuis un composant client demain.

export const COULEUR_SITE: Record<string, string> = {
  MARIE_GALANTE: '#387a70',
  GUADELOUPE: '#b45309',
}

export const BADGE_SITE: Record<string, string> = {
  MARIE_GALANTE: 'MG',
  GUADELOUPE: 'GP',
}

const COULEUR_PAR_DEFAUT = '#6b7280'

/** Couleur du cabinet, avec un repli neutre si un site inconnu apparaissait un jour. */
export function couleurSite(code: string): string {
  return COULEUR_SITE[code] ?? COULEUR_PAR_DEFAUT
}

/** Badge textuel du cabinet — jamais seulement sa couleur (RGAA). */
export function badgeSite(code: string, nom: string): string {
  return BADGE_SITE[code] ?? nom.slice(0, 2).toUpperCase()
}
