import 'server-only'

import { CABINET } from '@/config/cabinet'
import { env } from '@/config/env'

import type { MessageEmail, TransporteurEmail } from '@/server/email/envoi'
import type { ResultatEnvoi } from '@/server/sms/envoi'

// Transporteur Brevo, derrière l'interface de `envoi.ts` — calqué sur
// src/server/sms/brevo.ts.
//
// ⚠ CE MODULE MANIPULE DES NOTIFICATIONS. Rien de ce qui passe ici ne doit
// finir dans un journal : ni l'adresse destinataire, ni le texte du message,
// ni la clé d'API.

const URL_ENVOI = 'https://api.brevo.com/v3/smtp/email'

/** Au-delà, mieux vaut un échec net qu'une attente indéfinie. */
const DELAI_MS = 10_000

/** Le nom de la charte (D72), comme sur le site. */
const NOM_EXPEDITEUR = CABINET.nomCommercial ?? CABINET.nom

export function creerTransporteurEmailBrevo(cle: string, expediteur: string): TransporteurEmail {
  return {
    nom: 'brevo',
    async envoyer(message: MessageEmail): Promise<ResultatEnvoi> {
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
            sender: { email: expediteur, name: NOM_EXPEDITEUR },
            to: [{ email: message.destinataire }],
            subject: message.sujet,
            textContent: message.texte,
          }),
          signal: AbortSignal.timeout(DELAI_MS),
        })
      } catch (e) {
        // Panne réseau ou délai dépassé. Le message d'origine n'est pas repris.
        const cause = e instanceof Error ? e.name : 'inconnue'
        return { ok: false, raison: `Brevo injoignable (${cause}).` }
      }

      if (!reponse.ok) {
        // Le corps d'erreur de Brevo peut contenir l'adresse ou le sujet : on
        // n'en garde que le code applicatif.
        let code = 'sans code'
        try {
          const corps = (await reponse.json()) as { code?: unknown }
          if (typeof corps.code === 'string') code = corps.code
        } catch {
          // Corps illisible : le statut HTTP suffit à qualifier l'échec.
        }
        return { ok: false, raison: `Brevo a refusé l'envoi (HTTP ${reponse.status}, ${code}).` }
      }

      let reference: string | undefined
      try {
        const corps = (await reponse.json()) as { messageId?: unknown }
        if (typeof corps.messageId === 'string' || typeof corps.messageId === 'number') {
          reference = String(corps.messageId)
        }
      } catch {
        // Un corps illisible sur un 2xx ne remet pas l'envoi en cause : il ne
        // prive que de la référence, qui sert au suivi, pas à la notification.
      }

      if (reference !== undefined) return { ok: true, reference }
      return { ok: true }
    },
  }
}

/** Le transporteur e-mail Brevo si les deux variables sont là, sinon `null`. */
export function brevoEmailConfigure(): TransporteurEmail | null {
  const cle = env.BREVO_API_KEY
  const expediteur = env.BREVO_EMAIL_EXPEDITEUR
  if (!cle || !expediteur) return null
  return creerTransporteurEmailBrevo(cle, expediteur)
}
