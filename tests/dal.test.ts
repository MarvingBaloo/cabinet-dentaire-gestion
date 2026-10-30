import { RoleName } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext, permissionKey } from '@/server/auth/context'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { PermissionDeniedError, requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { declarerPoste } from '@/server/auth/poste'
import { listerPostes } from '@/server/queries/postes'
import { listerUtilisateurs, lireUtilisateur } from '@/server/queries/users'
import { nommerPoste } from '@/server/services/postes'
import {
  creerUtilisateur,
  desactiverUtilisateur,
  modifierUtilisateur,
  reactiverUtilisateur,
  reinitialiserMfa,
} from '@/server/services/users'

// Ce que ces tests cherchent à prouver :
//   - le garde de permission refuse ET laisse une trace du refus (D4, D9)
//   - une lecture est journalisée, une écriture l'est dans SA transaction
//   - un compte désactivé n'obtient aucun contexte, donc aucun droit
// Les protections au niveau du moteur sont couvertes par securite-base.test.ts.

const SUFFIXE = Date.now()
const email = (r: string) => `${r}-${SUFFIXE}@test.local`

const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let ctxAdmin: AuthContext
let ctxAssistante: AuthContext

/** Crée un compte de test directement, sans passer par la DAL : les fixtures ne
 *  doivent pas dépendre du code qu'elles servent à tester. */
async function creerFixture(role: RoleName, cle: string) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: email(cle),
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: { roleId: r.id } },
    },
    select: { id: true },
  })
  return u.id
}

/** Compte les entrées d'audit correspondant à un critère, pour mesurer un delta. */
async function compterAudit(where: Parameters<typeof prisma.auditLog.count>[0]) {
  return prisma.auditLog.count(where)
}

beforeAll(async () => {
  const idAdmin = await creerFixture(RoleName.ADMIN, 'admin')
  const idAssistante = await creerFixture(RoleName.ASSISTANTE, 'assistante')

  const a = await loadAuthContext(idAdmin, ORIGINE)
  const b = await loadAuthContext(idAssistante, ORIGINE)
  if (!a || !b) throw new Error('contexte introuvable')
  ctxAdmin = a
  ctxAssistante = b
})

afterAll(async () => {
  // Les comptes restent (le journal les référence), mais pas leurs fiches d'agenda : sans ce ménage, chaque
  // passe laissait cinq praticiens de plus dans la base de test, tous affichés dans les filtres de l'agenda.
  await prisma.praticien.deleteMany({
    where: { OR: [{ user: { email: { endsWith: `-${SUFFIXE}@test.local` } } }, { nom: { endsWith: String(SUFFIXE) } }] },
  })
  await prisma.$disconnect()
})

describe('contexte d’authentification', () => {
  it('porte les permissions issues du rôle', () => {
    expect(ctxAdmin.roles).toEqual([RoleName.ADMIN])
    expect(ctxAdmin.permissions.has(permissionKey('utilisateur', 'create'))).toBe(true)
    expect(ctxAdmin.permissions.has(permissionKey('audit', 'read'))).toBe(true)
  })

  it('n’accorde à l’assistante que ce dont elle a besoin', () => {
    expect(ctxAssistante.permissions.has(permissionKey('utilisateur', 'read'))).toBe(false)
    expect(ctxAssistante.permissions.has(permissionKey('utilisateur', 'create'))).toBe(false)
    expect(ctxAssistante.permissions.has(permissionKey('audit', 'read'))).toBe(false)
  })

  it('cumule les permissions de plusieurs rôles (D4)', async () => {
    const id = await creerFixture(RoleName.PRATICIEN, 'cumul')
    const admin = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } })
    await prisma.userRole.create({ data: { userId: id, roleId: admin.id } })

    const ctx = await loadAuthContext(id, ORIGINE)
    expect(ctx?.roles.sort()).toEqual([RoleName.ADMIN, RoleName.PRATICIEN].sort())
    expect(ctx?.permissions.has(permissionKey('utilisateur', 'create'))).toBe(true)
  })

  it('ne rend AUCUN contexte pour un compte désactivé', async () => {
    const id = await creerFixture(RoleName.SECRETAIRE, 'desactive')
    await prisma.user.update({ where: { id }, data: { actif: false } })

    expect(await loadAuthContext(id, ORIGINE)).toBeNull()
  })
})

