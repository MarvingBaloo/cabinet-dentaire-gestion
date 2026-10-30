import { describe, expect, it } from 'vitest'

import { afficherTelephone, versInternational } from '@/lib/telephone'

describe('affichage d’un numéro', () => {
  it('groupe un numéro d’outre-mer, de métropole et un numéro national', () => {
    expect(afficherTelephone('+590690123456')).toBe('+590 690 12 34 56')
    expect(afficherTelephone('+33639989008')).toBe('+33 6 39 98 90 08')
    expect(afficherTelephone('0690123456')).toBe('06 90 12 34 56')
  })
  it('laisse tel quel ce qu’il ne reconnaît pas', () => {
    expect(afficherTelephone('+4930123')).toBe('+4930123')
  })
})

describe('numéro tapé à la française', () => {
  it('un portable guadeloupéen prend l’indicatif +590, un portable de métropole +33', () => {
    expect(versInternational('0690 12 34 56')).toBe('+590690123456')
    expect(versInternational('06.91.12.34.56')).toBe('+590691123456')
    expect(versInternational('06 63 12 34 56')).toBe('+33663123456')
    expect(versInternational('07 12 34 56 78')).toBe('+33712345678')
  })
  it('reconnaît les autres outre-mer', () => {
    expect(versInternational('0696123456')).toBe('+596696123456')
    expect(versInternational('0694123456')).toBe('+594694123456')
    expect(versInternational('0692123456')).toBe('+262692123456')
  })
  it('laisse un numéro déjà international, et convertit le préfixe 00', () => {
    expect(versInternational('+590 690 12 34 56')).toBe('+590690123456')
    expect(versInternational('00590690123456')).toBe('+590690123456')
  })
})
