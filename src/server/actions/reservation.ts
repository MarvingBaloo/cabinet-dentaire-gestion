'use server'

import { adresseIpClient } from '@/server/http/adresse-ip'
import {
  confirmerReservation,
  demarrerReservation,
} from '@/server/services/reservation-publique'
import {
  confirmerReservationSchema,
  demarrerReservationSchema,
} from '@/server/validation/reservation'

// Server Actions du portail public. Comme pour le personnel, ce sont des Server
// Actions et non des routes API : c'est de là que vient la protection CSRF (D6).
//
// ⚠ Contrairement à toutes les autres, celles-ci ne commencent PAS par
// `exigerContexte` : le patient n'a pas de compte. Ce qui les protège est
// ailleurs — limitation par adresse IP dans le service, code à usage unique
// avant toute écriture.

export type EtatReservation = {
  erreur?: string
  /** Identifiant de la réservation entamée, à rendre avec le code. */
  id?: string
  /** Numéro masqué, pour que le patient sache où le code est parti. */
  masque?: string
  /** Renseigné une fois le rendez-vous écrit. */
  confirme?: { debut: string; fin: string }
  valeurs?: Record<string, string>
}

function lire(donnees: FormData, champ: string): string {
  const v = donnees.get(champ)
  return typeof v === 'string' ? v : ''
}

export async function demarrerReservationAction(
  _precedent: EtatReservation,
  donnees: FormData,
): Promise<EtatReservation> {
  const valeurs = {
    nom: lire(donnees, 'nom'),
    prenom: lire(donnees, 'prenom'),
    telephone: lire(donnees, 'telephone'),
  }

  const saisie = demarrerReservationSchema.safeParse({
    motifId: lire(donnees, 'motifId'),
    praticienId: lire(donnees, 'praticienId'),
    siteId: lire(donnees, 'siteId'),
    debut: lire(donnees, 'debut'),
    ...valeurs,
  })
  if (!saisie.success) {
    return { erreur: saisie.error.issues[0]?.message ?? 'Saisie invalide.', valeurs }
  }

  const r = await demarrerReservation({ ...saisie.data, ipAddress: await adresseIpClient() })

  switch (r.etat) {
    case 'code_envoye':
      return { id: r.id, masque: r.masque }
    case 'trop_de_tentatives':
      return {
        erreur:
          'Trop de réservations entamées pour l’instant. Réessayez dans une heure, ou appelez le cabinet.',
        valeurs,
      }
    case 'creneau_indisponible':
      return { erreur: `Ce créneau n’est plus disponible. ${r.raison}`, valeurs }
    case 'acte_non_pratique':
      return { erreur: 'Ce motif n’est pas proposé avec ce praticien.', valeurs }
    case 'envoi_impossible':
      return {
        erreur:
          'Le SMS n’a pas pu être envoyé. Vérifiez le numéro, ou appelez le cabinet.',
        valeurs,
      }
  }
}

export async function confirmerReservationAction(
  _precedent: EtatReservation,
  donnees: FormData,
): Promise<EtatReservation> {
  const saisie = confirmerReservationSchema.safeParse({
    id: lire(donnees, 'id'),
    code: lire(donnees, 'code'),
  })
  if (!saisie.success) {
    return { id: lire(donnees, 'id'), erreur: 'Le code comporte six chiffres.' }
  }

  const r = await confirmerReservation(saisie.data.id, saisie.data.code, await adresseIpClient())
  const id = saisie.data.id

  switch (r.etat) {
    case 'confirme':
      return { confirme: { debut: r.debut.toISOString(), fin: r.fin.toISOString() } }
    case 'code_invalide':
      return {
        id,
        erreur: `Code incorrect. Il vous reste ${r.restantes} essai${r.restantes > 1 ? 's' : ''}.`,
      }
    case 'code_expire':
      return { erreur: 'Ce code n’est plus valable. Reprenez la réservation depuis le début.' }
    case 'creneau_pris':
      return {
        erreur:
          'Ce créneau vient d’être réservé par quelqu’un d’autre. Choisissez-en un autre.',
      }
    case 'reservation_bloquee':
      return {
        erreur:
          'La réservation en ligne n’est pas disponible pour ce numéro. Merci d’appeler le cabinet.',
      }
  }
}
