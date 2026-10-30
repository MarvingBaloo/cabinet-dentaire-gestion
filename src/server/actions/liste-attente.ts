'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { adresseIpClient } from '@/server/http/adresse-ip'
import { NOM_COOKIE_ACCES } from '@/server/services/acces-patient'
import {
  desinscrireListeAttente,
  inscrireListeAttente,
} from '@/server/services/inscription-liste-attente'
import {
  desinscrireListeAttenteSchema,
  inscrireListeAttenteSchema,
} from '@/server/validation/liste-attente'

// Server Actions de la liste d'attente (lot D, D29). Comme le reste du
// portail patient : pas de route API, c'est la Server Action qui porte la
// protection CSRF (D6).

export type EtatInscriptionListeAttente = {
  erreur?: string
  succes?: string
}

export type EtatDesinscriptionListeAttente = {
  erreur?: string
  succes?: string
}

function lire(donnees: FormData, champ: string): string {
  const v = donnees.get(champ)
  return typeof v === 'string' ? v : ''
}

/** Deux écrans revalidés à chaque changement : l'accès patient (liste,
 *  désinscription) et l'écran d'inscription lui-même. */
function rafraichirListeAttente() {
  revalidatePath('/mes-rendez-vous')
  revalidatePath('/rendez-vous/liste-attente')
}

export async function inscrireListeAttenteAction(
  _precedent: EtatInscriptionListeAttente,
  donnees: FormData,
): Promise<EtatInscriptionListeAttente> {
  const jar = await cookies()
  const jeton = jar.get(NOM_COOKIE_ACCES)?.value
  if (!jeton) return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }

  const saisie = inscrireListeAttenteSchema.safeParse({
    motifId: lire(donnees, 'motifId'),
    siteId: lire(donnees, 'siteId'),
    praticienId: lire(donnees, 'praticienId') || undefined,
  })
  if (!saisie.success) return { erreur: 'Motif ou cabinet invalide. Recommencez depuis la page de réservation.' }

  const r = await inscrireListeAttente(jeton, saisie.data, await adresseIpClient(), new Date())

  rafraichirListeAttente()

  switch (r.etat) {
    case 'inscrit':
      return { succes: 'Inscription enregistrée. Un SMS vous préviendra si une place se libère.' }
    case 'fenetre_expiree':
      return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }
    case 'reservation_bloquee':
      return {
        erreur: 'La liste d’attente n’est pas disponible pour ce numéro. Merci d’appeler le cabinet.',
      }
    case 'motif_invalide':
      return { erreur: 'Ce motif n’est pas proposé pour ce cabinet ou ce praticien.' }
  }
}

export async function desinscrireListeAttenteAction(
  _precedent: EtatDesinscriptionListeAttente,
  donnees: FormData,
): Promise<EtatDesinscriptionListeAttente> {
  const jar = await cookies()
  const jeton = jar.get(NOM_COOKIE_ACCES)?.value
  if (!jeton) return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }

  const saisie = desinscrireListeAttenteSchema.safeParse({ id: lire(donnees, 'id') })
  if (!saisie.success) return { erreur: 'Inscription introuvable.' }

  const r = await desinscrireListeAttente(jeton, saisie.data.id, await adresseIpClient())

  rafraichirListeAttente()

  switch (r.etat) {
    case 'desinscrit':
      return { succes: 'Vous êtes désinscrit de la liste d’attente.' }
    case 'fenetre_expiree':
      return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }
    case 'introuvable':
      return { erreur: 'Inscription introuvable.' }
  }
}
