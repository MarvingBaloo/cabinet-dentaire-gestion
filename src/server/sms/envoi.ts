import 'server-only'

import { env } from '@/config/env'

import { brevoConfigure } from '@/server/sms/brevo'

// Envoi de SMS, derrière une interface.
//
// POURQUOI UNE INTERFACE plutôt qu'un appel direct. Le fournisseur n'est pas
// choisi : il doit couvrir l'indicatif +590 et servira aussi aux rappels de
// rendez-vous de la phase 4. Attendre ce choix pour écrire le second facteur
// bloquerait le développement sur une décision commerciale.
//
// Le code métier ne connaît donc que `envoyerSms`. Brancher un opérateur
// consiste à ajouter un fichier et deux variables d'environnement, sans toucher
// à ce qui appelle.
//
// ⚠ Un SMS non délivré est une personne bloquée devant son écran. La couverture
// réelle en Guadeloupe et à Marie-Galante se vérifie par un envoi sur un vrai
// numéro, pas sur la documentation du fournisseur.

export type Message = {
  /** Numéro au format international, +590… */
  destinataire: string
  texte: string
}

export type ResultatEnvoi =
  | { ok: true; reference?: string; credits?: number }
  | { ok: false; raison: string }

export interface Transporteur {
  readonly nom: string
  envoyer(message: Message): Promise<ResultatEnvoi>
}

/**
 * Transporteur de développement : écrit le message dans le terminal.
 *
 * Permet de dérouler tout le parcours de connexion sans fournisseur, sans coût
 * et sans réseau. C'est aussi ce qui tourne dans les tests.
 */
export const transporteurConsole: Transporteur = {
  nom: 'console',
  async envoyer(message) {
    console.log(
      `\n  ┌─ SMS (développement) ────────────────────────────\n` +
        `  │ à      ${message.destinataire}\n` +
        `  │ texte  ${message.texte}\n` +
        `  └──────────────────────────────────────────────────\n`,
    )
    return { ok: true, reference: 'console' }
  },
}

/**
 * Refuse d'envoyer. Sert de garde-fou par défaut en production tant qu'aucun
 * opérateur n'est configuré : mieux vaut un échec visible et tracé qu'un code
 * que personne ne reçoit et que personne ne s'explique.
 */
export const transporteurAbsent: Transporteur = {
  nom: 'absent',
  async envoyer() {
    return { ok: false, raison: "Aucun fournisseur de SMS n'est configuré." }
  },
}

/**
 * Les neuf derniers chiffres : ce qu'un humain appelle « le même numéro ».
 * `+590 690 12 34 56`, `0690123456` et `06 90 12 34 56` donnent tous `690123456`.
 * La liste des numéros autorisés s'écrit donc comme on veut.
 */
function empreinteNumero(numero: string): string {
  return numero.replace(/\D/g, '').slice(-9)
}

/**
 * Hors production, un opérateur réel n'envoie qu'aux numéros autorisés.
 *
 * ⚠ POURQUOI CE GARDE-FOU EXISTE. Le 2026-09-19, en vérifiant l'annulation en
 * ligne sur un poste de développement, un SMS est parti vers un numéro inventé
 * pour le test : Brevo était configuré, et un opérateur configuré l'emportait
 * sur la console. La règle était écrite (D18) et avait été lue. Elle n'a pas
 * été appliquée au bon moment — une règle qui dépend de la mémoire de celui qui
 * agit ne tient pas. Elle vit donc ici, où elle ne peut pas être oubliée.
 *
 * Tout numéro hors liste s'écrit dans la console, comme avant Brevo. Liste
 * absente = aucun envoi réel hors production : le défaut est sûr.
 *
 * Reçoit ses paramètres au lieu de lire `env` : c'est ce qui la rend testable
 * sans recharger le module.
 */
export function filtrerHorsProduction(
  operateur: Transporteur,
  options: { production: boolean; autorises: readonly string[] },
): Transporteur {
  if (options.production) return operateur

  const autorises = new Set(options.autorises.map(empreinteNumero))

  return {
    nom: `${operateur.nom} (réservé aux numéros autorisés)`,
    async envoyer(message) {
      if (autorises.has(empreinteNumero(message.destinataire))) {
        return operateur.envoyer(message)
      }
      return transporteurConsole.envoyer(message)
    },
  }
}

let transporteur: Transporteur | null = null

export function transporteurCourant(): Transporteur {
  if (transporteur) return transporteur

  // Un opérateur configuré sert en production. Hors production, il ne sert que
  // pour les numéros de SMS_NUMEROS_AUTORISES : de quoi éprouver un envoi réel
  // vers son propre téléphone — ce que la documentation d'un fournisseur ne
  // remplace pas — sans pouvoir en envoyer ailleurs par mégarde.
  const operateur = brevoConfigure()
  if (operateur) {
    transporteur = filtrerHorsProduction(operateur, {
      production: env.NODE_ENV === 'production',
      autorises: env.SMS_NUMEROS_AUTORISES,
    })
    return transporteur
  }

  // Sans opérateur : en production, l'absence doit se voir. Ailleurs, la console
  // suffit et évite d'avoir à configurer quoi que ce soit pour dérouler une
  // connexion.
  transporteur = env.NODE_ENV === 'production' ? transporteurAbsent : transporteurConsole
  return transporteur
}

/** Remplace le transporteur — pour les tests, et pour brancher un opérateur. */
export function definirTransporteur(t: Transporteur): void {
  transporteur = t
}

export async function envoyerSms(message: Message): Promise<ResultatEnvoi> {
  return transporteurCourant().envoyer(message)
}
