import { SiteCode } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@/server/db/client'
import { siteDetailParSlug } from '@/server/queries/public/site'

// La page publique d'un cabinet (lot E, D34) ne doit jamais inventer ce que le
// cabinet n'a pas donné (D24) : un champ absent vaut `null`, jamais un texte
// ou une coordonnée de remplacement. Ce fichier mute temporairement le site
// MARIE_GALANTE — semé une fois par migration, partagé par toute la suite —
// et le remet EXACTEMENT dans l'état où il l'a trouvé, fileParallelism étant
// désactivé (un seul fichier de test touche la base à la fois).

let siteId: string
let original: { adresse: string | null; latitude: number | null; longitude: number | null }

beforeAll(async () => {
  const site = await prisma.site.findUniqueOrThrow({
    where: { code: SiteCode.MARIE_GALANTE },
    select: { id: true, adresse: true, latitude: true, longitude: true },
  })
  siteId = site.id
  original = { adresse: site.adresse, latitude: site.latitude, longitude: site.longitude }
})

afterAll(async () => {
  await prisma.site.update({ where: { id: siteId }, data: original })
  await prisma.$disconnect()
})

describe('lecture publique d’un cabinet — rien d’inventé (D24)', () => {
  it('rend `null` un champ que le cabinet n’a pas donné, jamais un texte de remplacement', async () => {
    await prisma.site.update({
      where: { id: siteId },
      data: { adresse: null, latitude: null, longitude: null },
    })

    const detail = await siteDetailParSlug('marie-galante')

    expect(detail?.adresse).toBeNull()
    expect(detail?.latitude).toBeNull()
    expect(detail?.longitude).toBeNull()
  })

  it('rend l’adresse et les coordonnées dès qu’elles sont données', async () => {
    await prisma.site.update({
      where: { id: siteId },
      data: { adresse: '12 rue des Écoles, Grand-Bourg', latitude: 15.87, longitude: -61.28 },
    })

    const detail = await siteDetailParSlug('marie-galante')

    expect(detail?.adresse).toBe('12 rue des Écoles, Grand-Bourg')
    expect(detail?.latitude).toBe(15.87)
    expect(detail?.longitude).toBe(-61.28)
  })

  it('rend `null` pour un slug qui ne correspond à aucun cabinet, jamais une exception', async () => {
    expect(await siteDetailParSlug('nawak')).toBeNull()
  })

  it('dérive toujours les horaires plutôt que de les rendre en dur', async () => {
    const detail = await siteDetailParSlug('marie-galante')

    // La FORME est éprouvée ici (un tableau, jamais un texte figé) ; le calcul
    // de fusion lui-même est couvert en isolation par tests/dates.test.ts —
    // la base de test porte les plages d'autres fichiers, hors du contrôle de
    // celui-ci, donc rien n'est affirmé sur son contenu précis.
    expect(Array.isArray(detail?.horaires)).toBe(true)
  })
})
