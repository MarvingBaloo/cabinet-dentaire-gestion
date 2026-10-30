import 'server-only'

import { env } from '@/config/env'

import { brevoEmailConfigure } from '@/server/email/brevo'
import type { ResultatEnvoi } from '@/server/sms/envoi'

// Envoi d'e-mail, derrière une interface — même forme que src/server/sms/envoi.ts,
// pour la même raison : le fournisseur n'est pas choisi et le code métier ne
// doit connaître que `envoyerEmail`. Brancher un opérateur consiste à ajouter
// un fichier et deux variables d'environnement, sans toucher à ce qui appelle.

export type MessageEmail = {
  destinataire: string
  sujet: string
  texte: string
}

export interface TransporteurEmail {
  readonly nom: string
  envoyer(message: MessageEmail): Promise<ResultatEnvoi>
}

/**
 * Transporteur de développement : écrit l'e-mail dans le terminal.
 *
 * Permet de dérouler tout parcours notifiant sans fournisseur, sans coût et
 * sans réseau. C'est aussi ce qui tourne dans les tests.
 */
export const transporteurEmailConsole: TransporteurEmail = {
  nom: 'console',
  async envoyer(message) {
    console.log(
      `\n  ┌─ E-MAIL (développement) ─────────────────────────\n` +
        `  │ à      ${message.destinataire}\n` +
        `  │ sujet  ${message.sujet}\n` +
        `  │ texte  ${message.texte}\n` +
        `  └──────────────────────────────────────────────────\n`,
    )
    return { ok: true, reference: 'console' }
  },
}

/**
 * Refuse d'envoyer. Sert de garde-fou par défaut en production tant qu'aucun
 * opérateur n'est configuré : mieux vaut un échec visible et tracé qu'un
 * e-mail que personne ne reçoit et que personne ne s'explique.
 */
export const transporteurEmailAbsent: TransporteurEmail = {
  nom: 'absent',
  async envoyer() {
    return { ok: false, raison: "Aucun fournisseur d'e-mail n'est configuré." }
  },
}

function empreinteAdresse(adresse: string): string {
  return adresse.trim().toLowerCase()
}

/**
 * Hors production, un opérateur réel n'envoie que vers les adresses autorisées.
 * Même garde-fou que `filtrerHorsProduction` côté SMS (D18) : un opérateur
 * configuré ne doit jamais pouvoir écrire à une adresse inventée pour un test.
 *
 * Toute adresse hors liste s'écrit dans la console. Liste absente = aucun
 * envoi réel hors production : le défaut est sûr.
 *
 * Reçoit ses paramètres au lieu de lire `env` : c'est ce qui la rend testable
 * sans recharger le module.
 */
export function filtrerEmailHorsProduction(
  operateur: TransporteurEmail,
  options: { production: boolean; autorises: readonly string[] },
): TransporteurEmail {
  if (options.production) return operateur

  const autorises = new Set(options.autorises.map(empreinteAdresse))

  return {
    nom: `${operateur.nom} (réservé aux adresses autorisées)`,
    async envoyer(message) {
      if (autorises.has(empreinteAdresse(message.destinataire))) {
        return operateur.envoyer(message)
      }
      return transporteurEmailConsole.envoyer(message)
    },
  }
}

let transporteur: TransporteurEmail | null = null

export function transporteurEmailCourant(): TransporteurEmail {
  if (transporteur) return transporteur

  const operateur = brevoEmailConfigure()
  if (operateur) {
    transporteur = filtrerEmailHorsProduction(operateur, {
      production: env.NODE_ENV === 'production',
      autorises: env.EMAIL_ADRESSES_AUTORISEES,
    })
    return transporteur
  }

  transporteur = env.NODE_ENV === 'production' ? transporteurEmailAbsent : transporteurEmailConsole
  return transporteur
}

/** Remplace le transporteur — pour les tests, et pour brancher un opérateur. */
export function definirTransporteurEmail(t: TransporteurEmail): void {
  transporteur = t
}

export async function envoyerEmail(message: MessageEmail): Promise<ResultatEnvoi> {
  return transporteurEmailCourant().envoyer(message)
}
