import 'server-only'

import { prisma } from '@/server/db/client'
import { type HoraireJour, horairesOuvertureCabinet } from '@/lib/dates'
import { siteCodeDuSlug, slugDuSite } from '@/lib/site-slug'

import { HORIZON_JOURS } from './creneaux'

// La page publique d'un cabinet (lot E, D34) : nom, adresse, coordonnées et
// horaires dérivés. Aucun patient, aucun rendez-vous, aucun compte — voir le
// README de ce dossier.

export type SitePublicDetail = {
  id: string
  slug: string
  nom: string
  /** `null` tant que le cabinet ne l'a pas donnée (D24) : jamais un texte de remplacement. */
  adresse: string | null
  latitude: number | null
  longitude: number | null
  /** Vide si aucune plage de présence n'est posée sur l'horizon d'ouverture — jamais en dur. */
  horaires: HoraireJour[]
}

/**
 * Le cabinet correspondant à un slug d'URL, ou `null` s'il n'existe pas ou
 * que le slug ne correspond à aucun `SiteCode` — l'appelant répond alors 404,
 * jamais une erreur.
 *
 * Les horaires sont dérivés des plages de présence à venir, sur le même
 * horizon que la réservation (`HORIZON_JOURS`, D3) : ce que le patient
 * pourrait réserver aujourd'hui, c'est aussi ce que la page lui montre comme
 * heures d'ouverture — les deux lectures restent cohérentes entre elles.
 */
export async function siteDetailParSlug(slug: string): Promise<SitePublicDetail | null> {
  const code = siteCodeDuSlug(slug)
  if (!code) return null

  const site = await prisma.site.findUnique({
    where: { code },
    select: { id: true, code: true, nom: true, adresse: true, latitude: true, longitude: true, actif: true },
  })
  // Un cabinet décoché (D74) : sa page répond « introuvable », comme un slug inconnu.
  if (!site?.actif) return null

  const maintenant = new Date()
  const horizon = new Date(maintenant.getTime() + HORIZON_JOURS * 86_400_000)

  // Rien qui identifie un praticien ou un patient : seulement des bornes
  // horaires, pour un calcul agrégé qui ne quitte pas ce module.
  const plages = await prisma.plageDePresence.findMany({
    where: { siteId: site.id, debut: { lt: horizon }, fin: { gt: maintenant } },
    select: { debut: true, fin: true },
  })

  return {
    id: site.id,
    slug: slugDuSite(site.code),
    nom: site.nom,
    adresse: site.adresse,
    latitude: site.latitude,
    longitude: site.longitude,
    horaires: horairesOuvertureCabinet(plages),
  }
}
