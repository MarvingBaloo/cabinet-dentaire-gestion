import { describe, expect, it } from 'vitest'

import { estJourFerie, joursFeriesAnnee, joursFeriesEntre, libelleFerie } from '@/lib/jours-feries'

// Tests du domaine des jours fériés (Q29, Q30, compléments d'agenda lot 2).
// Aucune base : ce sont des fonctions pures.

describe('joursFeriesAnnee', () => {
  it('2026 : lundi de Pâques le 6 avril (Pâques = 5 avril)', () => {
    const feries = joursFeriesAnnee(2026)
    expect(feries.find((f) => f.libelle === 'Lundi de Pâques')?.date).toBe('2026-04-06')
  })

  it('2027 : lundi de Pâques le 29 mars (Pâques = 28 mars)', () => {
    const feries = joursFeriesAnnee(2027)
    expect(feries.find((f) => f.libelle === 'Lundi de Pâques')?.date).toBe('2027-03-29')
  })

  it('2026 : Ascension un jeudi, Pentecôte un lundi — toujours vrai, Pâques tombe un dimanche', () => {
    const feries = joursFeriesAnnee(2026)
    const ascension = new Date(`${feries.find((f) => f.libelle === 'Ascension')!.date}T12:00:00.000Z`)
    const pentecote = new Date(`${feries.find((f) => f.libelle === 'Lundi de Pentecôte')!.date}T12:00:00.000Z`)
    expect(ascension.getUTCDay()).toBe(4) // jeudi
    expect(pentecote.getUTCDay()).toBe(1) // lundi
  })

  it('exactement 12 dates : les 11 fériés légaux plus le 27 mai', () => {
    expect(joursFeriesAnnee(2026)).toHaveLength(12)
    expect(joursFeriesAnnee(2026).map((f) => f.date)).toContain('2026-05-27')
  })

  it('rien d’autre — ni Vendredi saint, ni Mardi gras, ni fête coutumière', () => {
    const dates = joursFeriesAnnee(2026).map((f) => f.date)
    // Vendredi saint 2026 (deux jours avant Pâques, le 5 avril) : 3 avril.
    expect(dates).not.toContain('2026-04-03')
    // Mardi gras 2026 (47 jours avant Pâques) : 17 février.
    expect(dates).not.toContain('2026-02-17')
  })

  it('triée par ordre chronologique', () => {
    const dates = joursFeriesAnnee(2026).map((f) => f.date)
    const triees = [...dates].sort()
    expect(dates).toEqual(triees)
  })
})

describe('estJourFerie / libelleFerie', () => {
  it('vrai un jour férié fixe, faux la veille et le lendemain', () => {
    expect(estJourFerie('2026-05-27')).toBe(true)
    expect(estJourFerie('2026-05-26')).toBe(false)
    expect(estJourFerie('2026-05-28')).toBe(false)
  })

  it('Pâques lui-même n’est PAS un jour férié — seul le lundi l’est', () => {
    expect(estJourFerie('2026-04-05')).toBe(false)
    expect(estJourFerie('2026-04-06')).toBe(true)
  })

  it('libelleFerie rend le libellé, ou null hors férié', () => {
    expect(libelleFerie('2026-05-27')).toBe('Abolition de l’esclavage (Guadeloupe)')
    expect(libelleFerie('2026-05-26')).toBeNull()
  })
})

describe('joursFeriesEntre', () => {
  it('bornes incluses', () => {
    const feries = joursFeriesEntre('2026-01-01', '2026-01-01')
    expect(feries.map((f) => f.date)).toEqual(['2026-01-01'])
  })

  it('traverse une frontière d’année sans rien perdre', () => {
    const feries = joursFeriesEntre('2026-12-20', '2027-01-05')
    expect(feries.map((f) => f.date)).toEqual(['2026-12-25', '2027-01-01'])
  })

  it('vide quand la fenêtre ne contient aucun férié', () => {
    expect(joursFeriesEntre('2026-01-02', '2026-01-05')).toEqual([])
  })
})
