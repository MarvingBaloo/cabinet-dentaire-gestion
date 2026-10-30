import { RoleName, SiteCode } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { decalerJour, jourLocal } from '@/lib/dates'
import { TEXTE_NOTE_MAX } from '@/lib/notes-jour'
import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PorteeSiteError } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import { listerNotesJour } from '@/server/queries/notes-jour'
import { creerNoteJour, modifierNoteJour, supprimerNoteJour } from '@/server/services/notes-jour'
import { creerNoteJourSchema, modifierNoteJourSchema } from '@/server/validation/notes-jour'

// Le contexte de l'action est celui du compte Marie-Galante, fixé dans
// `beforeAll` : `exigerContexte()` lit les cookies, absents sous Vitest.
const etat = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/server/auth/session-courante', () => ({ exigerContexte: async () => etat.ctx }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }
const TEXTE_SECRET = `Rappeler M. Dupont-${SUFFIXE}`

let siteMG: string
let siteGP: string
let ctxGP: AuthContext
let ctxMG: AuthContext
let ctxAdmin: AuthContext
let noteMG: string
let noteGP: string
const notesCreees: string[] = []

const jour = decalerJour(jourLocal(new Date()), 3)

async function compte(role: RoleName, cle: string, sites: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `notes-jour-${cle}-${SUFFIXE}@test.local`,
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
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id
  ctxGP = await compte(RoleName.SECRETAIRE, 'gp', [siteGP])
  ctxMG = await compte(RoleName.SECRETAIRE, 'mg', [siteMG])
  ctxAdmin = await compte(RoleName.ADMIN, 'admin', [])
  etat.ctx = ctxMG

  noteMG = (await creerNoteJour(ctxMG, { siteId: siteMG, jour, texte: TEXTE_SECRET })).id
  noteGP = (await creerNoteJour(ctxGP, { siteId: siteGP, jour, texte: 'Note Guadeloupe' })).id
  notesCreees.push(noteMG, noteGP)
})

afterAll(async () => {
  await prisma.noteJour.deleteMany({ where: { id: { in: notesCreees } } })
})

const periode = { premierJour: jour, dernierJour: jour }

describe('portée (D5)', () => {
  it('(a) la note de Marie-Galante est invisible pour le compte Guadeloupe', async () => {
    const vues = await listerNotesJour(ctxGP, periode)
    expect(vues.map((n) => n.id)).toContain(noteGP)
    expect(vues.map((n) => n.id)).not.toContain(noteMG)
    await expect(listerNotesJour(ctxGP, periode, { siteId: siteMG })).rejects.toBeInstanceOf(PorteeSiteError)
  })

  it('(b) modifier et supprimer hors portée sont refusés, tracés, sans effet', async () => {
    const avant = await prisma.auditLog.count({
      where: { actorId: ctxGP.userId, action: 'PERMISSION_DENIED', entityId: siteMG },
    })
    await expect(modifierNoteJour(ctxGP, { id: noteMG, texte: 'Piraté' })).rejects.toBeInstanceOf(PorteeSiteError)
    await expect(supprimerNoteJour(ctxGP, { id: noteMG })).rejects.toBeInstanceOf(PorteeSiteError)

    const note = await prisma.noteJour.findUniqueOrThrow({ where: { id: noteMG } })
    expect(note.texte).toBe(TEXTE_SECRET)
    const apres = await prisma.auditLog.count({
      where: { actorId: ctxGP.userId, action: 'PERMISSION_DENIED', entityId: siteMG },
    })
    expect(apres - avant).toBe(2)
  })

  it('(c) créer sur un autre site est refusé', async () => {
    await expect(creerNoteJour(ctxGP, { siteId: siteMG, jour, texte: 'Non' })).rejects.toBeInstanceOf(PorteeSiteError)
  })

  it('(g) le compte ADMIN voit les notes des deux sites', async () => {
    const ids = (await listerNotesJour(ctxAdmin, periode)).map((n) => n.id)
    expect(ids).toContain(noteMG)
    expect(ids).toContain(noteGP)
  })
})

describe('journal d’audit', () => {
  it('(d) création, modification, suppression sont tracées sans le texte', async () => {
    const { id } = await creerNoteJour(ctxMG, { siteId: siteMG, jour, texte: TEXTE_SECRET })
    notesCreees.push(id)
    await modifierNoteJour(ctxMG, { id, texte: `${TEXTE_SECRET} bis` })
    await supprimerNoteJour(ctxMG, { id })

    const lignes = await prisma.auditLog.findMany({ where: { entityType: 'note_jour', entityId: id } })
    expect(lignes.map((l) => l.action).sort()).toEqual(['CREATE', 'DELETE', 'UPDATE'])
    for (const l of lignes) expect(JSON.stringify(l.metadata ?? {})).not.toContain('Dupont')
  })
})

describe('validation', () => {
  const invalides = ['', '   ', 'x'.repeat(TEXTE_NOTE_MAX + 1)]
  const valide = 'x'.repeat(TEXTE_NOTE_MAX)

  it('(e) refuse vide, blanc, 281 caractères ; accepte 280', () => {
    for (const texte of invalides) {
      expect(creerNoteJourSchema.safeParse({ siteId: crypto.randomUUID(), jour, texte }).success).toBe(false)
      expect(modifierNoteJourSchema.safeParse({ id: crypto.randomUUID(), texte }).success).toBe(false)
    }
    expect(creerNoteJourSchema.safeParse({ siteId: crypto.randomUUID(), jour, texte: valide }).success).toBe(true)
    expect(modifierNoteJourSchema.safeParse({ id: crypto.randomUUID(), texte: valide }).success).toBe(true)
  })

  it('refuse un jour inexistant', () => {
    expect(creerNoteJourSchema.safeParse({ siteId: crypto.randomUUID(), jour: '2026-02-31', texte: 'a' }).success).toBe(false)
  })
})

describe('actions', () => {
  it('(f) refuse un texte vide ou trop long et renvoie la saisie', async () => {
    const { creerNoteJourAction, modifierNoteJourAction } = await import('@/server/actions/notes-jour')
    for (const texte of ['', 'x'.repeat(TEXTE_NOTE_MAX + 1)]) {
      const f = new FormData()
      f.set('siteId', siteMG)
      f.set('jour', jour)
      f.set('texte', texte)
      const r = await creerNoteJourAction({}, f)
      expect(r.erreur).toBeTruthy()
      expect(r.saisie).toEqual({ siteId: siteMG, jour, texte })
      expect(r.jeton).toBeTruthy()

      const g = new FormData()
      g.set('id', noteMG)
      g.set('texte', texte)
      const m = await modifierNoteJourAction({}, g)
      expect(m.erreur).toBeTruthy()
      expect(m.saisie).toEqual({ id: noteMG, texte })
    }
  })

  it('traduit un refus de portée et renvoie la saisie', async () => {
    const { modifierNoteJourAction } = await import('@/server/actions/notes-jour')
    etat.ctx = ctxGP
    try {
      const f = new FormData()
      f.set('id', noteMG)
      f.set('texte', 'Autre')
      const r = await modifierNoteJourAction({}, f)
      expect(r.erreur).toBe('Ce cabinet n’est pas dans votre périmètre.')
      expect(r.saisie).toEqual({ id: noteMG, texte: 'Autre' })
    } finally {
      etat.ctx = ctxMG
    }
  })
})
