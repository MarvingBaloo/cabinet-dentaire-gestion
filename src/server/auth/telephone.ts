import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { accorderConfiance, estPosteDeConfiance } from '@/server/auth/confiance'
import type { Origine } from '@/server/auth/connexion'
import { recordAuthEvent } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// La connexion validée depuis le téléphone (D83, Marving, 30/10). Le poste qui ne connaît pas encore la personne
// affiche un QR ; elle le vise avec son téléphone, qui lui demande « C'est bien vous ? » ; « Oui » ouvre le poste.
//
// CE QUI FAIT LA SÉCURITÉ : seul un téléphone déjà de confiance pour CETTE personne peut répondre. Le QR, lui,
// s'affiche devant quiconque a le mot de passe — y compris sur l'écran de celui qui l'a volé. Le téléphone devient
// de confiance comme n'importe quel poste : une connexion avec le code SMS (D7quater).

/** Deux minutes : le temps de sortir son téléphone, pas celui de photographier l'écran et de s'éloigner. */
const VALIDITE_MINUTES = 2

const condenser = (jeton: string) => createHash('sha256').update(jeton).digest('hex')

/** Un téléphone de confiance pour cette personne, autre que le poste où elle se connecte. */
export async function aUnTelephoneReconnu(userId: string, sauf: string | null): Promise<boolean> {
  const confiance = await prisma.trustedWorkstation.findFirst({
    where: {
      userId,
      trustedUntil: { gt: new Date() },
      workstation: { telephone: true, actif: true, ...(sauf ? { id: { not: sauf } } : {}) },
    },
    select: { workstationId: true },
  })
  return !!confiance
}

/** Le jeton du QR, neuf à chaque affichage : l'ancien cesse de valoir. */
export async function preparerValidation(sessionId: string): Promise<string> {
  const jeton = randomBytes(32).toString('base64url')
  const donnees = { jetonHash: condenser(jeton), expiresAt: new Date(Date.now() + VALIDITE_MINUTES * 60_000) }
  await prisma.validationTelephone.upsert({
    where: { sessionId },
    update: { ...donnees, approuveLe: null, refuseLe: null },
    create: { sessionId, ...donnees },
  })
  return jeton
}

export type EtatPoste = 'attente' | 'expire' | 'refuse'

/** Ce que le poste, qui attend, voit de sa demande. La session validée, elle, se lit comme toute session. */
export async function etatValidation(sessionId: string): Promise<EtatPoste> {
  const v = await prisma.validationTelephone.findUnique({
    where: { sessionId },
    select: { expiresAt: true, refuseLe: true },
  })
  if (!v || v.refuseLe) return v ? 'refuse' : 'expire'
  return v.expiresAt <= new Date() ? 'expire' : 'attente'
}

export type Demande =
  | { etat: 'a_confirmer'; prenom: string; nom: string; poste: string; site: string | null }
  | { etat: 'non_reconnu' }
  | { etat: 'perimee' }

async function lireDemande(jeton: string) {
  const v = await prisma.validationTelephone.findUnique({
    where: { jetonHash: condenser(jeton) },
    select: {
      id: true,
      expiresAt: true,
      approuveLe: true,
      refuseLe: true,
      session: {
        select: {
          id: true,
          revokedAt: true,
          expiresAt: true,
          mfaValidatedAt: true,
          workstationId: true,
          user: { select: { id: true, email: true, prenom: true, nom: true, actif: true } },
          workstation: { select: { nom: true, site: { select: { nom: true } } } },
        },
      },
    },
  })
  const maintenant = new Date()
  if (
    !v ||
    v.approuveLe ||
    v.refuseLe ||
    v.expiresAt <= maintenant ||
    v.session.revokedAt ||
    v.session.expiresAt <= maintenant ||
    v.session.mfaValidatedAt ||
    !v.session.user.actif
  ) {
    return null
  }
  return v
}

/** Le téléphone répond-il pour la personne qui se connecte ? Son poste, et non son navigateur, en décide. */
async function telephoneReconnu(
  demande: NonNullable<Awaited<ReturnType<typeof lireDemande>>>,
  telephoneId: string | null,
): Promise<boolean> {
  if (!telephoneId || telephoneId === demande.session.workstationId) return false
  const poste = await prisma.workstation.findFirst({
    where: { id: telephoneId, telephone: true, actif: true },
    select: { id: true },
  })
  return !!poste && (await estPosteDeConfiance(demande.session.user.id, telephoneId))
}

