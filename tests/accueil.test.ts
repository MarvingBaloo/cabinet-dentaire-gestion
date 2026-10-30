import { RoleName, SiteCode } from '@prisma/client'
import { beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PorteeSiteError } from '@/server/auth/portee'
import { type CabinetAccessible, listerCabinetsAccessibles } from '@/server/cabinet-choisi'
import { prisma } from '@/server/db/client'
import { lireAccueil, lireDemandesTransmises } from '@/server/queries/accueil'

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let mg: CabinetAccessible
let gp: CabinetAccessible
let ctxMG: AuthContext
let ctxAdmin: AuthContext

async function compte(role: RoleName, cle: string, sites: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `accueil-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: { roleId: r.id } },
      sites: { create: sites.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  })
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error(`Contexte introuvable : ${cle}`)
  return ctx
}

beforeAll(async () => {
  const choix = { id: true, code: true, nom: true } as const
  mg = await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE }, select: choix })
  gp = await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE }, select: choix })
  ctxMG = await compte(RoleName.SECRETAIRE, 'mg', [mg.id])
  ctxAdmin = await compte(RoleName.ADMIN, 'admin', [])
})

describe('Accueil et cabinet affiché (D5)', () => {
  it('la secrétaire de Marie-Galante ne se voit proposer que son cabinet', async () => {
    expect((await listerCabinetsAccessibles(ctxMG)).map((c) => c.id)).toEqual([mg.id])
  })

  it('la portée globale se voit proposer les deux cabinets, Marie-Galante en premier', async () => {
    expect((await listerCabinetsAccessibles(ctxAdmin)).map((c) => c.id)).toEqual([mg.id, gp.id])
  })

  it('demander l’Accueil ou les demandes transmises d’un cabinet hors portée est refusé', async () => {
    await expect(lireAccueil(ctxMG, gp, [mg])).rejects.toBeInstanceOf(PorteeSiteError)
    await expect(lireDemandesTransmises(ctxMG, gp)).rejects.toBeInstanceOf(PorteeSiteError)
  })

  it('l’Accueil de son cabinet se lit et ne décrit que les cabinets accessibles', async () => {
    const accueil = await lireAccueil(ctxMG, mg, [mg])
    expect(accueil.cabinets.map((c) => c.id)).toEqual([mg.id])
    expect(accueil.prochains.length).toBeLessThanOrEqual(5)
  })
})
