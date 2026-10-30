import { afterAll, describe, expect, it } from 'vitest'

import { declarerPoste, identifierPoste } from '@/server/auth/poste'
import { prisma } from '@/server/db/client'

// D7 exige de tracer depuis quel poste une action est faite. L'adresse IP ne
// suffit pas : tout le cabinet sort sur une seule IP publique (NAT).

afterAll(async () => {
  await prisma.$disconnect()
})

describe('identification du poste de travail', () => {
  it('déclare un poste et le reconnaît ensuite', async () => {
    const { secret, poste } = await declarerPoste()
    expect((await identifierPoste(secret))?.id).toBe(poste.id)
  })

  it('ne reconnaît ni un secret absent ni un secret inventé', async () => {
    expect(await identifierPoste(undefined)).toBeNull()
    expect(await identifierPoste('secret-inventé')).toBeNull()
  })

  // Même raison que pour le jeton de session : un export de la base ne doit pas
  // permettre de se faire passer pour un poste déclaré.
  it('la base ne stocke que le condensat, jamais le secret', async () => {
    const { secret, poste } = await declarerPoste()

    const enBase = await prisma.workstation.findUniqueOrThrow({ where: { id: poste.id } })
    expect(enBase.secretHash).not.toBe(secret)
    expect(enBase.secretHash).toHaveLength(64) // sha256 en hexadécimal
  })

  it('deux postes distincts ne se confondent pas', async () => {
    const a = await declarerPoste()
    const b = await declarerPoste()

    expect(a.poste.id).not.toBe(b.poste.id)
    expect((await identifierPoste(a.secret))?.id).toBe(a.poste.id)
    expect((await identifierPoste(b.secret))?.id).toBe(b.poste.id)
  })

  it('un poste désactivé n’est plus reconnu', async () => {
    const { secret, poste } = await declarerPoste()
    await prisma.workstation.update({ where: { id: poste.id }, data: { actif: false } })

    expect(await identifierPoste(secret)).toBeNull()
  })

  it('met à jour la date de dernière vue', async () => {
    const { secret, poste } = await declarerPoste()
    await prisma.workstation.update({
      where: { id: poste.id },
      data: { lastSeenAt: new Date('2020-01-01') },
    })

    await identifierPoste(secret)

    const enBase = await prisma.workstation.findUniqueOrThrow({ where: { id: poste.id } })
    expect(enBase.lastSeenAt!.getFullYear()).toBe(new Date().getFullYear())
  })

  // Le site de l'entrée d'audit vient du poste : c'est la machine qui est à
  // Marie-Galante, pas l'utilisateur, qui exerce en alternance sur les deux (D5).
  it('porte le site auquel le poste est rattaché', async () => {
    const site = await prisma.site.findFirstOrThrow({ where: { code: 'MARIE_GALANTE' } })
    const { secret, poste } = await declarerPoste()

    expect(poste.siteId).toBeNull() // provisoire tant qu'un ADMIN ne l'a pas rattaché

    await prisma.workstation.update({ where: { id: poste.id }, data: { siteId: site.id } })
    expect((await identifierPoste(secret))?.siteId).toBe(site.id)
  })
})
