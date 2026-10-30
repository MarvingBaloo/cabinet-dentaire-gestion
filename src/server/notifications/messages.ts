import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import { CanalNotification, TypeNotification } from '@prisma/client'

import {
  type ChampFusion,
  type TypeModelisable,
  TYPES_MODELISABLES,
  modeleParDefaut,
  rendreModele,
} from '@/lib/modeles-messages'
import { env } from '@/config/env'
import { heureCabinet, jourEnToutesLettres, jourLocal } from '@/lib/dates'

// Rendu des messages de la file de notifications (phase 4, lot 3, étendu au
// lot 5a) : un seul endroit qui sait transformer « quel événement, quel canal,
// quelles données » en texte final.
//
// LOT 5a : le texte n'est plus figé ici. Il vient de la table `modele_message`
// si le cabinet l'a réglée (`/tableau-de-bord/messages`), sinon du défaut du
// code (`src/lib/modeles-messages.ts`) — jamais l'inverse, le seed n'écrase
// jamais un modèle modifié. `rendreMessage` est donc devenue asynchrone et
// prend le client Prisma (ou de transaction) en premier paramètre : les
// appelants DANS une transaction métier doivent lui passer `tx`, jamais
// `prisma` — sans quoi la lecture du modèle se ferait hors de la transaction
// qui écrit la notification, sans conséquence pratique ici (lecture seule)
// mais contraire à la règle du dépôt (D37 : tout ce qui accompagne une
// mutation métier vit dans sa transaction).
//
// MINIMISATION (RGPD) : aucun champ de fusion ne porte le motif médical ni le
// nom de l'acte — un SMS se lit sur un écran verrouillé. Voir la liste fermée
// de `src/lib/modeles-messages.ts`.

export type MessageRendu = { texte: string; sujet: string | null }

/** Client Prisma ordinaire, ou client d'une transaction en cours — même type
 *  que `ClientNotification` de `file.ts`, redéfini ici pour ne pas faire
 *  dépendre `messages.ts` de `file.ts` (l'inverse existe déjà). */
export type ClientModeles = PrismaClient | Prisma.TransactionClient

export type DonneesRendezVous = {
  debut: Date
  /** Nom du site — {cabinet}. */
  siteNom: string
  /** Patient.prenom, toujours renseigné (champ obligatoire) — {prenom}. */
  prenom: string
  /** Site.adresse, `null` tant que le cabinet ne l'a pas donnée (D24) —
   *  {adresse} rend alors une chaîne vide, jamais « null ». */
  adresse?: string | null
}

// Lot 4 : le texte du rappel dépend de si le webhook de réponse est branché
// (`BREVO_WEBHOOK_SECRET`, voir `planifierRappels`) — inviter à répondre OUI/NON
// n'a de sens que si quelqu'un lit la réponse (D-lot4-J). Calculé par le code
// appelant, jamais par un modèle : {consigne_reponse} rend l'un ou l'autre.
export type DonneesRappel = { debut: Date; siteNom: string; prenom: string; attendReponse: boolean }

export type DonneesCreneauLibere = { debut: Date; siteNom: string; lien: string }

export type RaisonReponseSms = 'confirme' | 'trop_tard' | 'non_compris'
export type DonneesReponseSms = { raison: RaisonReponseSms }

/** L'espace patient, où l'on déplace et annule (19/10) — {espace}. */
const lienEspace = () => `${env.APP_URL}/mes-rendez-vous`

/** Valeur de {consigne_reponse} quand le webhook de réponse n'est pas branché :
 *  le lien vers l'espace patient (avant le 19/10 : « appelez le cabinet »). */
const GERER_EN_LIGNE = () => `Pour le gérer : ${lienEspace()}`

/** Remplace `GERER_EN_LIGNE` sur un rappel quand le webhook de réponse est
 *  configuré — le patient peut répondre directement au SMS. */
const REPONDRE_OUI_NON = 'Répondez OUI pour confirmer, NON pour annuler.'

function valeursRendezVous(d: DonneesRendezVous): Partial<Record<ChampFusion, string>> {
  return {
    prenom: d.prenom,
    date: jourEnToutesLettres(jourLocal(d.debut)),
    heure: heureCabinet(d.debut),
    cabinet: d.siteNom,
    adresse: d.adresse ?? '',
    espace: lienEspace(),
  }
}

function valeursRappel(d: DonneesRappel): Partial<Record<ChampFusion, string>> {
  return {
    prenom: d.prenom,
    date: jourEnToutesLettres(jourLocal(d.debut)),
    heure: heureCabinet(d.debut),
    cabinet: d.siteNom,
    consigne_reponse: d.attendReponse ? REPONDRE_OUI_NON : GERER_EN_LIGNE(),
    espace: lienEspace(),
  }
}

