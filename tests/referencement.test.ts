import { describe, expect, it } from 'vitest'

import { env } from '@/config/env'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'

// Référencement local (lot F, D36) : robots.txt doit exclure tout ce qui est
// personnel ou interne, et le sitemap ne doit porter que des pages publiques,
// sans jeton — voir la doc de `src/app/robots.ts` pour la raison de chacune.

describe('robots.ts', () => {
  it('exclut le personnel, la connexion et les pages à jeton du patient', () => {
    const { rules } = robots()
    const regle = Array.isArray(rules) ? rules[0] : rules
    const disallow = Array.isArray(regle?.disallow) ? regle.disallow : [regle?.disallow]

    expect(disallow).toContain('/tableau-de-bord')
    expect(disallow).toContain('/connexion')
    expect(disallow).toContain('/mes-rendez-vous')
    expect(disallow).toContain('/rendez-vous/liste-attente')
  })

  it('autorise le reste, et pointe vers le sitemap sur APP_URL', () => {
    const { rules, sitemap: urlSitemap } = robots()
    const regle = Array.isArray(rules) ? rules[0] : rules

    expect(regle?.allow).toBe('/')
    expect(urlSitemap).toBe(`${env.APP_URL}/sitemap.xml`)
  })
})

describe('sitemap.ts', () => {
  it('contient l’accueil, la réservation et les deux pages cabinet', async () => {
    const entrees = await sitemap()
    const urls = entrees.map((e) => e.url)

    expect(urls).toContain(env.APP_URL)
    expect(urls).toContain(`${env.APP_URL}/rendez-vous`)
    expect(urls).toContain(`${env.APP_URL}/cabinets/marie-galante`)
    expect(urls).toContain(`${env.APP_URL}/cabinets/guadeloupe`)
  })

  it('ne porte aucune page interne ni aucune page à jeton', async () => {
    const entrees = await sitemap()
    const urls = entrees.map((e) => e.url)

    expect(urls.some((u) => u.includes('/tableau-de-bord'))).toBe(false)
    expect(urls.some((u) => u.includes('/connexion'))).toBe(false)
    expect(urls.some((u) => u.includes('/mes-rendez-vous') || u.includes('/rendez-vous/annuler'))).toBe(false)
    expect(urls.some((u) => u.includes('/rendez-vous/liste-attente'))).toBe(false)
  })
})