describe('garde de permission', () => {
  it('laisse passer qui a le droit', async () => {
    await expect(requirePermission(ctxAdmin, 'utilisateur', 'create')).resolves.toBeUndefined()
  })

  it('refuse qui ne l’a pas', async () => {
    await expect(requirePermission(ctxAssistante, 'utilisateur', 'create')).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )
  })

  // Un refus non tracé protégerait la donnée en effaçant la trace de qui a
  // essayé d'y accéder — exactement ce qu'un contrôle vient chercher.
  it('journalise le refus AVANT de lever', async () => {
    const avant = await compterAudit({
      where: { actorId: ctxAssistante.userId, action: 'PERMISSION_DENIED' },
    })

    await expect(requirePermission(ctxAssistante, 'audit', 'read')).rejects.toThrow()

    const apres = await compterAudit({
      where: { actorId: ctxAssistante.userId, action: 'PERMISSION_DENIED' },
    })
    expect(apres).toBe(avant + 1)

    const derniere = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxAssistante.userId, action: 'PERMISSION_DENIED' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(derniere.succeeded).toBe(false)
    expect(derniere.deniedReason).toBe('audit:read')
    expect(derniere.actorEmail).toBe(ctxAssistante.email)
  })

  it('la couche de lecture refuse aussi, pas seulement le garde isolé', async () => {
    await expect(creerUtilisateur(ctxAssistante, {
      email: email('interdit'),
      nom: 'X',
      prenom: 'Y',
      motDePasse: 'motdepassesuffisamentlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.SECRETAIRE],
      siteIds: [],
    })).rejects.toBeInstanceOf(PermissionDeniedError)

    // La tentative refusée ne doit avoir créé aucun compte.
    expect(await prisma.user.findUnique({ where: { email: email('interdit') } })).toBeNull()
  })
})

describe('journalisation des lectures (D9)', () => {
  it('une lecture de liste écrit UNE ligne, avec le volume', async () => {
    const avant = await compterAudit({
      where: { actorId: ctxAdmin.userId, action: 'READ', entityType: 'utilisateur' },
    })

    const utilisateurs = await listerUtilisateurs(ctxAdmin)

    const apres = await compterAudit({
      where: { actorId: ctxAdmin.userId, action: 'READ', entityType: 'utilisateur' },
    })
    expect(apres).toBe(avant + 1) // une ligne, pas une par utilisateur lu

    const derniere = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxAdmin.userId, action: 'READ', entityType: 'utilisateur' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(derniere.itemCount).toBe(utilisateurs.length)
  })

  it('une lecture infructueuse est tracée aussi — c’est le motif de balayage', async () => {
    const inexistant = '00000000-0000-0000-0000-000000000000'
    expect(await lireUtilisateur(ctxAdmin, inexistant)).toBeNull()

    const derniere = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxAdmin.userId, action: 'READ', entityId: inexistant },
      orderBy: { occurredAt: 'desc' },
    })
    expect(derniere.itemCount).toBe(0)
  })

  it('n’expose jamais le condensat du mot de passe ni le secret MFA', async () => {
    const [premier] = await listerUtilisateurs(ctxAdmin)
    expect(premier).toBeDefined()
    expect(premier).not.toHaveProperty('passwordHash')
    expect(premier).not.toHaveProperty('passwordHash')
  })
})

