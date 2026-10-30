import 'server-only'

import type { AuthContext } from '@/server/auth/context'
import { hashPassword } from '@/server/auth/password'
import { revoquerConfiance } from '@/server/auth/confiance'
import { requirePermission } from '@/server/auth/permissions'
import { revoquerToutesLesSessions } from '@/server/auth/session'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import {
  type CreerUtilisateurInput,
  type ModifierUtilisateurInput,
} from '@/server/validation/user'

// Mutations sur le personnel interne.
//
// Règle sans exception : l'entrée d'audit est écrite DANS la transaction de la
// mutation. Il n'existe donc pas d'écriture sans sa trace, même si le processus
// meurt entre les deux (D9).

export class EmailDejaUtiliseError extends Error {
  constructor(email: string) {
    super(`Un compte existe déjà pour ${email}`)
    this.name = 'EmailDejaUtiliseError'
  }
}

export async function creerUtilisateur(ctx: AuthContext, input: CreerUtilisateurInput) {
  await requirePermission(ctx, 'utilisateur', 'create')

  const existant = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  })
  if (existant) throw new EmailDejaUtiliseError(input.email)

  const passwordHash = await hashPassword(input.motDePasse)

  return prisma.$transaction(async (tx) => {
    const roles = await tx.role.findMany({
      where: { name: { in: input.roles } },
      select: { id: true, name: true },
    })
    if (roles.length !== input.roles.length) {
      throw new Error('Rôle inconnu : le référentiel et la demande ont divergé.')
    }

    const utilisateur = await tx.user.create({
      data: {
        email: input.email,
        nom: input.nom,
        prenom: input.prenom,
        telephoneMobile: input.telephoneMobile ?? null,
        passwordHash,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
        sites: { create: input.siteIds.map((siteId) => ({ siteId })) },
      },
      select: { id: true, email: true, nom: true, prenom: true },
    })

    // Un compte praticien reçoit AUSSI sa fiche d'agenda, dans la même
    // transaction. Sans elle, la personne peut se connecter mais n'apparaît
    // dans aucune liste : impossible de lui poser un rendez-vous, sans que rien
    // ne signale pourquoi.
    //
    // ⚠ Rattacher AVANT de créer. Le praticien figure souvent déjà dans
    // l'agenda — saisi à l'ouverture du cabinet, avec ses actes et ses
    // rendez-vous — et son compte n'arrive qu'ensuite. Créer sans regarder
    // fabriquait un second praticien du même nom : celui qui portait les
    // rendez-vous restait sans compte, celui qui avait le compte n'avait aucun
    // acte, et l'accueil n'avait aucun moyen de les distinguer dans la liste.
    const estPraticien = input.roles.includes('PRATICIEN')
    let ficheRattachee = false
    if (estPraticien) {
      // `userId: null` est la condition qui compte : une fiche déjà rattachée
      // appartient à quelqu'un d'autre, fût-il homonyme. La plus ancienne
      // d'abord, faute de mieux — mais c'est précisément ce correctif qui
      // empêche qu'il y en ait plusieurs.
      const existante = await tx.praticien.findFirst({
        where: {
          actif: true,
          userId: null,
          nom: { equals: input.nom, mode: 'insensitive' },
          prenom: { equals: input.prenom, mode: 'insensitive' },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })

      if (existante) {
        await tx.praticien.update({
          where: { id: existante.id },
          // Ni le titre ni la couleur ne sont écrasés : la fiche existante est
          // celle que le cabinet a réglée, le formulaire ne fait que proposer
          // des valeurs par défaut.
          data: { userId: utilisateur.id },
        })
        ficheRattachee = true
      } else {
        await tx.praticien.create({
          data: {
            userId: utilisateur.id,
            nom: input.nom,
            prenom: input.prenom,
            titre: input.titrePraticien ?? 'Chirurgien-dentiste',
            couleur: input.couleurPraticien ?? '#387a70',
          },
        })
      }
    }

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'utilisateur',
      entityId: utilisateur.id,
      // Les rôles attribués sont la partie sensible de l'opération : c'est ce
      // qu'un contrôle voudra reconstituer. Aucune donnée de santé ici.
      metadata: {
        email: utilisateur.email,
        roles: roles.map((r) => r.name),
        ...(estPraticien ? { fichePraticienRattachee: ficheRattachee } : {}),
      },
    })

    // `ficheRattachee` remonte jusqu'à l'écran : « il apparaît dans l'agenda »
    // et « il a retrouvé sa fiche » ne veulent pas dire la même chose à qui
    // vient de créer le compte.
    return { ...utilisateur, ficheRattachee }
  })
}

