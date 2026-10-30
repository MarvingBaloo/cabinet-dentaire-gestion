import 'server-only'

import { randomBytes } from 'node:crypto'

import { envoyerCode, verifierCode } from '@/server/auth/code-sms'
import { accorderConfiance, estPosteDeConfiance } from '@/server/auth/confiance'
import { tropDeTentatives } from '@/server/auth/limitation'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { creerSession, revoquerSession } from '@/server/auth/session'
import { aUnTelephoneReconnu } from '@/server/auth/telephone'
import { recordAuthEvent } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// Connexion en deux temps : mot de passe, puis second facteur. Entre les deux,
// la session existe mais n'ouvre AUCUN droit (mfaValidatedAt nul) — c'est ce qui
// permet de porter l'étape intermédiaire sans inventer un second mécanisme.

const MAX_ECHECS = 5
const VERROU_MINUTES = 15

// Condensat d'un mot de passe qui n'est celui de personne. Sert à faire
// travailler la vérification même quand l'email est inconnu : sans ça, une
// réponse instantanée trahirait qu'aucun compte ne porte cette adresse, et
// permettrait d'énumérer le personnel du cabinet.
//
// Calculé à la première utilisation, pas au chargement du module : un `await`
// de haut niveau contraindrait la cible de compilation pour un détail interne.
let leurrePromesse: Promise<string> | null = null
function leurre(): Promise<string> {
  leurrePromesse ??= hashPassword(randomBytes(24).toString('hex'))
  return leurrePromesse
}

export type Origine = {
  ipAddress: string
  userAgent?: string | null
  workstationId?: string | null
  siteId?: string | null
}

export type ResultatConnexion =
  /** Poste déjà éprouvé par cette personne : le second facteur est sauté (D7quater). */
  | { etat: 'connecte'; jeton: string; sessionId: string }
  /** Un téléphone de confiance attend le QR du poste : aucun SMS ne part (D83). */
  | { etat: 'telephone_requis'; jeton: string; sessionId: string }
  /** Code envoyé par SMS ; `masque` montre les deux derniers chiffres du numéro. */
  | { etat: 'mfa_requis'; jeton: string; sessionId: string; masque: string }
  /** Aucun numéro de mobile enregistré : personne ne peut recevoir de code. */
  | { etat: 'numero_manquant'; sessionId: string }
  | { etat: 'sms_indisponible'; sessionId: string; raison: string }
  | { etat: 'identifiants_invalides' }
  | { etat: 'compte_verrouille'; jusqua: Date }
  | { etat: 'compte_desactive' }
  | { etat: 'trop_de_tentatives' }

