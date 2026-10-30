import { RoleName } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { lireFichePatient, patientsBloques, rechercherPatients } from '@/server/queries/patients'
import { debloquerPatient, modifierPatient } from '@/server/services/patients'

// Ce que ces tests cherchent à prouver :
//   - la recherche trouve ce que la secrétaire tape réellement au téléphone,
//     y compris « nom prénom » d'un seul tenant
//   - une lecture du fichier patients laisse une trace, même infructueuse
//   - une recherche trop courte ne rend pas un échantillon du fichier entier
//
// ⚠ Aucun cloisonnement par site n'est testé ici, et c'est volontaire : un
// patient n'appartient à aucun site (voir queries/patients.ts).

const SUFFIXE = Date.now()
// Un jeton improbable dans le reste de la base : les tests partagent `cabinet_test`
// et une recherche sur « Dupont » ramasserait les fixtures des autres.
const NOM = `Duponttest${SUFFIXE}`

const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let ctxSecretaire: AuthContext
const cree: { patients: string[] } = { patients: [] }

async function fixturePatient(prenom: string, telephone: string, actif = true) {
  const p = await prisma.patient.create({
    data: { nom: NOM, prenom, telephone, actif, profilComplet: false },
    select: { id: true },
  })
  cree.patients.push(p.id)
  return p.id
}

