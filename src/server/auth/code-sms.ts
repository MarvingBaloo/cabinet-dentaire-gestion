import 'server-only'

import { createHash, randomInt } from 'node:crypto'

import { prisma } from '@/server/db/client'
import { envoyerSms } from '@/server/sms/envoi'

// Second facteur par code à usage unique envoyé par SMS (D7, révisée le
// 2026-09-15). Remplace le TOTP : le code arrive au lieu d'être cherché dans une
// application, et il n'y a plus rien à installer ni de QR à scanner.
//
// Ce que ce mécanisme protège, et ce qu'il ne protège pas. Il couvre le vol
// d'identifiants à distance : un mot de passe hameçonné ne suffit plus sans le
// téléphone. Il ne couvre pas l'interception du SMS lui-même — détournement de
// carte SIM, lecture sur un écran verrouillé. C'est un compromis assumé, pris
// en connaissance de cause au vu de l'usage (D15).

const LONGUEUR = 6
const VALIDITE_MINUTES = 10
const TENTATIVES_MAX = 3
/** Un compte ne peut pas déclencher plus d'envois que cela par heure. */
const ENVOIS_MAX_PAR_HEURE = 5

export type DemandeCode =
  | { etat: 'envoye'; masque: string }
  | { etat: 'sans_numero' }
  | { etat: 'trop_de_demandes' }
  | { etat: 'echec_envoi'; raison: string }

export type VerificationCode =
  | { etat: 'valide' }
  | { etat: 'invalide'; tentativesRestantes: number }
  | { etat: 'expire' }
  | { etat: 'trop_de_tentatives' }
  | { etat: 'aucun_code' }

/** Partagé avec la réservation publique : même code à usage unique, même
 *  raison de ne jamais le stocker en clair. */
export const condenserCode = (code: string) => createHash('sha256').update(code).digest('hex')
const condenser = condenserCode

/**
 * Six chiffres tirés d'une source cryptographique.
 *
 * `randomInt` et non `Math.random` : le second est prévisible, et deviner le
 * code revient alors à deviner l'état du générateur. La longueur est la même,
 * la différence ne se voit qu'à l'attaque.
 */
export function genererCode(): string {
  return String(randomInt(0, 10 ** LONGUEUR)).padStart(LONGUEUR, '0')
}

/** « +590 6XX XX XX 45 » — assez pour se reconnaître, pas pour désigner. */
export function masquerNumero(numero: string): string {
  const fin = numero.slice(-2)
  return `${'•'.repeat(Math.max(numero.length - 2, 0))}${fin}`
}

/**
 * Émet un code pour une session de connexion et l'envoie par SMS.
 *
 * Le code remplace celui qui pourrait déjà exister pour cette session : demander
 * un nouveau code invalide l'ancien, sinon deux codes valides circuleraient et
 * la limite de tentatives ne voudrait plus rien dire.
 */
export async function envoyerCode(sessionId: string, userId: string): Promise<DemandeCode> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telephoneMobile: true },
  })
  if (!user?.telephoneMobile) return { etat: 'sans_numero' }

  // Garde-fou de coût autant que de sécurité : sans limite, une boucle sur le
  // formulaire de connexion fait grimper la facture SMS et sature le téléphone
  // de la personne visée.
  //
  // Le compte se fait sur la colonne `envois` et non sur le nombre de lignes :
  // un renvoi met la ligne de la session à jour au lieu d'en créer une, si bien
  // qu'un décompte par lignes restait bloqué à un et ne limitait rien.
  const depuisUneHeure = new Date(Date.now() - 3_600_000)
  const recents = await prisma.codeSms.findMany({
    where: { session: { userId }, createdAt: { gt: depuisUneHeure } },
    select: { envois: true },
  })
  const envoisRecents = recents.reduce((total, ligne) => total + ligne.envois, 0)
  if (envoisRecents >= ENVOIS_MAX_PAR_HEURE) return { etat: 'trop_de_demandes' }

  const code = genererCode()
  const expiresAt = new Date(Date.now() + VALIDITE_MINUTES * 60_000)

  await prisma.codeSms.upsert({
    where: { sessionId },
    // `createdAt` n'est PAS réécrit : c'est la date du premier envoi qui ouvre
    // la fenêtre d'une heure. La remettre à zéro à chaque renvoi repousserait
    // indéfiniment la limite qu'elle sert à appliquer.
    update: {
      codeHash: condenser(code),
      expiresAt,
      tentatives: 0,
      envois: { increment: 1 },
    },
    create: { sessionId, codeHash: condenser(code), expiresAt },
  })

  const envoi = await envoyerSms({
    destinataire: user.telephoneMobile,
    texte: `Cabinet dentaire — votre code de connexion : ${code}. Valable ${VALIDITE_MINUTES} minutes. Ne le communiquez à personne.`,
  })

  if (!envoi.ok) {
    // Le code est retiré : le laisser en base ferait échouer la connexion sur
    // un code que personne n'a reçu, et consommerait le quota horaire.
    await prisma.codeSms.deleteMany({ where: { sessionId } })
    return { etat: 'echec_envoi', raison: envoi.raison }
  }

  return { etat: 'envoye', masque: masquerNumero(user.telephoneMobile) }
}

/**
 * Vérifie un code saisi.
 *
 * Le compteur de tentatives est incrémenté AVANT la comparaison : une
 * interruption entre les deux ne doit pas offrir un essai gratuit.
 */
export async function verifierCode(sessionId: string, saisi: string): Promise<VerificationCode> {
  const enregistre = await prisma.codeSms.findUnique({ where: { sessionId } })
  if (!enregistre) return { etat: 'aucun_code' }

  if (enregistre.expiresAt <= new Date()) {
    await prisma.codeSms.delete({ where: { sessionId } })
    return { etat: 'expire' }
  }

  if (enregistre.tentatives >= TENTATIVES_MAX) {
    await prisma.codeSms.delete({ where: { sessionId } })
    return { etat: 'trop_de_tentatives' }
  }

  const apres = await prisma.codeSms.update({
    where: { sessionId },
    data: { tentatives: { increment: 1 } },
    select: { tentatives: true, codeHash: true },
  })

  if (apres.codeHash !== condenser(saisi.trim())) {
    const restantes = Math.max(TENTATIVES_MAX - apres.tentatives, 0)
    if (restantes === 0) {
      await prisma.codeSms.delete({ where: { sessionId } })
      return { etat: 'trop_de_tentatives' }
    }
    return { etat: 'invalide', tentativesRestantes: restantes }
  }

  // Usage unique : un code validé disparaît, il ne resservira pas.
  await prisma.codeSms.delete({ where: { sessionId } })
  return { etat: 'valide' }
}

/** Purge les codes expirés. Appelée par la tâche de maintenance. */
export async function purgerCodesExpires(): Promise<number> {
  const { count } = await prisma.codeSms.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  return count
}
