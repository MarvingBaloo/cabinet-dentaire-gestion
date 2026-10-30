'use server'

import { z } from 'zod'

import { modeleDisponible } from '@/server/assistant/modele'
import {
  LONGUEUR_MAX_MESSAGE,
  type VueConversation,
  confirmerProposition,
  envoyerMessage,
  lireConversation,
  proposerSuivi,
  reserverProposition,
  transmettreDemande,
} from '@/server/assistant/urgences'
import { adresseIpClient } from '@/server/http/adresse-ip'
import { telephoneSaisi } from '@/server/validation/telephone'

// Server Actions de l'assistant des urgences (D77), sur le site public. Comme la réservation en ligne : pas de
// compte, donc pas d'`exigerContexte` ; ce qui protège est dans le service — limites par adresse et par jour,
// code SMS avant toute écriture dans l'agenda.

export type EtatAssistant = { vue?: VueConversation; erreur?: string }

const messageSchema = z.object({
  conversationId: z.uuid().nullable(),
  texte: z.string().trim().min(1, 'Écrivez votre message.').max(LONGUEUR_MAX_MESSAGE, 'Message trop long.'),
})

export async function envoyerMessageAssistantAction(conversationId: string | null, texte: string): Promise<EtatAssistant> {
  const saisie = messageSchema.safeParse({ conversationId, texte })
  if (!saisie.success) return { erreur: saisie.error.issues[0]?.message ?? 'Message invalide.' }

  const r = await envoyerMessage(await modeleDisponible(), { ...saisie.data, ipAddress: await adresseIpClient() })
  switch (r.etat) {
    case 'ok':
      return { vue: r.vue }
    case 'trop_de_messages':
      return { erreur: 'La conversation est trop longue. Appelez le cabinet, ou recommencez une nouvelle conversation.' }
    case 'trop_de_conversations':
      return { erreur: 'L’assistant est très demandé. Réessayez dans une heure, ou appelez le cabinet. En cas d’urgence vitale : le 15.' }
    case 'introuvable':
      return { erreur: 'Cette conversation n’existe plus. Recommencez-en une nouvelle.' }
    case 'indisponible':
      return { erreur: 'L’assistant ne répond pas pour l’instant. Appelez le cabinet. En cas d’urgence vitale : le 15.' }
  }
}

const reserverSchema = z.object({
  conversationId: z.uuid(),
  index: z.number().int().min(0).max(5),
  prenom: z.string().trim().min(1, 'Votre prénom.').max(100),
  nom: z.string().trim().min(1, 'Votre nom.').max(100),
  telephone: telephoneSaisi,
})

export type EtatReservationAssistant = { reservationId?: string; masque?: string; erreur?: string; confirme?: boolean; vue?: VueConversation }

export async function reserverDepuisAssistantAction(demande: z.input<typeof reserverSchema>): Promise<EtatReservationAssistant> {
  const saisie = reserverSchema.safeParse(demande)
  if (!saisie.success) return { erreur: saisie.error.issues[0]?.message ?? 'Saisie invalide.' }

  const r = await reserverProposition({ ...saisie.data, ipAddress: await adresseIpClient() })
  switch (r.etat) {
    case 'code_envoye':
      return { reservationId: r.id, masque: r.masque }
    case 'trop_de_tentatives':
      return { erreur: 'Trop de réservations entamées pour l’instant. Réessayez dans une heure, ou appelez le cabinet.' }
    case 'creneau_indisponible':
    case 'introuvable':
      return { erreur: 'Ce créneau n’est plus libre. Choisissez-en un autre, ou appelez le cabinet.' }
    case 'acte_non_pratique':
      return { erreur: 'Les urgences ne se réservent pas en ligne pour l’instant. Appelez le cabinet.' }
    case 'envoi_impossible':
      return { erreur: 'Le SMS n’a pas pu être envoyé. Vérifiez le numéro, ou appelez le cabinet.' }
  }
}

const confirmerSchema = z.object({
  conversationId: z.uuid(),
  reservationId: z.uuid(),
  code: z.string().trim().regex(/^\d{6}$/, 'Le code comporte six chiffres.'),
})

export async function confirmerDepuisAssistantAction(demande: z.input<typeof confirmerSchema>): Promise<EtatReservationAssistant> {
  const saisie = confirmerSchema.safeParse(demande)
  if (!saisie.success) return { erreur: saisie.error.issues[0]?.message ?? 'Saisie invalide.' }

  const r = await confirmerProposition({ ...saisie.data, ipAddress: await adresseIpClient() })
  switch (r.etat) {
    case 'confirme': {
      const vue = await lireConversation(saisie.data.conversationId)
      return { confirme: true, ...(vue ? { vue } : {}) }
    }
    case 'code_invalide':
      return { erreur: `Code incorrect. Il vous reste ${r.restantes} essai${r.restantes > 1 ? 's' : ''}.` }
    case 'code_expire':
    case 'introuvable':
      return { erreur: 'Ce code n’est plus valable. Choisissez à nouveau votre créneau.' }
    case 'creneau_pris':
      return { erreur: 'Ce créneau vient d’être pris. Choisissez-en un autre.' }
    case 'reservation_bloquee':
      return { erreur: 'La réservation en ligne n’est pas disponible pour ce numéro. Merci d’appeler le cabinet.' }
  }
}

/** Urgence vitale : après l'hôpital, trois rendez-vous de suivi au cabinet (D79). */
export async function proposerSuiviAction(conversationId: string): Promise<EtatAssistant> {
  if (!z.uuid().safeParse(conversationId).success) return { erreur: 'Conversation introuvable.' }
  const vue = await proposerSuivi(conversationId)
  return vue ? { vue } : { erreur: 'Cette conversation ne permet pas de rendez-vous de suivi.' }
}

const demandeSchema = z.object({
  conversationId: z.uuid(),
  prenom: z.string().trim().min(1, 'Votre prénom.').max(100),
  nom: z.string().trim().min(1, 'Votre nom.').max(100),
  telephone: telephoneSaisi,
})

/** Rien de libre dans le délai : les coordonnées partent au praticien, le cabinet rappelle (D79). */
export async function transmettreDemandeAction(demande: z.input<typeof demandeSchema>): Promise<EtatAssistant> {
  const saisie = demandeSchema.safeParse(demande)
  if (!saisie.success) return { erreur: saisie.error.issues[0]?.message ?? 'Saisie invalide.' }
  const vue = await transmettreDemande(saisie.data)
  return vue ? { vue } : { erreur: 'Cette demande ne peut plus être transmise. Appelez le cabinet.' }
}