export async function demarrerConnexion(
  email: string,
  motDePasse: string,
  origine: Origine,
): Promise<ResultatConnexion> {
  const adresse = email.trim().toLowerCase()

  // Avant toute vérification : le verrou par compte ne protège pas d'une
  // pulvérisation, qui essaie peu de mots de passe sur beaucoup de comptes.
  if (await tropDeTentatives(origine.ipAddress)) {
    await recordAuthEvent({
      action: 'LOGIN_FAILURE',
      actorEmail: adresse,
      succeeded: false,
      deniedReason: 'trop de tentatives depuis cette adresse',
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    })
    return { etat: 'trop_de_tentatives' }
  }

  const utilisateur = await prisma.user.findUnique({
    where: { email: adresse },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      actif: true,
      failedLoginCount: true,
      lockedUntil: true,
      telephoneMobile: true,
      mfaEnrolledAt: true,
    },
  })

  if (!utilisateur) {
    await verifyPassword(motDePasse, await leurre())
    await recordAuthEvent({
      action: 'LOGIN_FAILURE',
      actorEmail: adresse,
      succeeded: false,
      deniedReason: 'identifiant inconnu',
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    })
    return { etat: 'identifiants_invalides' }
  }

  if (utilisateur.lockedUntil && utilisateur.lockedUntil > new Date()) {
    await recordAuthEvent({
      action: 'LOGIN_FAILURE',
      actorId: utilisateur.id,
      actorEmail: utilisateur.email,
      succeeded: false,
      deniedReason: 'compte verrouillé',
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    })
    return { etat: 'compte_verrouille', jusqua: utilisateur.lockedUntil }
  }

  const correct = await verifyPassword(motDePasse, utilisateur.passwordHash)

  if (!correct) {
    const echecs = utilisateur.failedLoginCount + 1
    const verrouiller = echecs >= MAX_ECHECS

    await prisma.user.update({
      where: { id: utilisateur.id },
      data: {
        failedLoginCount: echecs,
        ...(verrouiller ? { lockedUntil: new Date(Date.now() + VERROU_MINUTES * 60_000) } : {}),
      },
    })

    await recordAuthEvent({
      action: 'LOGIN_FAILURE',
      actorId: utilisateur.id,
      actorEmail: utilisateur.email,
      succeeded: false,
      deniedReason: verrouiller ? 'mot de passe incorrect — compte verrouillé' : 'mot de passe incorrect',
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    })

    return { etat: 'identifiants_invalides' }
  }

  // Le compte désactivé est vérifié APRÈS le mot de passe : répondre plus tôt
  // dirait à qui essaie qu'un compte existe à cette adresse.
  if (!utilisateur.actif) {
    await recordAuthEvent({
      action: 'LOGIN_FAILURE',
      actorId: utilisateur.id,
      actorEmail: utilisateur.email,
      succeeded: false,
      deniedReason: 'compte désactivé',
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    })
    return { etat: 'compte_desactive' }
  }

  await prisma.user.update({
    where: { id: utilisateur.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  })

  const { jeton, sessionId } = await creerSession(utilisateur.id, origine)

  // Poste déjà éprouvé PAR CETTE PERSONNE : on ouvre la session directement.
  // La confiance est vérifiée après le mot de passe, jamais à sa place.
  if (await estPosteDeConfiance(utilisateur.id, origine.workstationId ?? null)) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { mfaValidatedAt: new Date(), lastActivityAt: new Date() },
    })
    await prisma.user.update({
      where: { id: utilisateur.id },
      data: { lastLoginAt: new Date() },
    })

    // La confiance repart pour 30 jours à chaque usage. Sans cette ligne, le
    // compte à rebours partait de la dernière validation du second facteur : un
    // poste utilisé tous les matins réclamait quand même un SMS le 31e jour,
    // alors que D7quater vise les postes OUBLIÉS, pas ceux qui servent.
    await accorderConfiance(utilisateur.id, origine.workstationId ?? null)

    await recordAuthEvent({
      action: 'LOGIN_SUCCESS',
      actorId: utilisateur.id,
      actorEmail: utilisateur.email,
      succeeded: true,
      // Tracé explicitement : un contrôle doit pouvoir distinguer une connexion
      // à deux facteurs d'une connexion dispensée par la confiance du poste.
      deniedReason: 'poste de confiance — second facteur non demandé',
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    })

    return { etat: 'connecte', jeton, sessionId }
  }

  // Un téléphone déjà de confiance pour cette personne valide la connexion par QR code : le SMS ne part que si
  // elle le demande (D83).
  if (await aUnTelephoneReconnu(utilisateur.id, origine.workstationId ?? null)) {
    return { etat: 'telephone_requis', jeton, sessionId }
  }

  // Le second facteur est envoyé maintenant, pas réclamé : c'est toute la
  // différence avec le TOTP qu'il remplace (D7, révisée le 2026-09-15).
  const demande = await envoyerCode(sessionId, utilisateur.id)

  if (demande.etat === 'sans_numero') {
    // Ni connecté, ni en mesure de recevoir un code. L'écran doit le dire
    // clairement : c'est un compte à compléter, pas un mot de passe erroné.
    await recordAuthEvent({
      action: 'SECOND_FACTEUR_INDISPONIBLE',
      actorId: utilisateur.id,
      actorEmail: utilisateur.email,
      succeeded: false,
      deniedReason: 'aucun numéro de mobile enregistré',
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    })
    return { etat: 'numero_manquant', sessionId }
  }

  if (demande.etat !== 'envoye') {
    const raison =
      demande.etat === 'trop_de_demandes'
        ? 'Trop de codes demandés. Patientez avant de réessayer.'
        : demande.raison
    // Pas LOGIN_FAILURE : la limitation par IP compte ces échecs, et le cabinet
    // sort sur une seule adresse. Une panne du fournisseur y bloquerait tout le
    // personnel après vingt tentatives.
    await recordAuthEvent({
      action: 'SECOND_FACTEUR_INDISPONIBLE',
      actorId: utilisateur.id,
      actorEmail: utilisateur.email,
      succeeded: false,
      deniedReason: `envoi du code impossible : ${demande.etat}`,
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    })
    return { etat: 'sms_indisponible', sessionId, raison }
  }

  return { etat: 'mfa_requis', jeton, sessionId, masque: demande.masque }
}

