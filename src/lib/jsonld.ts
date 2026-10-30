import { formatHeureMinutesISO, type HoraireJour } from '@/lib/dates'

// Données structurées `Dentist` (lot F, JSON-LD), une page cabinet à la fois.
// Extrait de la page pour rester une fonction pure, testable sans rendu React.

/** Sérialise pour un `<script type="application/ld+json">`.
 *
 * `<` est échappé : injecté tel quel via `dangerouslySetInnerHTML`, une valeur
 * qui contiendrait `</script>` fermerait la balise et ferait passer la suite
 * pour du HTML actif. Aucun champ de ce projet ne vient d'une saisie patient à
 * ce jour, mais la garde ne fait pas d'exception pour une donnée qu'on croit
 * sûre. */
export function echapperJsonLd(valeur: unknown): string {
  return JSON.stringify(valeur).replace(/</g, '\\u003c')
}

export type DonneesCabinetJsonLd = {
  nom: string
  url: string
  telephone: string | null
  adresse: string | null
  latitude: number | null
  longitude: number | null
  horaires: HoraireJour[]
}

/**
 * `Dentist` (schema.org) pour une page cabinet. Chaque champ n'apparaît QUE
 * s'il existe réellement (D24) : un cabinet sans adresse ne porte pas de bloc
 * `address`, jamais une valeur devinée.
 */
export function construireJsonLdCabinet(d: DonneesCabinetJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dentist',
    name: d.nom,
    url: d.url,
    ...(d.telephone ? { telephone: d.telephone } : {}),
    ...(d.adresse ? { address: { '@type': 'PostalAddress', streetAddress: d.adresse } } : {}),
    ...(d.latitude !== null && d.longitude !== null
      ? { geo: { '@type': 'GeoCoordinates', latitude: d.latitude, longitude: d.longitude } }
      : {}),
    ...(d.horaires.length > 0
      ? {
          openingHoursSpecification: d.horaires.flatMap((h) =>
            h.intervalles.map((i) => ({
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: `https://schema.org/${h.jourSchemaOrg}`,
              opens: formatHeureMinutesISO(i.debut),
              closes: formatHeureMinutesISO(i.fin),
            })),
          ),
        }
      : {}),
  }
}
