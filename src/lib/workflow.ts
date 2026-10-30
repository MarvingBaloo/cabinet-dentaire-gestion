import type { StatutRendezVous } from '@prisma/client'

// Les étapes du Workflow, lues par la page (serveur) et par ses lignes (client).

export const ETAPES = ['Attendu', 'Salle d’attente', 'Au fauteuil', 'Terminé', 'En caisse'] as const

export const ETAPE: Partial<Record<StatutRendezVous, number>> = {
  A_CONFIRMER: 0,
  CONFIRME: 0,
  ANNULATION_DEMANDEE: 0,
  SALLE_ATTENTE: 1,
  AU_FAUTEUIL: 2,
  TERMINE: 3,
  EN_CAISSE: 4,
}

export const STATUTS_DU_PARCOURS = Object.keys(ETAPE) as StatutRendezVous[]

/** Les colonnes d'une ligne, partagées avec l'en-tête des étapes pour qu'ils s'alignent. */
export const COLONNES_LIGNE = 'lg:grid-cols-[3.5rem_13rem_minmax(0,1fr)_26.25rem_9.5rem]'
