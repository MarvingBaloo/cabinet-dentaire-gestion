import { describe, expect, it } from 'vitest'

import { horairesDuJour, momentDe, propositions } from '@/lib/creneaux-montres'

// Ce que la réservation en ligne montre des créneaux libres (P1, 26/10) : peu à la fois, jamais collés.

const h = (hh: number, mm = 0) => hh * 60 + mm
const id = (m: number) => m

/** Une journée pleine de libres, du quart d'heure de 8 h à celui de 17 h 45. */
const journee = Array.from({ length: 40 }, (_, i) => h(8) + i * 15)

describe('momentDe', () => {
  it('matin avant midi, midi jusqu’à 14 h, après-midi ensuite', () => {
    expect(momentDe(h(11, 45))).toBe('matin')
    expect(momentDe(h(12))).toBe('midi')
    expect(momentDe(h(13, 45))).toBe('midi')
    expect(momentDe(h(14))).toBe('apres-midi')
  })
})

describe('horairesDuJour', () => {
  it('au plus un horaire par moment, même quand tout est libre', () => {
    const montres = horairesDuJour('2026-10-27', journee, id)
    expect(montres.map((m) => m.moment)).toEqual(['matin', 'midi', 'apres-midi'])
    for (const m of montres) expect(momentDe(m.creneau)).toBe(m.moment)
  })

  it('toujours les mêmes pour un même jour, et pas forcément les premiers', () => {
    expect(horairesDuJour('2026-10-27', journee, id)).toEqual(horairesDuJour('2026-10-27', journee, id))
    const premiers = new Set(['2026-10-27', '2026-10-28', '2026-10-29', '2026-11-02'].map((j) => horairesDuJour(j, journee, id)[0]!.creneau))
    expect(premiers.size).toBeGreaterThan(1)
  })

  it('jamais deux horaires à moins d’une heure, même à la frontière de deux moments', () => {
    for (const jour of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-11-02', '2026-11-03']) {
      const montres = horairesDuJour(jour, journee, id).map((m) => m.creneau)
      for (const a of montres) for (const b of montres) if (a !== b) expect(Math.abs(a - b)).toBeGreaterThanOrEqual(60)
    }
    // Seuls 13 h 30 et 14 h 00 libres : l'après-midi n'est pas montré, il collerait au midi.
    expect(horairesDuJour('2026-10-28', [h(13, 30), h(14)], id).map((m) => m.creneau)).toEqual([h(13, 30)])
  })

  it('ne montre que des horaires libres, et rien d’un moment sans place', () => {
    const libres = [h(9, 30), h(9, 45)]
    expect(horairesDuJour('2026-10-27', libres, id)).toEqual([
      { moment: 'matin', creneau: expect.toSatisfy((x: number) => libres.includes(x)) },
    ])
  })
})

describe('propositions', () => {
  it('trois jours différents, à des moments qui changent', () => {
    const parJour = new Map([
      ['2026-10-26', journee],
      ['2026-10-27', journee],
      ['2026-10-28', journee],
      ['2026-10-29', journee],
    ])
    const retenues = propositions(parJour, id)
    expect(retenues).toHaveLength(3)
    expect(retenues.map(momentDe)).toEqual(['matin', 'apres-midi', 'midi'])
  })

  it('un jour sans le moment voulu donne ce qu’il a ; moins de trois jours, moins de propositions', () => {
    const parJour = new Map([
      ['2026-10-26', [h(15)]],
      ['2026-10-27', [h(10)]],
    ])
    expect(propositions(parJour, id)).toEqual([h(15), h(10)])
  })
})