export async function modifierUtilisateur(
  ctx: AuthContext,
  id: string,
  input: ModifierUtilisateurInput,
) {
  await requirePermission(ctx, 'utilisateur', 'update')

  return prisma.$transaction(async (tx) => {
    let rolesAppliques: string[] | undefined

    if (input.roles) {
      const roles = await tx.role.findMany({
        where: { name: { in: input.roles } },
        select: { id: true, name: true },
      })
      if (roles.length !== input.roles.length) {
        throw new Error('Rôle inconnu : le référentiel et la demande ont divergé.')
      }
      // Réconciliation : un rôle retiré de la demande doit disparaître, sinon
      // les droits ne font que s'accumuler et le moindre privilège s'érode.
      await tx.userRole.deleteMany({ where: { userId: id } })
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) })
      rolesAppliques = roles.map((r) => r.name)
    }

    const utilisateur = await tx.user.update({
      where: { id },
      data: {
        ...(input.nom !== undefined ? { nom: input.nom } : {}),
        ...(input.prenom !== undefined ? { prenom: input.prenom } : {}),
      },
      select: { id: true, email: true, nom: true, prenom: true },
    })

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'utilisateur',
      entityId: id,
      ...(rolesAppliques ? { metadata: { roles: rolesAppliques } } : {}),
    })

    return utilisateur
  })
}

/**
 * Désactive un compte. Il n'existe volontairement PAS de suppression : le
 * journal d'audit référence l'acteur, et supprimer un compte rendrait
 * illisibles des années de traces (D9).
 */
export class DesactivationDeSoiError extends Error {
  constructor() {
    super('Vous ne pouvez pas désactiver votre propre compte.')
    this.name = 'DesactivationDeSoiError'
  }
}

export async function desactiverUtilisateur(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'utilisateur', 'update')
  // Dans la fonction et non plus seulement dans l'écran (D4) : se désactiver fermerait sa propre session et
  // pourrait laisser le cabinet sans administrateur.
  if (id === ctx.userId) throw new DesactivationDeSoiError()

  return prisma.$transaction(async (tx) => {
    const utilisateur = await tx.user.update({
      where: { id },
      data: { actif: false },
      select: { id: true, email: true },
    })

    // Toutes les sessions ouvertes tombent immédiatement. C'est la raison pour
    // laquelle les sessions vivent en base et non dans un JWT (D6) : un jeton
    // autonome resterait valide jusqu'à son expiration.
    const sessions = await revoquerToutesLesSessions(id, tx)
    await revoquerConfiance(id, tx)

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'utilisateur',
      entityId: id,
      metadata: { desactive: true, sessionsRevoquees: sessions },
    })

    return utilisateur
  })
}

/**
 * Réinitialise la double authentification d'un compte.
 *
 * Cas d'usage : téléphone perdu, volé ou remplacé. Le secret est effacé, et la
 * personne repasse par l'enrôlement à sa prochaine connexion.
 *
 * Les sessions ouvertes sont révoquées dans la même transaction : si quelqu'un
 * détient encore l'ancien téléphone, il ne doit pas continuer avec une session
 * déjà validée par le facteur qu'on vient de retirer.
 */
export async function reinitialiserMfa(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'utilisateur', 'update')

  return prisma.$transaction(async (tx) => {
    const utilisateur = await tx.user.update({
      where: { id },
      // Le numéro est effacé : un téléphone perdu ne doit plus recevoir de
      // code. Un administrateur en saisit un nouveau ensuite.
      data: { telephoneMobile: null, mfaEnrolledAt: null },
      select: { id: true, email: true },
    })

    const sessions = await revoquerToutesLesSessions(id, tx)

    // Sans cela, remettre à zéro le MFA d'un téléphone perdu laisserait celui
    // qui détient le mot de passe entrer sans code depuis un poste déjà
    // éprouvé : la réinitialisation n'aurait servi à rien.
    const confiances = await revoquerConfiance(id, tx)

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'utilisateur',
      entityId: id,
      metadata: {
        mfaReinitialise: true,
        sessionsRevoquees: sessions,
        postesDeConfianceRevoques: confiances,
      },
    })

    return utilisateur
  })
}

/**
 * Enregistre le nouveau numéro de mobile d'un compte (téléphone changé, ou après une réinitialisation). Comme
 * une réinitialisation, c'est un geste de sécurité : les sessions ouvertes et les postes de confiance tombent, et
 * le prochain code part vers le nouveau numéro. Le numéro n'entre pas dans le journal.
 */
export async function changerTelephone(ctx: AuthContext, id: string, telephone: string) {
  await requirePermission(ctx, 'utilisateur', 'update')

  return prisma.$transaction(async (tx) => {
    const utilisateur = await tx.user.update({
      where: { id },
      data: { telephoneMobile: telephone, mfaEnrolledAt: null },
      select: { id: true, prenom: true, nom: true },
    })
    const sessions = await revoquerToutesLesSessions(id, tx)
    const confiances = await revoquerConfiance(id, tx)
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'utilisateur',
      entityId: id,
      metadata: { telephoneChange: true, sessionsRevoquees: sessions, postesDeConfianceRevoques: confiances },
    })
    return utilisateur
  })
}

/** Réactive un compte désactivé. */
export async function reactiverUtilisateur(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'utilisateur', 'update')

  return prisma.$transaction(async (tx) => {
    const utilisateur = await tx.user.update({
      where: { id },
      // Le verrou d'échecs est levé aussi : un compte réactivé ne doit pas
      // rester bloqué par des tentatives d'avant sa désactivation.
      data: { actif: true, failedLoginCount: 0, lockedUntil: null },
      select: { id: true, email: true },
    })

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'utilisateur',
      entityId: id,
      metadata: { reactive: true },
    })

    return utilisateur
  })
}
