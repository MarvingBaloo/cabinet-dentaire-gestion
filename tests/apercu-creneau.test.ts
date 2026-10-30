import { RoleName, SiteCode } from '@prisma/client'
import { beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PorteeSiteError } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import { apercuCreneau } from '@/server/services/agenda'

// L'aperçu du récapitulatif (« Nouveau rendez-vous ») ne doit rien accorder que
// la création refuserait : mêmes gardes de portée et de rôle, avant toute lecture.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }
const INCONNU = '00000000-0000-4000-8000-000000000000'

let siteMG: string
let siteGP: string
let ctxMG: AuthContext

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id
  const r = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SECRETAIRE } })
  const u = await prisma.user.create({
    data: {
      email: `apercu-mg-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: 'mg',
      passwordHash: 'x',
      roles: { create: { roleId: r.id } },
      sites: { create: [{ siteId: siteMG }] },
    },
    select: { id: true },
  })
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error('Contexte introuvable')
  ctxMG = ctx
})

const demande = (siteId: string, surbooking = false) => ({
  praticienId: INCONNU,
  motifId: INCONNU,
  siteId,
  debut: new Date('2030-01-07T13:00:00Z'),
  surbooking,
  horsHoraire: false,
})

describe('aperçu du créneau', () => {
  it('refuse un cabinet hors de la portée de l’appelant (D5)', async () => {
    await expect(apercuCreneau(ctxMG, demande(siteGP))).rejects.toBeInstanceOf(PorteeSiteError)
  })

  it('n’accorde pas l’urgence par-dessus à une secrétaire', async () => {
    const a = await apercuCreneau(ctxMG, demande(siteMG, true))
    expect(a.ok).toBe(false)
    if (!a.ok) {
      expect(a.planningPlein).toBe(true)
      expect(a.raison).toMatch(/praticien/)
    }
  })
})
