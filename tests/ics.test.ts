import { describe, expect, it, vi } from 'vitest'

import { construireIcs, nomFichierIcs } from '@/lib/ics'

// Un .ics mal formé ne provoque pas d'erreur : l'agenda refuse l'import en
// silence, et le patient croit avoir son rendez-vous dans son téléphone. Ces
// tests portent donc sur la forme, au caractère près.

const BASE = {
  debut: new Date('2027-04-05T13:00:00Z'),
  fin: new Date('2027-04-05T13:40:00Z'),
  titre: 'Détartrage',
  lieu: 'Cabinet de Marie-Galante',
  uid: 'abc-123',
  horodatage: new Date('2026-09-17T10:30:00Z'),
}

describe('fichier .ics', () => {
  it('porte les instants en UTC compact, comme les agendas les attendent', () => {
    const ics = construireIcs(BASE)

    expect(ics).toContain('DTSTART:20270405T130000Z')
    expect(ics).toContain('DTEND:20270405T134000Z')
    expect(ics).toContain('DTSTAMP:20260917T103000Z')
  })

  it('sépare ses lignes par CRLF et ferme le calendrier', () => {
    const ics = construireIcs(BASE)

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // Aucun saut de ligne isolé : la RFC impose CRLF partout.
    expect(/[^\r]\n/.test(ics)).toBe(false)
  })

  it('échappe les virgules et points-virgules d’une adresse', () => {
    const ics = construireIcs({
      ...BASE,
      lieu: '12, rue des Écoles; Grand-Bourg',
    })

    expect(ics).toContain('12\\, rue des Écoles\\; Grand-Bourg')
  })

  it('échappe la barre oblique avant tout le reste', () => {
    // Si l'ordre s'inversait, « \, » deviendrait « \\, » puis « \\\, » : le
    // fichier resterait valide mais afficherait des barres parasites.
    const ics = construireIcs({ ...BASE, titre: 'Soin a\\b' })
    expect(ics).toContain('SUMMARY:Soin a\\\\b')
  })

  it('omet le lieu tant que le cabinet n’a pas donné son adresse', () => {
    const ics = construireIcs({ ...BASE, lieu: null })

    // Une ligne LOCATION vide vaut moins que pas de ligne du tout : certains
    // agendas affichent alors un lieu blanc qu'on croit renseigné.
    expect(ics).not.toContain('LOCATION')
  })

  it('replie les lignes trop longues sans couper un caractère accentué', () => {
    const ics = construireIcs({
      ...BASE,
      titre: 'Détartrage complet des deux arcades à Marie-Galante avec contrôle annuel et conseils',
    })

    const lignes = ics.split('\r\n')
    for (const l of lignes) {
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
    }
    // Replié, mais rien de perdu : les continuations commencent par une espace.
    const recompose = lignes
      .reduce<string[]>((acc, l) => {
        if (l.startsWith(' ') && acc.length > 0) acc[acc.length - 1] += l.slice(1)
        else acc.push(l)
        return acc
      }, [])
      .join('\r\n')
    expect(recompose).toContain('SUMMARY:Détartrage complet des deux arcades à Marie-Galante avec contrôle annuel et conseils')
  })

  it('nomme le fichier par le jour du rendez-vous', () => {
    expect(nomFichierIcs(BASE.debut)).toBe('rendez-vous-20270405.ics')
  })
})

describe('identifiant d’événement', () => {
  it('reste unique et se passe de contexte sécurisé', async () => {
    const { identifiantEvenement } = await import('@/lib/ics')

    const vus = new Set(Array.from({ length: 200 }, () => identifiantEvenement()))
    expect(vus.size).toBe(200)
    for (const u of vus) expect(u.endsWith('@cabinet-dentaire')).toBe(true)
  })

  it('tient quand crypto.randomUUID est absent — le cas de la démo en http', async () => {
    // Un navigateur hors contexte sécurisé expose `crypto` sans `randomUUID` :
    // c'est la situation d'un serveur de démonstration en HTTP.
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: undefined })
    try {
      const { identifiantEvenement } = await import('@/lib/ics')
      const u = identifiantEvenement()
      expect(u).toMatch(/^[a-z0-9]+-[a-z0-9]+@cabinet-dentaire$/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