beforeAll(async () => {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SECRETAIRE } })
  const u = await prisma.user.create({
    data: {
      email: `patients-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: 'Secretaire',
      passwordHash: 'x',
      roles: { create: { roleId: role.id } },
    },
    select: { id: true },
  })

  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error('contexte introuvable')
  ctxSecretaire = ctx

  await fixturePatient('Marie', '0690110011')
  await fixturePatient('Jean', '0690220022')
  await fixturePatient('Parti', '0690330033', false)
})

afterAll(async () => {
  // Les fiches patients sont supprimables. Le compte, lui, ne l'est pas : le
  // journal d'audit le référence et refuse de le lâcher — c'est le comportement
  // démontré, et la raison d'être de la base `cabinet_test` séparée.
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.$disconnect()
})

describe('recherche de patient', () => {
  it('trouve par le nom, sans tenir compte de la casse', async () => {
    const r = await rechercherPatients(ctxSecretaire, NOM.toLowerCase())
    expect(r.map((p) => p.prenom).sort()).toEqual(['Jean', 'Marie'])
  })

  it('trouve par le prénom seul', async () => {
    const r = await rechercherPatients(ctxSecretaire, 'Marie')
    expect(r.some((p) => p.id === cree.patients[0])).toBe(true)
  })

  // Le cas qui justifie de découper la saisie : aucun champ ne contient à lui
  // seul « Duponttest marie », une recherche d'un bloc ne rendrait rien.
  it('trouve quand on tape le nom ET le prénom', async () => {
    const r = await rechercherPatients(ctxSecretaire, `${NOM} marie`)
    expect(r).toHaveLength(1)
    expect(r[0]!.prenom).toBe('Marie')
  })

  it('trouve par un fragment de téléphone', async () => {
    const r = await rechercherPatients(ctxSecretaire, '220022')
    expect(r.some((p) => p.prenom === 'Jean')).toBe(true)
  })

  it('ignore une fiche désactivée', async () => {
    const r = await rechercherPatients(ctxSecretaire, `${NOM} parti`)
    expect(r).toHaveLength(0)
  })

  it('ne rend rien sur une saisie trop courte, plutôt qu’un échantillon du fichier', async () => {
    expect(await rechercherPatients(ctxSecretaire, 'a')).toEqual([])
    expect(await rechercherPatients(ctxSecretaire, '   ')).toEqual([])
  })
})

describe('traçabilité', () => {
  async function compter() {
    return prisma.auditLog.count({
      where: { actorId: ctxSecretaire.userId, action: 'READ', entityType: 'patient' },
    })
  }

  it('journalise une recherche aboutie', async () => {
    const avant = await compter()
    await rechercherPatients(ctxSecretaire, NOM)
    expect(await compter()).toBe(avant + 1)
  })

  // Savoir qui cherche à retrouver des patients sans jamais en trouver est
  // précisément ce qu'un journal d'accès doit permettre de reconstituer.
  it('journalise aussi une recherche qui ne rend rien', async () => {
    const avant = await compter()
    await rechercherPatients(ctxSecretaire, 'introuvable-xyz')
    expect(await compter()).toBe(avant + 1)
  })

  it('ne journalise pas une recherche qu’elle n’exécute pas', async () => {
    const avant = await compter()
    await rechercherPatients(ctxSecretaire, 'a')
    expect(await compter()).toBe(avant)
  })
})

describe('garde de permission', () => {
  it('refuse qui ne porte pas patient:read', async () => {
    const sansDroit: AuthContext = { ...ctxSecretaire, permissions: new Set() }
    await expect(rechercherPatients(sansDroit, NOM)).rejects.toBeInstanceOf(PermissionDeniedError)
  })
})

// Q27 : le blocage se lève, et seulement par un administrateur. Sans cet écran
// et sans cette permission, la sanction serait définitive — la moitié de la
// règle du cabinet appliquée, l'autre jamais.
describe('déblocage de la réservation en ligne (Q27)', () => {
  let ctxAdmin: AuthContext

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } })
    const u = await prisma.user.create({
      data: {
        email: `patients-admin-${SUFFIXE}@test.local`,
        nom: 'Test', prenom: 'Admin', passwordHash: 'x',
        roles: { create: { roleId: role.id } },
      },
      select: { id: true },
    })
    const ctx = await loadAuthContext(u.id, ORIGINE)
    if (!ctx) throw new Error('contexte administrateur introuvable')
    ctxAdmin = ctx
  })

  async function patientBloque(prenom: string, telephone: string) {
    const id = await fixturePatient(prenom, telephone)
    await prisma.patient.update({
      where: { id },
      data: { manquements: 3, reservationBloquee: true },
    })
    return id
  }

  it("la secrétaire ne peut pas lever un blocage — c'est un geste d'administrateur", async () => {
    const id = await patientBloque('Bloque', '0690440044')

    await expect(debloquerPatient(ctxSecretaire, { id })).rejects.toThrow(PermissionDeniedError)

    const apres = await prisma.patient.findUniqueOrThrow({
      where: { id },
      select: { reservationBloquee: true, manquements: true },
    })
    expect(apres.reservationBloquee).toBe(true)
    expect(apres.manquements).toBe(3)
  })

  it("l'administrateur débloque, et le compteur repart de zéro", async () => {
    const id = await patientBloque('Libere', '0690550055')

    await debloquerPatient(ctxAdmin, { id })

    const apres = await prisma.patient.findUniqueOrThrow({
      where: { id },
      select: { reservationBloquee: true, manquements: true, debloqueLe: true },
    })
    expect(apres.reservationBloquee).toBe(false)
    // À trois avec une dérogation, la prochaine absence rebloquerait aussitôt.
    expect(apres.manquements).toBe(0)
    expect(apres.debloqueLe).toBeInstanceOf(Date)
  })

  it('la liste des bloqués ne montre que les bloqués', async () => {
    const id = await patientBloque('Liste', '0690660066')

    const bloques = await patientsBloques(ctxAdmin)
    expect(bloques.map((p) => p.id)).toContain(id)

    await debloquerPatient(ctxAdmin, { id })
    const apres = await patientsBloques(ctxAdmin)
    expect(apres.map((p) => p.id)).not.toContain(id)
  })
})

describe('fiche patient (19/10)', () => {
  it('compléter la date de naissance rend la fiche complète, et le journal ne garde que les noms des champs', async () => {
    const id = await fixturePatient('Fiche', '0690440044')
    await modifierPatient(ctxSecretaire, {
      id,
      nom: NOM,
      prenom: 'Fiche',
      telephone: '0690440044',
      dateNaissance: '1980-02-29',
      email: 'fiche@exemple.fr',
      representantLegal: null,
      telephoneRepresentant: null,
    })

    const fiche = await lireFichePatient(ctxSecretaire, id)
    expect(fiche?.patient.profilComplet).toBe(true)
    expect(fiche?.patient.dateNaissance?.toISOString().slice(0, 10)).toBe('1980-02-29')

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'patient', entityId: id, action: 'UPDATE' },
      orderBy: { id: 'desc' },
    })
    expect(trace.metadata).toEqual({ champs: ['dateNaissance', 'email'] })
    expect(JSON.stringify(trace.metadata)).not.toContain('fiche@exemple.fr')
  })

  it('une fiche désactivée est introuvable', async () => {
    const id = cree.patients[2]!
    expect(await lireFichePatient(ctxSecretaire, id)).toBeNull()
  })
})
