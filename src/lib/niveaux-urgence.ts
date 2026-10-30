import type { NiveauUrgence } from '@prisma/client'

// Les niveaux de l'assistant des urgences (D77), tels que le cabinet les lit : dans l'agenda, la fiche du
// rendez-vous et la bulle du site. Module neutre, ni serveur ni client (même raison que `statuts.ts`).

export const NIVEAU_URGENCE: Record<NiveauUrgence, { libelle: string; delai: string | null; couleur: string; fond: string }> = {
  VITALE: { libelle: 'Urgence vitale', delai: null, couleur: '#B42318', fond: '#FBEAE8' },
  URGENCE_FORTE: { libelle: 'Urgence forte', delai: 'sous 48 heures', couleur: '#C2410C', fond: '#FFF1E6' },
  URGENCE_SIMPLE: { libelle: 'Urgence simple', delai: 'sous 72 heures', couleur: '#B45309', fond: '#FEF3E2' },
  DIFFERABLE: { libelle: 'Différable', delai: 'dans la semaine', couleur: '#9A6412', fond: '#FDF3E1' },
  NON_URGENT: { libelle: 'Pas urgent', delai: null, couleur: '#2C6B62', fond: '#E4F1EE' },
}

/** Le niveau qui compte : celui du cabinet s'il a corrigé l'assistant, sinon celui de l'assistant. */
export function niveauRetenu(
  c: { niveau: NiveauUrgence | null; niveauCabinet: NiveauUrgence | null } | null | undefined,
): NiveauUrgence | null {
  return c?.niveauCabinet ?? c?.niveau ?? null
}
