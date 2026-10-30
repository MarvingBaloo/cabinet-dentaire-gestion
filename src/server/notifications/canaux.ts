import 'server-only'

import { CanalNotification } from '@prisma/client'

import { transporteurEmailCourant } from '@/server/email/envoi'
import { transporteurCourant } from '@/server/sms/envoi'
import type { ResultatEnvoi } from '@/server/sms/envoi'

// Sélection du canal d'envoi pour la file de notifications (phase 4, lot 2) :
// un seul point où `traiterLot` (src/server/notifications/file.ts) décide
// « SMS ou e-mail ? », pour ne jamais dupliquer la logique de construction du
// résultat (fournisseur, référence, crédits) entre les deux canaux.

export type NotificationAEnvoyer = {
  canal: CanalNotification
  destinataire: string
  texte: string
  sujet: string | null
}

export type ResultatEnvoiCanal =
  | { ok: true; fournisseur: string; reference?: string; credits?: number }
  | { ok: false; raison: string }

/** `exactOptionalPropertyTypes` : quatre branches plutôt qu'un objet construit
 *  par petits bouts, comme dans sms/brevo.ts. */
function resultatCanal(fournisseur: string, resultat: ResultatEnvoi): ResultatEnvoiCanal {
  if (!resultat.ok) return { ok: false, raison: resultat.raison }
  if (resultat.reference !== undefined && resultat.credits !== undefined) {
    return { ok: true, fournisseur, reference: resultat.reference, credits: resultat.credits }
  }
  if (resultat.reference !== undefined) return { ok: true, fournisseur, reference: resultat.reference }
  if (resultat.credits !== undefined) return { ok: true, fournisseur, credits: resultat.credits }
  return { ok: true, fournisseur }
}

export async function envoyerParCanal(n: NotificationAEnvoyer): Promise<ResultatEnvoiCanal> {
  if (n.canal === CanalNotification.SMS) {
    const transporteur = transporteurCourant()
    const resultat = await transporteur.envoyer({ destinataire: n.destinataire, texte: n.texte })
    return resultatCanal(transporteur.nom, resultat)
  }

  // EMAIL : un sujet est obligatoire — un SMS n'en a pas, mais un e-mail sans
  // sujet n'a pas de sens à envoyer. Échec net, jamais un envoi à moitié rempli.
  if (!n.sujet) {
    return { ok: false, raison: 'Sujet manquant pour un e-mail.' }
  }

  const transporteur = transporteurEmailCourant()
  const resultat = await transporteur.envoyer({ destinataire: n.destinataire, sujet: n.sujet, texte: n.texte })
  return resultatCanal(transporteur.nom, resultat)
}