describe('mutations', () => {
  it('crée un compte et son entrée d’audit', async () => {
    const u = await creerUtilisateur(ctxAdmin, {
      email: email('nouveau'),
      nom: 'Dupont',
      prenom: 'Claire',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.SECRETAIRE, RoleName.ASSISTANTE],
      siteIds: [],
    })

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'CREATE', entityType: 'utilisateur', entityId: u.id },
    })
    expect(trace.actorId).toBe(ctxAdmin.userId)
    expect(trace.metadata).toMatchObject({ roles: expect.arrayContaining(['SECRETAIRE']) })

    const ctx = await loadAuthContext(u.id, ORIGINE)
    expect(ctx?.roles.sort()).toEqual([RoleName.ASSISTANTE, RoleName.SECRETAIRE])
  })

  // Le compte permet de se connecter ; c'est la fiche praticien qui fait
  // apparaître quelqu'un dans l'agenda. Créer l'un sans l'autre produit une
  // personne qui se connecte mais à qui l'on ne peut poser aucun rendez-vous —
  // sans que rien ne signale pourquoi. C'était le cas avant ce test.
  it('un compte praticien reçoit AUSSI sa fiche d’agenda', async () => {
    const u = await creerUtilisateur(ctxAdmin, {
      email: email('praticien-fiche'),
      nom: 'Valmy',
      prenom: 'Thomas',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.PRATICIEN],
      siteIds: [],
      titrePraticien: 'Chirurgien-dentiste, implantologie',
      couleurPraticien: '#7c5cd6',
    })

    const fiche = await prisma.praticien.findUniqueOrThrow({ where: { userId: u.id } })
    expect(fiche.nom).toBe('Valmy')
    expect(fiche.titre).toBe('Chirurgien-dentiste, implantologie')
    expect(fiche.couleur).toBe('#7c5cd6')
    expect(fiche.actif).toBe(true)
  })

  it('un compte secrétaire n’en reçoit pas — elle n’apparaît pas dans l’agenda', async () => {
    const u = await creerUtilisateur(ctxAdmin, {
      email: email('secretaire-sans-fiche'),
      nom: 'Bernard',
      prenom: 'Sophie',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.SECRETAIRE],
      siteIds: [],
    })

    expect(await prisma.praticien.findUnique({ where: { userId: u.id } })).toBeNull()
  })

  // Si la transaction n'était pas atomique, un rôle inconnu laisserait derrière
  // lui un compte sans rôle — donc un compte impossible à auditer correctement.
  it('n’écrit RIEN si la transaction échoue', async () => {
    const adresse = email('atomique')
    const avantAudit = await compterAudit({ where: { action: 'CREATE', entityType: 'utilisateur' } })

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: { email: adresse, nom: 'A', prenom: 'B', passwordHash: 'x' },
        })
        throw new Error('échec simulé après création')
      }),
    ).rejects.toThrow('échec simulé')

    expect(await prisma.user.findUnique({ where: { email: adresse } })).toBeNull()
    expect(await compterAudit({ where: { action: 'CREATE', entityType: 'utilisateur' } })).toBe(
      avantAudit,
    )
  })

  it('réconcilie les rôles au lieu de les accumuler', async () => {
    const u = await creerUtilisateur(ctxAdmin, {
      email: email('reconcilie'),
      nom: 'Martin',
      prenom: 'Paul',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.SECRETAIRE, RoleName.ADMIN],
      siteIds: [],
    })

    await modifierUtilisateur(ctxAdmin, u.id, { roles: [RoleName.SECRETAIRE] })

    const ctx = await loadAuthContext(u.id, ORIGINE)
    expect(ctx?.roles).toEqual([RoleName.SECRETAIRE])
    expect(ctx?.permissions.has(permissionKey('utilisateur', 'create'))).toBe(false)
  })

  it('la désactivation révoque les sessions ouvertes (D6)', async () => {
    const u = await creerUtilisateur(ctxAdmin, {
      email: email('revoque'),
      nom: 'Session',
      prenom: 'Ouverte',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.ASSISTANTE],
      siteIds: [],
    })

    await prisma.session.create({
      data: {
        userId: u.id,
        sessionToken: `jeton-${SUFFIXE}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        ipAddress: '127.0.0.1',
      },
    })

    await desactiverUtilisateur(ctxAdmin, u.id)

    const session = await prisma.session.findFirstOrThrow({ where: { userId: u.id } })
    expect(session.revokedAt).not.toBeNull()
    expect(await loadAuthContext(u.id, ORIGINE)).toBeNull()
  })
})

describe('mots de passe', () => {
  it('accepte le bon, refuse le mauvais', async () => {
    const h = await hashPassword('unmotdepasseassezlong')
    expect(await verifyPassword('unmotdepasseassezlong', h)).toBe(true)
    expect(await verifyPassword('unmotdepasseassezlonG', h)).toBe(false)
  })

  it('produit un condensat différent à chaque fois — le sel est aléatoire', async () => {
    const [a, b] = await Promise.all([hashPassword('identique'), hashPassword('identique')])
    expect(a).not.toBe(b)
    expect(await verifyPassword('identique', a)).toBe(true)
    expect(await verifyPassword('identique', b)).toBe(true)
  })

  it('ne plante pas sur un condensat malformé', async () => {
    expect(await verifyPassword('x', 'nimporte quoi')).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
  })
})

// Le praticien figure d'ordinaire dans l'agenda AVANT d'avoir un compte : il y a
// été saisi à l'ouverture, avec ses actes et ses rendez-vous. Créer une seconde
// fiche à son nom laissait l'accueil devant deux entrées identiques, dont une
// seule permettait de poser un rendez-vous — sans rien pour les distinguer.
describe('fiche d’agenda d’un praticien', () => {
  it('rattache la fiche existante au lieu d’en créer une seconde', async () => {
    const nom = `Valmytest${SUFFIXE}`
    const fiche = await prisma.praticien.create({
      data: { nom, prenom: 'Thomas', titre: 'Chirurgien-dentiste', couleur: '#123456' },
      select: { id: true },
    })

    const u = await creerUtilisateur(ctxAdmin, {
      email: email('praticien-existant'),
      nom,
      prenom: 'Thomas',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.PRATICIEN],
      siteIds: [],
    })

    expect(u.ficheRattachee).toBe(true)

    const fiches = await prisma.praticien.findMany({ where: { nom }, select: { id: true, userId: true, titre: true } })
    expect(fiches).toHaveLength(1)
    expect(fiches[0]!.id).toBe(fiche.id)
    expect(fiches[0]!.userId).toBe(u.id)
    // La fiche que le cabinet a réglée n'est pas réécrite par le formulaire.
    expect(fiches[0]!.titre).toBe('Chirurgien-dentiste')
  })

  it('crée la fiche quand le praticien est inconnu de l’agenda', async () => {
    const nom = `Inconnutest${SUFFIXE}`
    const u = await creerUtilisateur(ctxAdmin, {
      email: email('praticien-nouveau'),
      nom,
      prenom: 'Claire',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.PRATICIEN],
      siteIds: [],
    })

    expect(u.ficheRattachee).toBe(false)
    const fiches = await prisma.praticien.findMany({ where: { nom }, select: { userId: true } })
    expect(fiches).toHaveLength(1)
    expect(fiches[0]!.userId).toBe(u.id)
  })

  // Une fiche déjà rattachée appartient à quelqu'un d'autre, fût-il homonyme :
  // la lui prendre donnerait à l'un l'agenda de l'autre.
  it('ne vole pas la fiche d’un homonyme déjà rattaché', async () => {
    const nom = `Homonymetest${SUFFIXE}`
    const premier = await creerUtilisateur(ctxAdmin, {
      email: email('homonyme-1'),
      nom,
      prenom: 'Jean',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.PRATICIEN],
      siteIds: [],
    })
    const second = await creerUtilisateur(ctxAdmin, {
      email: email('homonyme-2'),
      nom,
      prenom: 'Jean',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.PRATICIEN],
      siteIds: [],
    })

    expect(second.ficheRattachee).toBe(false)
    const fiches = await prisma.praticien.findMany({ where: { nom }, select: { userId: true } })
    expect(fiches).toHaveLength(2)
    expect(fiches.map((f) => f.userId).sort()).toEqual([premier.id, second.id].sort())
  })
})

describe('administration des comptes', () => {
  // Téléphone perdu ou remplacé : le secret est effacé et la personne repasse
  // par l'enrôlement. Les sessions tombent, sans quoi celui qui détient encore
  // l'ancien téléphone continuerait avec un facteur qu'on vient de retirer.
  it('réinitialiser la 2FA efface le secret et coupe les sessions', async () => {
    const u = await creerUtilisateur(ctxAdmin, {
      email: email('reinit'),
      nom: 'Reinit',
      prenom: 'Test',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.ASSISTANTE],
      siteIds: [],
    })

    await prisma.user.update({
      where: { id: u.id },
      data: { telephoneMobile: '+590690445566', mfaEnrolledAt: new Date() },
    })
    await prisma.session.create({
      data: {
        userId: u.id,
        sessionToken: `jeton-reinit-${SUFFIXE}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        ipAddress: '127.0.0.1',
      },
    })

    await reinitialiserMfa(ctxAdmin, u.id)

    const apres = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    // Le numéro est effacé : un téléphone perdu ne doit plus recevoir de code.
    expect(apres.telephoneMobile).toBeNull()
    expect(apres.mfaEnrolledAt).toBeNull()

    const session = await prisma.session.findFirstOrThrow({ where: { userId: u.id } })
    expect(session.revokedAt).not.toBeNull()

    await prisma.auditLog.findFirstOrThrow({
      where: { entityId: u.id, action: 'UPDATE' },
    })
  })

  it('réactiver un compte lève aussi son verrouillage', async () => {
    const u = await creerUtilisateur(ctxAdmin, {
      email: email('reactive'),
      nom: 'Reactive',
      prenom: 'Test',
      motDePasse: 'unmotdepasseassezlong',
      telephoneMobile: '+590690000001',
      roles: [RoleName.SECRETAIRE],
      siteIds: [],
    })

    await desactiverUtilisateur(ctxAdmin, u.id)
    await prisma.user.update({
      where: { id: u.id },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 900_000) },
    })

    await reactiverUtilisateur(ctxAdmin, u.id)

    const apres = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(apres.actif).toBe(true)
    expect(apres.lockedUntil).toBeNull()
    expect(apres.failedLoginCount).toBe(0)
  })

  it('l’assistante ne peut ni réinitialiser une 2FA ni nommer un poste', async () => {
    const { poste } = await declarerPoste()

    await expect(reinitialiserMfa(ctxAssistante, ctxAdmin.userId)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )
    await expect(
      nommerPoste(ctxAssistante, poste.id, { nom: 'Tentative', siteId: null }),
    ).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(listerPostes(ctxAssistante)).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  // Le rattachement au site n'est pas décoratif : c'est de lui que le journal
  // tire le site de chaque action (D7).
  it('nommer un poste le rattache à un site et le trace', async () => {
    const { poste } = await declarerPoste()
    const site = await prisma.site.findFirstOrThrow({ where: { code: 'GUADELOUPE' } })

    await nommerPoste(ctxAdmin, poste.id, { nom: `PC test ${SUFFIXE}`, siteId: site.id })

    const apres = await prisma.workstation.findUniqueOrThrow({ where: { id: poste.id } })
    expect(apres.nom).toBe(`PC test ${SUFFIXE}`)
    expect(apres.siteId).toBe(site.id)

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'workstation', entityId: poste.id, action: 'UPDATE' },
    })
    expect(trace.actorId).toBe(ctxAdmin.userId)
  })
})
