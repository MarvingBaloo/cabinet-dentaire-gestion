import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { avecRepriseSurInterblocage, estChevauchementBase, estInterblocage } from '@/server/db/conflits'

// Tests purs (D54) : aucune base, aucune vraie transaction. Ce que ces tests
// éprouvent, c'est la RECONNAISSANCE d'un interblocage sous ses trois formes
// observées (voir le commentaire de `estInterblocage`) et la mécanique de
// rejeu — la preuve que la base sait effectivement produire 40P01 est déjà
// faite (voir le brief) et vit dans deplacement-patient.test.ts, en course
// réelle contre Postgres, jamais reproduite ici.

/** Construit une erreur telle que Prisma la restitue pour un interblocage
 *  (40P01) ou un conflit de sérialisation (40001) via `@prisma/adapter-pg` :
 *  code `P2034`, `meta.driverAdapterError.cause.originalCode` porte le code
 *  SQL d'origine (voir node_modules/@prisma/adapter-pg/dist/index.js). */
function erreurInterblocage(originalCode: '40P01' | '40001' = '40P01') {
  return new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict', {
    code: 'P2034',
    clientVersion: 'test',
    meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict', originalCode } } },
  })
}

/** Chevauchement — ce que `deplacerParPatient` & co reconnaissent déjà : sert
 *  ici à prouver qu'`estInterblocage` ne le confond jamais avec un interblocage. */
function erreurChevauchement() {
  return new Prisma.PrismaClientKnownRequestError('exclusion_violation', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: '23P01', constraint: 'rdv_praticien_sans_chevauchement' },
  })
}

describe('estInterblocage', () => {
  it('reconnaît la forme réelle (adapter-pg) : P2034 + originalCode 40P01', () => {
    expect(estInterblocage(erreurInterblocage('40P01'))).toBe(true)
  })

  it('reconnaît aussi 40001 (conflit de sérialisation) : même kind côté adaptateur, même réponse', () => {
    expect(estInterblocage(erreurInterblocage('40001'))).toBe(true)
  })

  it('reconnaît P2034 seul, sans `meta.driverAdapterError` (repli)', () => {
    const e = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test',
    })
    expect(estInterblocage(e)).toBe(true)
  })

  it('reconnaît `meta.code` direct, au cas où un moteur le poserait sans passer par driverAdapterError', () => {
    const e = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test',
      meta: { code: '40P01' },
    })
    expect(estInterblocage(e)).toBe(true)
  })

  it('ne confond jamais un chevauchement (23P01) avec un interblocage', () => {
    expect(estInterblocage(erreurChevauchement())).toBe(false)
    expect(estChevauchementBase(erreurChevauchement())).toBe(true)
  })

  it('rend faux pour une erreur ordinaire', () => {
    expect(estInterblocage(new Error('panne réseau'))).toBe(false)
  })
})

describe('avecRepriseSurInterblocage', () => {
  it('rejoue après un interblocage, puis réussit', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(erreurInterblocage())
      .mockResolvedValueOnce('gagné')

    await expect(avecRepriseSurInterblocage(fn)).resolves.toBe('gagné')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('relance l’erreur telle quelle après épuisement des tentatives', async () => {
    const echec = erreurInterblocage()
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(echec)

    await expect(avecRepriseSurInterblocage(fn, 3)).rejects.toBe(echec)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('ne rejoue jamais une erreur qui n’est pas un interblocage — chevauchement compris', async () => {
    const chevauchement = erreurChevauchement()
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(chevauchement)

    await expect(avecRepriseSurInterblocage(fn)).rejects.toBe(chevauchement)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('ne rejoue jamais une erreur quelconque, sans rapport avec la base', async () => {
    const autre = new Error('panne réseau')
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(autre)

    await expect(avecRepriseSurInterblocage(fn)).rejects.toBe(autre)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