function valeursCreneauLibere(d: DonneesCreneauLibere): Partial<Record<ChampFusion, string>> {
  return {
    date: jourEnToutesLettres(jourLocal(d.debut)),
    heure: heureCabinet(d.debut),
    cabinet: d.siteNom,
    lien: d.lien,
  }
}

async function rendreDepuisModele(
  db: ClientModeles,
  type: TypeModelisable,
  canal: CanalNotification,
  valeurs: Partial<Record<ChampFusion, string>>,
): Promise<MessageRendu> {
  const enBase = await db.modeleMessage.findUnique({
    where: { type_canal: { type, canal } },
    select: { sujet: true, corps: true },
  })
  const modele = enBase ?? modeleParDefaut(type, canal)

  return {
    texte: rendreModele(modele.corps, valeurs),
    sujet: modele.sujet ? rendreModele(modele.sujet, valeurs) : null,
  }
}

/**
 * Rend le message d'un type de notification pour un canal donné.
 *
 * `db` : `prisma` hors transaction, ou le client `tx` d'une transaction en
 * cours — voir le commentaire d'en-tête.
 */
export function rendreMessage(
  db: ClientModeles,
  type:
    | typeof TypeNotification.CONFIRMATION_RESERVATION
    | typeof TypeNotification.MODIFICATION_RENDEZ_VOUS
    | typeof TypeNotification.ANNULATION_PATIENT
    | typeof TypeNotification.ANNULATION_CABINET,
  canal: CanalNotification,
  donnees: DonneesRendezVous,
): Promise<MessageRendu>
export function rendreMessage(
  db: ClientModeles,
  type: typeof TypeNotification.RAPPEL_J2 | typeof TypeNotification.RAPPEL_H3,
  canal: CanalNotification,
  donnees: DonneesRappel,
): Promise<MessageRendu>
export function rendreMessage(
  db: ClientModeles,
  type: typeof TypeNotification.CRENEAU_LIBERE,
  canal: CanalNotification,
  donnees: DonneesCreneauLibere,
): Promise<MessageRendu>
export function rendreMessage(
  db: ClientModeles,
  type: typeof TypeNotification.REPONSE_SMS,
  canal: CanalNotification,
  donnees: DonneesReponseSms,
): Promise<MessageRendu>
export async function rendreMessage(
  db: ClientModeles,
  type: TypeNotification,
  canal: CanalNotification,
  donnees: DonneesRendezVous | DonneesRappel | DonneesCreneauLibere | DonneesReponseSms,
): Promise<MessageRendu> {
  // Seul type qui n'est PAS dans `modele_message` (voir modeles-messages.ts) :
  // ses trois variantes ne tiennent pas dans un texte unique par canal.
  // Textes fixes, jamais paramétrables.
  if (type === TypeNotification.REPONSE_SMS) {
    const { raison } = donnees as DonneesReponseSms
    if (raison === 'confirme') return { texte: 'Rendez-vous confirmé.', sujet: null }
    if (raison === 'trop_tard') {
      return { texte: 'Trop tard pour annuler par SMS, appelez le cabinet.', sujet: null }
    }
    return { texte: 'Réponse non comprise, appelez le cabinet.', sujet: null }
  }

  if (!(TYPES_MODELISABLES as readonly TypeNotification[]).includes(type)) {
    throw new Error(`rendreMessage : ${type} n'est pas un type modélisable.`)
  }
  const typeModelisable = type as TypeModelisable

  switch (typeModelisable) {
    case TypeNotification.CONFIRMATION_RESERVATION:
    case TypeNotification.MODIFICATION_RENDEZ_VOUS:
    case TypeNotification.ANNULATION_PATIENT:
    case TypeNotification.ANNULATION_CABINET:
      return rendreDepuisModele(db, typeModelisable, canal, valeursRendezVous(donnees as DonneesRendezVous))

    case TypeNotification.RAPPEL_J2:
    case TypeNotification.RAPPEL_H3:
      return rendreDepuisModele(db, typeModelisable, canal, valeursRappel(donnees as DonneesRappel))

    case TypeNotification.CRENEAU_LIBERE:
      return rendreDepuisModele(db, typeModelisable, canal, valeursCreneauLibere(donnees as DonneesCreneauLibere))

    default:
      throw new Error(`rendreMessage : ${typeModelisable} sans mapping de champs (à compléter).`)
  }
}