/**
 * Renvoie un code sur la session en cours.
 *
 * Un SMS peut se perdre ou tarder ; sans ce chemin, la seule issue serait de
 * recommencer la connexion. La limite horaire d'`envoyerCode` s'applique.
 */
export async function renvoyerCode(sessionId: string): Promise<
  { etat: 'envoye'; masque: string } | { etat: 'impossible'; raison: string }
> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true, revokedAt: true, expiresAt: true, mfaValidatedAt: true },
  })
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return { etat: 'impossible', raison: 'Session expirée. Reprenez la connexion.' }
  }
  // Une session déjà validée n'a aucune raison de redemander un code.
  if (session.mfaValidatedAt) return { etat: 'impossible', raison: 'Session déjà validée.' }

  const demande = await envoyerCode(sessionId, session.userId)
  if (demande.etat === 'envoye') return { etat: 'envoye', masque: demande.masque }
  if (demande.etat === 'sans_numero') {
    return { etat: 'impossible', raison: 'Aucun numéro de mobile enregistré sur ce compte.' }
  }
  if (demande.etat === 'trop_de_demandes') {
    return { etat: 'impossible', raison: 'Trop de codes demandés. Patientez avant de réessayer.' }
  }
  return { etat: 'impossible', raison: demande.raison }
}

export type ResultatMfa =
  | { etat: 'connecte' }
  | { etat: 'code_invalide'; tentativesRestantes: number }
  | { etat: 'code_expire' }
  | { etat: 'trop_de_tentatives' }
  | { etat: 'session_invalide' }

export async function validerSecondFacteur(
  sessionId: string,
  code: string,
  origine: Origine,
): Promise<ResultatMfa> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: { id: true, email: true, actif: true, mfaEnrolledAt: true },
      },
    },
  })

  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.actif) {
    return { etat: 'session_invalide' }
  }
  const verdict = await verifierCode(sessionId, code)

  if (verdict.etat !== 'valide') {
    await recordAuthEvent({
      action: 'LOGIN_FAILURE',
      actorId: session.user.id,
      actorEmail: session.user.email,
      succeeded: false,
      deniedReason: `second facteur : ${verdict.etat}`,
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    })
    // Les motifs sont distincts à l'écran : « code faux », « code expiré » et
    // « trop d'essais » n'appellent pas le même geste.
    if (verdict.etat === 'expire') return { etat: 'code_expire' }
    if (verdict.etat === 'trop_de_tentatives') return { etat: 'trop_de_tentatives' }
    if (verdict.etat === 'aucun_code') return { etat: 'session_invalide' }
    return { etat: 'code_invalide', tentativesRestantes: verdict.tentativesRestantes }
  }

  await prisma.$transaction([
    prisma.session.update({
      where: { id: sessionId },
      data: { mfaValidatedAt: new Date(), lastActivityAt: new Date() },
    }),
    prisma.user.update({
      where: { id: session.user.id },
      data: {
        lastLoginAt: new Date(),
        // Date du PREMIER enrôlement, pas de la dernière connexion : la
        // réécrire à chaque fois effacerait l'information qu'elle porte.
        ...(session.user.mfaEnrolledAt ? {} : { mfaEnrolledAt: new Date() }),
      },
    }),
  ])

  // Le poste devient de confiance : la prochaine connexion depuis cette machine
  // ne redemandera pas de code pendant 30 jours.
  await accorderConfiance(session.user.id, origine.workstationId ?? null)

  await recordAuthEvent({
    action: 'LOGIN_SUCCESS',
    actorId: session.user.id,
    actorEmail: session.user.email,
    succeeded: true,
    ipAddress: origine.ipAddress,
    userAgent: origine.userAgent ?? null,
    workstationId: origine.workstationId ?? null,
  })

  return { etat: 'connecte' }
}

export async function deconnecter(
  sessionId: string,
  acteur: { id: string; email: string },
  origine: Origine,
): Promise<void> {
  await revoquerSession(sessionId)
  await recordAuthEvent({
    action: 'LOGOUT',
    actorId: acteur.id,
    actorEmail: acteur.email,
    succeeded: true,
    ipAddress: origine.ipAddress,
    userAgent: origine.userAgent ?? null,
    workstationId: origine.workstationId ?? null,
  })
}
