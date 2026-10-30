import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import type { Prisma } from '@prisma/client'

import { env } from '@/config/env'
import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'

// Sessions en base (D6). Le cookie ne porte qu'un jeton opaque ; c'est la ligne
// en base qui fait foi, à chaque requête.
//
// EN BASE ON NE STOCKE QUE LE CONDENSAT DU JETON. Un export de la base ne permet
// donc pas d'usurper une session ouverte — c'est la même raison qui interdit de
// stocker un mot de passe en clair. SHA-256 nu suffit ici, contrairement aux
// mots de passe : le jeton fait 32 octets aléatoires, il n'y a rien à deviner
// par force brute, donc aucun besoin de fonction lente.

export const NOM_COOKIE_SESSION = 'cabinet_session'

const DUREE_ABSOLUE_HEURES = 12

export type ResultatSession =
  | { etat: 'valide'; ctx: AuthContext; sessionId: string }
  | { etat: 'mfa_requis'; sessionId: string; userId: string }
  | { etat: 'absente' }
  | { etat: 'expiree' }
  | { etat: 'revoquee' }
  | { etat: 'inactivite' }

const condenser = (jeton: string) => createHash('sha256').update(jeton).digest('hex')

export type OrigineRequete = {
  ipAddress: string
  userAgent?: string | null
  workstationId?: string | null
  /** Site d'où part l'action, déduit du poste de travail (D5, D7). */
  siteId?: string | null
}

/** Crée une session NON validée par le second facteur : elle n'ouvre aucun droit
 *  tant que `mfaValidatedAt` est nul. */
export async function creerSession(
  userId: string,
  origine: OrigineRequete,
): Promise<{ jeton: string; sessionId: string }> {
  const jeton = randomBytes(32).toString('base64url')

  const session = await prisma.session.create({
    data: {
      userId,
      sessionToken: condenser(jeton),
      expiresAt: new Date(Date.now() + DUREE_ABSOLUE_HEURES * 3_600_000),
      ipAddress: origine.ipAddress,
      userAgent: origine.userAgent ?? null,
      workstationId: origine.workstationId ?? null,
    },
    select: { id: true },
  })

  return { jeton, sessionId: session.id }
}

export async function marquerMfaValide(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { mfaValidatedAt: new Date(), lastActivityAt: new Date() },
  })
}

/**
 * Résout un jeton en contexte, en appliquant dans l'ordre : révocation,
 * expiration absolue, inactivité, second facteur.
 *
 * L'ordre importe. Une session révoquée doit être signalée comme révoquée même
 * si elle est aussi expirée : c'est ce que le journal doit refléter.
 */
export async function resoudreSession(
  jeton: string | undefined,
  origine: OrigineRequete,
  /** Faux pour ce qui n'est pas un geste de la personne — le flux de l'agenda
   *  en direct et les rafraîchissements qu'il déclenche (D61) : sinon un poste
   *  laissé ouvert dans un couloir ne serait jamais déconnecté pour inactivité. */
  { prolonger = true }: { prolonger?: boolean } = {},
): Promise<ResultatSession> {
  if (!jeton) return { etat: 'absente' }

  const session = await prisma.session.findUnique({
    where: { sessionToken: condenser(jeton) },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
      lastActivityAt: true,
      mfaValidatedAt: true,
      workstationId: true,
    },
  })

  if (!session) return { etat: 'absente' }
  if (session.revokedAt) return { etat: 'revoquee' }

  const maintenant = Date.now()
  if (session.expiresAt.getTime() <= maintenant) return { etat: 'expiree' }

  const limiteInactivite = session.lastActivityAt.getTime() + env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000
  if (limiteInactivite <= maintenant) {
    // Révoquée et non simplement ignorée : le poste laissé ouvert dans un
    // couloir ne doit pas redevenir utilisable en rafraîchissant la page.
    await revoquerSession(session.id)
    return { etat: 'inactivite' }
  }

  if (!session.mfaValidatedAt) {
    return { etat: 'mfa_requis', sessionId: session.id, userId: session.userId }
  }

  const ctx = await loadAuthContext(session.userId, {
    ipAddress: origine.ipAddress,
    userAgent: origine.userAgent ?? null,
    workstationId: origine.workstationId ?? session.workstationId,
    siteId: origine.siteId ?? null,
  })

  // Compte désactivé entre-temps : la session tombe immédiatement. C'est
  // précisément ce qu'un JWT ne saurait pas faire.
  if (!ctx) {
    await revoquerSession(session.id)
    return { etat: 'revoquee' }
  }

  if (prolonger) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() },
    })
  }

  return { etat: 'valide', ctx, sessionId: session.id }
}

export async function revoquerSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/** Accepte un client de transaction : la désactivation d'un compte et la
 *  révocation de ses sessions doivent être atomiques. */
export async function revoquerToutesLesSessions(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const { count } = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return count
}

export function optionsCookieSession() {
  return {
    httpOnly: true, // inaccessible au JavaScript de la page : neutralise le vol par XSS
    sameSite: 'lax' as const, // le cookie ne part pas sur une requête déclenchée par un autre site
    secure: env.SESSION_COOKIE_SECURE,
    path: '/',
    maxAge: DUREE_ABSOLUE_HEURES * 3600,
  }
}
