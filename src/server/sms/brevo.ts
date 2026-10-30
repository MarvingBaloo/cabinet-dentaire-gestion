import 'server-only'

import { env } from '@/config/env'

import type { Message, ResultatEnvoi, Transporteur } from '@/server/sms/envoi'

// Transporteur Brevo, derrière l'interface de `envoi.ts`.
//
// ⚠ CE MODULE MANIPULE DES CODES À USAGE UNIQUE. Rien de ce qui passe ici ne
// doit finir dans un journal : ni le texte du message, ni le numéro complet, ni
// la clé d'API. Une trace d'erreur qui recopie la requête livrerait le second
// facteur à qui lit les logs.
//
// ⚠ AUCUNE HYPOTHÈSE DE PAYS. Le numéro part tel qu'il est enregistré, en
// format international imposé à la saisie (voir validation/user.ts). Un cabinet
// en Guadeloupe, un praticien en métropole et un remplaçant belge doivent
// fonctionner de la même façon.

/** `/transactionalSMS/sms` est déprécié ; `send` est l'endpoint courant. */
const URL_ENVOI = 'https://api.brevo.com/v3/transactionalSMS/send'

/** Au-delà, la personne est devant un écran qui ne répond pas. Mieux vaut un
 *  échec net qu'une attente indéfinie. */
const DELAI_MS = 10_000

/**
 * Brevo attend le numéro **sans le `+`** : `+33612345678` devient `33612345678`.
 * On ne retire que lui — pas d'espaces à nettoyer, la saisie est déjà validée
 * en E.164, et « nettoyer » plus largement reviendrait à réinterpréter.
 */
function destinataireBrevo(numero: string): string {
  return numero.startsWith('+') ? numero.slice(1) : numero
}

export function creerTransporteurBrevo(cle: string, expediteur: string): Transporteur {
  return {
    nom: 'brevo',
    async envoyer(message: Message): Promise<ResultatEnvoi> {
      let reponse: Response
      try {
        reponse = await fetch(URL_ENVOI, {
          method: 'POST',
          headers: {
            'api-key': cle,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            sender: expediteur,
            recipient: destinataireBrevo(message.destinataire),
            content: message.texte,
            type: 'transactional',
          }),
          signal: AbortSignal.timeout(DELAI_MS),
        })
      } catch (e) {
        // Panne réseau ou délai dépassé. Le message d'origine n'est pas repris :
        // il contient le code.
        const cause = e instanceof Error ? e.name : 'inconnue'
        return { ok: false, raison: `Brevo injoignable (${cause}).` }
      }

      if (!reponse.ok) {
        // Le corps d'erreur de Brevo ne contient pas le message envoyé, mais il
        // peut contenir le numéro : on n'en garde que le code applicatif.
        let code = 'sans code'
        try {
          const corps = (await reponse.json()) as { code?: unknown }
          if (typeof corps.code === 'string') code = corps.code
        } catch {
          // Corps illisible : le statut HTTP suffit à qualifier l'échec.
        }
        return { ok: false, raison: `Brevo a refusé l’envoi (HTTP ${reponse.status}, ${code}).` }
      }

      let reference: string | undefined
      let credits: number | undefined
      try {
        const corps = (await reponse.json()) as { messageId?: unknown; usedCredits?: unknown }
        if (typeof corps.messageId === 'string' || typeof corps.messageId === 'number') {
          reference = String(corps.messageId)
        }
        // Coût réel de l'envoi, si Brevo le rend (`usedCredits`, sur
        // `POST /transactionalSMS/send`) — sert le suivi du budget SMS, pas la
        // connexion elle-même : son absence ne remet rien en cause.
        if (typeof corps.usedCredits === 'number') {
          credits = corps.usedCredits
        }
      } catch {
        // Un corps illisible sur un 2xx ne remet pas l'envoi en cause : il ne
        // prive que de la référence et du coût, qui servent au suivi, pas à la
        // connexion.
      }

      // `exactOptionalPropertyTypes` : une clé absente et une clé à `undefined`
      // ne sont pas la même chose ici — d'où les quatre branches plutôt qu'un
      // objet construit par petits bouts.
      if (reference !== undefined && credits !== undefined) return { ok: true, reference, credits }
      if (reference !== undefined) return { ok: true, reference }
      if (credits !== undefined) return { ok: true, credits }
      return { ok: true }
    },
  }
}

/** Le transporteur Brevo si les deux variables sont là, sinon `null`. */
export function brevoConfigure(): Transporteur | null {
  const cle = env.BREVO_API_KEY
  const expediteur = env.BREVO_SMS_EXPEDITEUR
  if (!cle || !expediteur) return null
  return creerTransporteurBrevo(cle, expediteur)
}