/** La page du téléphone, après le scan. Un téléphone inconnu n'apprend pas qui se connecte. */
export async function decrireDemande(jeton: string, telephoneId: string | null): Promise<Demande> {
  const demande = await lireDemande(jeton)
  if (!demande) return { etat: 'perimee' }
  if (!(await telephoneReconnu(demande, telephoneId))) return { etat: 'non_reconnu' }
  const { user, workstation } = demande.session
  return {
    etat: 'a_confirmer',
    prenom: user.prenom,
    nom: user.nom,
    poste: workstation?.nom ?? 'un poste non identifié',
    site: workstation?.site?.nom ?? null,
  }
}

export type Reponse = { etat: 'fait' } | { etat: 'non_reconnu' } | { etat: 'perimee' }

/**
 * « Oui, c'est moi » : la session du poste est validée, le poste devient de confiance pour 30 jours, comme après
 * un code SMS. Le téléphone aussi voit sa confiance prolongée : il vient de servir.
 */
export async function approuver(jeton: string, origineTelephone: Origine): Promise<Reponse> {
  const demande = await lireDemande(jeton)
  if (!demande) return { etat: 'perimee' }
  if (!(await telephoneReconnu(demande, origineTelephone.workstationId ?? null))) {
    await tracerNonReconnu(demande.session.user, origineTelephone)
    return { etat: 'non_reconnu' }
  }
  const { session } = demande
  const maintenant = new Date()

  // La ligne n'est marquée que si personne ne l'a fait entre-temps : deux « Oui » simultanés n'en font qu'un.
  const { count } = await prisma.validationTelephone.updateMany({
    where: { id: demande.id, approuveLe: null, refuseLe: null },
    data: { approuveLe: maintenant },
  })
  if (count === 0) return { etat: 'perimee' }

  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { mfaValidatedAt: maintenant, lastActivityAt: maintenant },
    }),
    prisma.user.update({ where: { id: session.user.id }, data: { lastLoginAt: maintenant } }),
  ])
  await accorderConfiance(session.user.id, session.workstationId)
  await accorderConfiance(session.user.id, origineTelephone.workstationId ?? null)

  await recordAuthEvent({
    action: 'LOGIN_SUCCESS',
    actorId: session.user.id,
    actorEmail: session.user.email,
    succeeded: true,
    deniedReason: 'second facteur : validé depuis le téléphone',
    // Le poste qui s'ouvre, pas le téléphone : c'est lui que le journal doit nommer.
    ipAddress: origineTelephone.ipAddress,
    userAgent: origineTelephone.userAgent ?? null,
    workstationId: session.workstationId,
  })
  return { etat: 'fait' }
}

/** « Non » : ce n'est pas elle qui se connecte. La tentative est coupée et le journal le garde. */
export async function refuser(jeton: string, origineTelephone: Origine): Promise<Reponse> {
  const demande = await lireDemande(jeton)
  if (!demande) return { etat: 'perimee' }
  if (!(await telephoneReconnu(demande, origineTelephone.workstationId ?? null))) {
    await tracerNonReconnu(demande.session.user, origineTelephone)
    return { etat: 'non_reconnu' }
  }
  const maintenant = new Date()
  await prisma.$transaction([
    prisma.validationTelephone.update({ where: { id: demande.id }, data: { refuseLe: maintenant } }),
    prisma.session.update({ where: { id: demande.session.id }, data: { revokedAt: maintenant } }),
  ])
  await recordAuthEvent({
    action: 'LOGIN_FAILURE',
    actorId: demande.session.user.id,
    actorEmail: demande.session.user.email,
    succeeded: false,
    deniedReason: 'connexion refusée depuis le téléphone',
    ipAddress: origineTelephone.ipAddress,
    userAgent: origineTelephone.userAgent ?? null,
    workstationId: demande.session.workstationId,
  })
  return { etat: 'fait' }
}

async function tracerNonReconnu(user: { id: string; email: string }, origine: Origine) {
  await recordAuthEvent({
    action: 'LOGIN_FAILURE',
    actorId: user.id,
    actorEmail: user.email,
    succeeded: false,
    deniedReason: 'QR de connexion utilisé par un appareil non reconnu',
    ipAddress: origine.ipAddress,
    userAgent: origine.userAgent ?? null,
    workstationId: origine.workstationId ?? null,
  })
}

/** L'écran du second facteur : la saisie du code dès qu'un SMS est parti pour cette connexion, le QR sinon. */
export async function modeSecondFacteur(sessionId: string): Promise<'sms' | 'telephone'> {
  const code = await prisma.codeSms.findUnique({ where: { sessionId }, select: { id: true } })
  return code ? 'sms' : 'telephone'
}
