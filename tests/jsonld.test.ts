import { describe, expect, it } from 'vitest'

import { construireJsonLdCabinet, echapperJsonLd } from '@/lib/jsonld'

// Le JSON-LD `Dentist` d'une page cabinet (lot F, D36) : chaque champ absent
// (adresse, coordonnées, téléphone, horaires) doit disparaître du bloc plutôt
// que d'être rendu avec une valeur devinée (D24). Et l'échappement doit tenir
// même si une valeur contenait de quoi fermer la balise `<script>`.

const BASE = {
  nom: 'Cabinet dentaire — Marie-Galante',
  url: 'https://cabinet.example/cabinets/marie-galante',
}

describe('JSON-LD Dentist — champs absents', () => {
  it('ne porte ni adresse, ni coordonnées, ni téléphone, ni horaires sans données', () => {
    const jsonLd = construireJsonLdCabinet({
      nom: BASE.nom,
      url: BASE.url,
      telephone: null,
      adresse: null,
      latitude: null,
      longitude: null,
      horaires: [],
    })

    expect(jsonLd).not.toHaveProperty('address')
    expect(jsonLd).not.toHaveProperty('geo')
    expect(jsonLd).not.toHaveProperty('telephone')
    expect(jsonLd).not.toHaveProperty('openingHoursSpecification')
    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Dentist',
      name: BASE.nom,
      url: BASE.url,
    })
  })

  it('ajoute chaque champ dès qu’il est fourni, et lui seul', () => {
    const jsonLd = construireJsonLdCabinet({
      nom: BASE.nom,
      url: BASE.url,
      telephone: '0590 00 00 00',
      adresse: '12 rue des Écoles, Grand-Bourg',
      latitude: 15.87,
      longitude: -61.28,
      horaires: [
        {
          jour: 'Lundi',
          jourSchemaOrg: 'Monday',
          intervalles: [{ debut: 7 * 60 + 30, fin: 17 * 60 }],
        },
      ],
    })

    expect(jsonLd).toMatchObject({
      telephone: '0590 00 00 00',
      address: { '@type': 'PostalAddress', streetAddress: '12 rue des Écoles, Grand-Bourg' },
      geo: { '@type': 'GeoCoordinates', latitude: 15.87, longitude: -61.28 },
      openingHoursSpecification: [
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: 'https://schema.org/Monday',
          opens: '07:30',
          closes: '17:00',
        },
      ],
    })
  })

  it('n’ajoute pas de coordonnées si une seule des deux manque', () => {
    const jsonLd = construireJsonLdCabinet({
      nom: BASE.nom,
      url: BASE.url,
      telephone: null,
      adresse: null,
      latitude: 15.87,
      longitude: null,
      horaires: [],
    })

    expect(jsonLd).not.toHaveProperty('geo')
  })
})

describe('échappement du JSON-LD injecté dans un <script>', () => {
  it('échappe `<` pour qu’une valeur ne puisse pas fermer la balise', () => {
    const serialise = echapperJsonLd({ nom: '</script><script>alert(1)</script>' })

    expect(serialise).not.toContain('<')
    // `>` n'a pas besoin d'être échappé : c'est la séquence `</script` que le
    // navigateur cherche pour fermer la balise, et `<` seul suffit à la casser.
    expect(serialise).toContain('\\u003c/script>')
  })

  it('reste un JSON valide une fois échappé', () => {
    const valeur = { a: 1, b: '<b>', c: [1, 2, 3] }
    const serialise = echapperJsonLd(valeur)

    // `\u003c` est une échappe Unicode JSON valide : JSON.parse la décode.
    expect(JSON.parse(serialise)).toEqual(valeur)
  })
})
