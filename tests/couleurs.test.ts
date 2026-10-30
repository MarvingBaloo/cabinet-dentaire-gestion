import { describe, expect, it } from 'vitest'

import { contrasteSurBlanc, couleurLisibleSurBlanc } from '@/lib/couleurs'

describe('couleurLisibleSurBlanc', () => {
  it('laisse intacte une couleur déjà lisible', () => {
    expect(couleurLisibleSurBlanc('#14212c')).toBe('#14212c')
  })

  it('assombrit une couleur claire jusqu’à 4,5:1', () => {
    for (const clair of ['#f5c542', '#7ed6a5', '#ffb3b3', '#0078cc']) {
      expect(contrasteSurBlanc(couleurLisibleSurBlanc(clair))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('garde la teinte (jamais un gris pour une couleur valide)', () => {
    const r = couleurLisibleSurBlanc('#f5c542')
    expect(r).toMatch(/^#[0-9a-f]{6}$/)
    expect(r).not.toBe('#f5c542')
  })

  it('tombe sur un gris foncé pour une valeur invalide', () => {
    expect(contrasteSurBlanc(couleurLisibleSurBlanc('rouge'))).toBeGreaterThanOrEqual(4.5)
  })
})
