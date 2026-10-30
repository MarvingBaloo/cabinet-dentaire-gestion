import { TypeNotification } from '@prisma/client'

// Catégories de notifications pour les préférences patient par canal (phase 4,
// lot 5b, D44) : ce qu'une préférence peut couper, et ce qu'elle ne peut
// jamais couper. Voir le commentaire du modèle `PreferenceNotification` dans
// le schéma pour le détail de chaque catégorie.
//
// Ni 'use client' ni server-only : le worker (`src/server/notifications/file.ts`,
// server-only) et un futur écran d'aperçu partagent la même règle — un seul
// endroit décide de quelle catégorie relève un type d'événement.

export type CategorieNotification = 'TRANSACTIONNEL' | 'INFORMATION_SOIN' | 'NON_ESSENTIEL'

export const LIBELLE_CATEGORIE: Record<CategorieNotification, string> = {
  TRANSACTIONNEL: 'Confirmations, modifications et annulations',
  INFORMATION_SOIN: 'Rappels de rendez-vous',
  NON_ESSENTIEL: 'Autres messages (places libérées sur la liste d’attente)',
}

/**
 * La catégorie d'un type de notification.
 *
 * `switch` exhaustif sans `default` fonctionnel : la branche `default`
 * n'existe que pour forcer `type` à être `never` une fois tous les cas
 * couverts — un `TypeNotification` ajouté sans y être affecté fait échouer la
 * compilation ici plutôt que de tomber, en silence, dans une catégorie par
 * défaut.
 */
export function categorieNotification(type: TypeNotification): CategorieNotification {
  switch (type) {
    // Réponse directe à un geste du patient ou du cabinet sur SON rendez-vous :
    // toujours envoyée, aucune préférence ne la coupe.
    case TypeNotification.CONFIRMATION_RESERVATION:
    case TypeNotification.MODIFICATION_RENDEZ_VOUS:
    case TypeNotification.ANNULATION_PATIENT:
    case TypeNotification.ANNULATION_CABINET:
    case TypeNotification.REPONSE_SMS:
      return 'TRANSACTIONNEL'

    // Information de soin (RGPD) : activée par défaut, désactivable par canal —
    // le désabonnement des messages non essentiels ne la coupe PAS.
    case TypeNotification.RAPPEL_J2:
    case TypeNotification.RAPPEL_H3:
      return 'INFORMATION_SOIN'

    // Coupée par le désabonnement des messages non essentiels.
    case TypeNotification.CRENEAU_LIBERE:
      return 'NON_ESSENTIEL'

    default: {
      const exhaustif: never = type
      throw new Error(`Type de notification sans catégorie : ${String(exhaustif)}`)
    }
  }
}
