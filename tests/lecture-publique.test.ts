import { afterAll, describe, expect, it } from 'vitest'

import { prisma } from '@/server/db/client'
import { tropDeLecturesPubliques } from '@/server/services/lecture-publique'

// Ce que ces tests cherchent à prouver (D25) :
//   - sous le seuil, la lecture est autorisée
//   - au-delà, elle est refusée
//   - le compteur repart à zéro dans la fenêtre suivante
//   - deux adresses IP ne se gênent jamais
//
// Le seuil et la fenêtre sont ceux du service (300 lectures / 15 minutes) :
// plutôt que de boucler 300 fois, les tests préchargent le compteur — exactement
// ce qu'un appel précédent y aurait laissé.

const SUFFIXE = Date.now()
const FENETRE_MS = 15 * 60_000
const debutFenetre = (t: number) => new Date(Math.floor(t / FENETRE_MS) * FENETRE_MS)

const ipsCreees: string[] = []
function ipDeTest(decalage: number): string {
  const n = SUFFIXE + decalage
  const ip = `10.97.${(n >> 8) & 255}.${n & 255}`
  ipsCreees.push(ip)
  return ip
}

afterAll(async () => {
  await prisma.compteurLecturePublique.deleteMany({ where: { ipAddress: { in: ipsCreees } } })
  await prisma.$disconnect()
})

describe('limitation des lectures publiques de créneaux', () => {
  it('autorise sous le seuil', async () => {
    const ip = ipDeTest(0)
    const fenetre = debutFenetre(Date.now())
    await prisma.compteurLecturePublique.create({ data: { ipAddress: ip, fenetre, nombre: 250 } })

    expect(await tropDeLecturesPubliques(ip)).toBe(false)

    const compteur = await prisma.compteurLecturePublique.findUniqueOrThrow({
      where: { ipAddress_fenetre: { ipAddress: ip, fenetre } },
    })
    expect(compteur.nombre).toBe(251)
  })

  it('refuse au-delà du seuil', async () => {
    const ip = ipDeTest(1)
    const fenetre = debutFenetre(Date.now())
    await prisma.compteurLecturePublique.create({ data: { ipAddress: ip, fenetre, nombre: 300 } })

    expect(await tropDeLecturesPubliques(ip)).toBe(true)
  })

  it('repart à zéro dans la fenêtre suivante', async () => {
    const ip = ipDeTest(2)
    const fenetrePassee = new Date(debutFenetre(Date.now()).getTime() - FENETRE_MS)
    // La fenêtre précédente était déjà au-delà du seuil : si le compteur ne
    // repartait pas à zéro, ce premier appel dans la fenêtre courante serait
    // refusé à tort.
    await prisma.compteurLecturePublique.create({
      data: { ipAddress: ip, fenetre: fenetrePassee, nombre: 500 },
    })

    expect(await tropDeLecturesPubliques(ip)).toBe(false)

    const fenetreActuelle = debutFenetre(Date.now())
    const compteur = await prisma.compteurLecturePublique.findUniqueOrThrow({
      where: { ipAddress_fenetre: { ipAddress: ip, fenetre: fenetreActuelle } },
    })
    expect(compteur.nombre).toBe(1)
  })

  it('n’affecte pas une autre adresse', async () => {
    const ip1 = ipDeTest(3)
    const ip2 = ipDeTest(4)
    await prisma.compteurLecturePublique.create({
      data: { ipAddress: ip1, fenetre: debutFenetre(Date.now()), nombre: 300 },
    })

    expect(await tropDeLecturesPubliques(ip1)).toBe(true)
    expect(await tropDeLecturesPubliques(ip2)).toBe(false)
  })

  it('n’est jamais limitée quand l’adresse est inconnue', async () => {
    expect(await tropDeLecturesPubliques('inconnue')).toBe(false)
  })
})
