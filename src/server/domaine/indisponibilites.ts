import { type TypeIndisponibilite } from '@prisma/client'

import { type Creneau, seChevauchent } from './agenda'

// Garde anti-orphelin (Q5) pour les congés, fermetures et maintenances
// (compléments d'agenda, lot 2). Même principe que
// `src/server/domaine/presences.ts` : fonction PURE, aucun accès base, rejouée
// à l'identique par `src/server/services/indisponibilites.ts`.
//
// Différent de `rendezVousOrphelins` (presences.ts) : une présence répond
// « quelle plage couvre ce rendez-vous ? », une indisponibilité répond
// « est-ce que je CHEVAUCHE ce rendez-vous et vise-t-elle son praticien ou son
// site ? ». Il n'y a rien à réconcilier ensuite — l'indisponibilité elle-même
// EST ce qui bloque, elle ne dérive aucune autre table.

export type IndisponibiliteVoulue = Creneau & {
  type: TypeIndisponibilite
  praticienId: string | null
  siteId: string | null
}

export type RendezVousActifPourIndisponibiliteConnu = Creneau & {
  id: string
  praticienId: string
  siteId: string
}

/**
 * Parmi des rendez-vous actifs, lesquels cette indisponibilité rendrait
 * impossibles à honorer (Q5 : jamais de rendez-vous orphelin) ?
 *
 * Une indisponibilité vise un praticien (congé), un site (fermeture), ou les
 * deux à la fois (maintenance d'un fauteuil précis) — jamais ni l'un ni
 * l'autre, contrainte posée en base (`indispo_porte_sur_quelque_chose`,
 * prisma/sql/03_agenda_contraintes.sql). Un rendez-vous est concerné dès que
 * la période chevauche ET que CHAQUE critère renseigné (praticien, site)
 * correspond — un critère absent ne restreint rien.
 *
 * Volontairement AVEUGLE à la portée (D5) de qui pose le congé : un congé
 * praticien (`siteId` nul) bloque sur un rendez-vous de n'importe quel site,
 * y compris un site que l'appelant ne voit pas, pour ne jamais laisser
 * orpheliner ce rendez-vous-là (Q5). C'est au service appelant
 * (`services/indisponibilites.ts`, `IndisponibiliteBloqueeError`) de ne PAS
 * détailler dans le message ceux des sites hors de la portée de l'appelant —
 * D49.
 */
export function rendezVousBloquesParIndisponibilite(
  rendezVous: RendezVousActifPourIndisponibiliteConnu[],
  indispo: IndisponibiliteVoulue,
): RendezVousActifPourIndisponibiliteConnu[] {
  return rendezVous.filter((rdv) => {
    if (!seChevauchent(indispo, rdv)) return false
    if (indispo.praticienId && rdv.praticienId !== indispo.praticienId) return false
    if (indispo.siteId && rdv.siteId !== indispo.siteId) return false
    return true
  })
}
