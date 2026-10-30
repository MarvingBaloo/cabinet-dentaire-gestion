import type { RoleName } from '@prisma/client'

// Module neutre (ni 'use client' ni server-only) : une constante exportée d'un
// fichier 'use client' n'arrive dans un composant serveur que sous forme de
// référence client — les pastilles des comptes s'affichaient vides.

export const LIBELLE_ROLE: Record<RoleName, string> = {
  PRATICIEN: 'Praticien',
  SECRETAIRE: 'Secrétaire',
  ASSISTANTE: 'Assistante',
  ADMIN: 'Administrateur',
}

export const ORDRE_ROLES: RoleName[] = ['PRATICIEN', 'SECRETAIRE', 'ASSISTANTE', 'ADMIN']
