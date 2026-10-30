import { CanalNotification, TypeNotification } from '@prisma/client'

// Modèles de messages paramétrables (phase 4, lot 5a).
//
// Ni 'use client' ni server-only : l'écran d'aperçu (`/tableau-de-bord/messages`,
// composant client) et le rendu serveur (`src/server/notifications/messages.ts`)
// partagent les mêmes défauts et les mêmes fonctions pures — une seule vérité
// sur ce qu'un {champ} veut dire et sur ce qui tient dans un SMS.
//
// MINIMISATION (RGPD) : aucun champ de fusion ne porte le motif du rendez-vous,
// le nom de l'acte ni le praticien. Un SMS se lit sur un écran verrouillé — voir
// le rappel affiché sur l'écran de paramétrage.
//
// `REPONSE_SMS` n'a AUCUN modèle ici : ses trois variantes (confirmé, trop
// tard, non compris) ne tiennent pas dans un texte unique par (type, canal), et
// les rendre paramétrables aurait exigé soit trois lignes sous une clé absente
// du modèle, soit une contrainte d'unicité différente pour ce seul type. Choix
// le plus simple : ils restent fixes, comme avant ce lot.

export const CHAMPS_FUSION = [
  'prenom',
  'date',
  'heure',
  'cabinet',
  'adresse',
  'lien',
  'espace',
  'consigne_reponse',
] as const

export type ChampFusion = (typeof CHAMPS_FUSION)[number]

const CHAMPS_CONNUS: ReadonlySet<string> = new Set(CHAMPS_FUSION)

/** Type couvert par un modèle paramétrable — tous sauf REPONSE_SMS. */
export type TypeModelisable = Exclude<TypeNotification, typeof TypeNotification.REPONSE_SMS>

export const TYPES_MODELISABLES: readonly TypeModelisable[] = [
  TypeNotification.CONFIRMATION_RESERVATION,
  TypeNotification.MODIFICATION_RENDEZ_VOUS,
  TypeNotification.ANNULATION_PATIENT,
  TypeNotification.ANNULATION_CABINET,
  TypeNotification.RAPPEL_J2,
  TypeNotification.RAPPEL_H3,
  TypeNotification.CRENEAU_LIBERE,
]

/** Libellé français lisible d'un événement, pour l'écran de paramétrage. */
export const LIBELLE_EVENEMENT: Record<TypeModelisable, string> = {
  CONFIRMATION_RESERVATION: 'Confirmation de réservation',
  MODIFICATION_RENDEZ_VOUS: 'Rendez-vous déplacé',
  ANNULATION_PATIENT: 'Annulation par le patient',
  ANNULATION_CABINET: 'Annulation par le cabinet',
  RAPPEL_J2: 'Rappel 2 jours avant',
  RAPPEL_H3: 'Rappel 3 heures avant',
  CRENEAU_LIBERE: 'Créneau libéré (liste d’attente)',
}

export const LIBELLE_CANAL: Record<CanalNotification, string> = {
  SMS: 'SMS',
  EMAIL: 'E-mail',
}

export const LIBELLE_CHAMP: Record<ChampFusion, string> = {
  prenom: 'Prénom du patient',
  date: 'Date du rendez-vous (ex. « vendredi 25 septembre »)',
  heure: 'Heure du rendez-vous (ex. « 14h30 »)',
  cabinet: 'Nom du cabinet',
  adresse: 'Adresse du cabinet (vide si non renseignée)',
  lien: 'Lien de réservation',
  espace: 'Lien vers l’espace patient « Mes rendez-vous » (déplacer, annuler)',
  consigne_reponse: 'Consigne de réponse — calculée automatiquement, pas éditable dans le texte au-delà de sa place',
}

/**
 * Champs de fusion disponibles pour un type d'événement donné.
 *
 * Fermé par type (jamais {motif}, {acte} ni {praticien} — minimisation) et
 * limité à ce que le rendu peut réellement fournir : {lien} n'existe que pour
 * CRENEAU_LIBERE, {consigne_reponse} que pour les deux rappels, {espace} pour
 * ce qui concerne un rendez-vous à venir (19/10).
 */
export const CHAMPS_DISPONIBLES: Record<TypeModelisable, readonly ChampFusion[]> = {
  CONFIRMATION_RESERVATION: ['prenom', 'date', 'heure', 'cabinet', 'adresse', 'espace'],
  MODIFICATION_RENDEZ_VOUS: ['prenom', 'date', 'heure', 'cabinet', 'adresse', 'espace'],
  ANNULATION_PATIENT: ['prenom', 'date', 'heure', 'cabinet', 'adresse'],
  ANNULATION_CABINET: ['prenom', 'date', 'heure', 'cabinet', 'adresse'],
  RAPPEL_J2: ['prenom', 'date', 'heure', 'cabinet', 'consigne_reponse', 'espace'],
  RAPPEL_H3: ['prenom', 'date', 'heure', 'cabinet', 'consigne_reponse', 'espace'],
  CRENEAU_LIBERE: ['date', 'heure', 'cabinet', 'lien'],
}

export type ModeleDefaut = { sujet: string | null; corps: string }

/**
 * Défauts convertis depuis les textes de `messages.ts` (SMS) — inchangés à un
 * détail près : le préfixe générique « Cabinet dentaire » devient {cabinet},
 * qui rend le nom réel du site (« Cabinet de Marie-Galante ») plutôt qu'une
 * étiquette identique partout. Q5 : ANNULATION_CABINET ajoute que le patient
 * sera recontacté ; ANNULATION_PATIENT ne le dit pas, l'annulation étant déjà
 * son geste.
 *
 * 19/10 : le lien vers l'espace patient ({espace}) entre dans la confirmation, le
 * déplacement et les rappels. Les SMS sont raccourcis pour tenir en un seul
 * envoi avec une adresse longue ; sur les rappels, il passe par
 * {consigne_reponse}, qui le remplace par OUI/NON quand la réponse par SMS est
 * branchée.
 *
 * EMAIL (lot 5b, pas encore branché) : défauts écrits par avance, sujet
 * compris. Pas de {consigne_reponse} sur les rappels par e-mail — répondre
 * OUI/NON n'a de sens que par SMS, où le webhook lit la réponse ; l'e-mail dit
 * directement de contacter le cabinet.
 */
const DEFAUTS: Record<TypeModelisable, Record<CanalNotification, ModeleDefaut>> = {
  CONFIRMATION_RESERVATION: {
    SMS: {
      sujet: null,
      corps: '{cabinet} - rendez-vous du {date} à {heure} enregistré. Pour le gérer : {espace}',
    },
    EMAIL: {
      sujet: 'Votre rendez-vous est enregistré',
      corps:
        'Bonjour {prenom},\n\n' +
        'Votre rendez-vous du {date} à {heure} au {cabinet} est enregistré, en attente de confirmation.\n' +
        '{adresse}\n\n' +
        'Pour le déplacer ou l’annuler : {espace}\n\n' +
        'L’équipe du cabinet dentaire.',
    },
  },
  MODIFICATION_RENDEZ_VOUS: {
    SMS: {
      sujet: null,
      corps: '{cabinet} - rendez-vous déplacé au {date} à {heure}. Pour le gérer : {espace}',
    },
    EMAIL: {
      sujet: 'Votre rendez-vous est déplacé',
      corps:
        'Bonjour {prenom},\n\n' +
        'Votre rendez-vous est déplacé au {date} à {heure}, au {cabinet}.\n' +
        '{adresse}\n\n' +
        'Pour le déplacer ou l’annuler : {espace}\n\n' +
        'L’équipe du cabinet dentaire.',
    },
  },
  ANNULATION_PATIENT: {
    SMS: {
      sujet: null,
      corps: '{cabinet} - votre rendez-vous du {date} à {heure} est annulé, comme demandé.',
    },
    EMAIL: {
      sujet: 'Votre rendez-vous est annulé',
      corps:
        'Bonjour {prenom},\n\n' +
        'Votre rendez-vous du {date} à {heure} au {cabinet} est annulé, comme demandé.\n\n' +
        'L’équipe du cabinet dentaire.',
    },
  },
  // Q5 : à la différence d'ANNULATION_PATIENT, le patient n'a rien demandé —
  // le texte précise qu'il sera recontacté.
  ANNULATION_CABINET: {
    SMS: {
      sujet: null,
      corps:
        "{cabinet} - votre rendez-vous du {date} à {heure} est annulé. " +
        "Le cabinet vous recontactera pour convenir d'un nouveau rendez-vous.",
    },
    EMAIL: {
      sujet: 'Votre rendez-vous est annulé',
      corps:
        'Bonjour {prenom},\n\n' +
        'Votre rendez-vous du {date} à {heure} au {cabinet} est annulé. ' +
        'Le cabinet vous recontactera pour convenir d’un nouveau rendez-vous.\n\n' +
        'L’équipe du cabinet dentaire.',
    },
  },
  RAPPEL_J2: {
    SMS: {
      sujet: null,
      corps: '{cabinet} - rappel : rendez-vous le {date} à {heure}. {consigne_reponse}',
    },
    EMAIL: {
      sujet: 'Rappel de votre rendez-vous',
      corps:
        'Bonjour {prenom},\n\n' +
        'Petit rappel : vous avez rendez-vous le {date} à {heure} au {cabinet}.\n' +
        'Pour le déplacer ou l’annuler : {espace}\n\n' +
        'L’équipe du cabinet dentaire.',
    },
  },
  RAPPEL_H3: {
    SMS: {
      sujet: null,
      corps: '{cabinet} - rappel : rendez-vous le {date} à {heure}. {consigne_reponse}',
    },
    EMAIL: {
      sujet: 'Rappel de votre rendez-vous',
      corps:
        'Bonjour {prenom},\n\n' +
        'Petit rappel : vous avez rendez-vous le {date} à {heure} au {cabinet}.\n' +
        'Pour le déplacer ou l’annuler : {espace}\n\n' +
        'L’équipe du cabinet dentaire.',
    },
  },
  CRENEAU_LIBERE: {
    SMS: {
      sujet: null,
      corps: "{cabinet} - une place s'est libérée le {date} à {heure}. Réservez-la : {lien}",
    },
    EMAIL: {
      sujet: 'Une place s’est libérée',
      corps:
        'Bonjour,\n\n' +
        'Une place s’est libérée le {date} à {heure} au {cabinet}. Réservez-la : {lien}\n\n' +
        'L’équipe du cabinet dentaire.',
    },
  },
}

export function modeleParDefaut(type: TypeModelisable, canal: CanalNotification): ModeleDefaut {
  return DEFAUTS[type][canal]
}

/** Valeurs d'exemple LONGUES : servent à la fois à l'aperçu affiché pendant
 *  l'édition et au calcul de segments qui décide de l'avertissement ou du
 *  refus (D-lot5-segments) — les deux doivent s'accorder, jamais un aperçu
 *  optimiste suivi d'un refus surprise à l'enregistrement. */
export const VALEURS_EXEMPLE: Record<ChampFusion, string> = {
  prenom: 'Jean-Baptiste-Alexandre',
  date: 'vendredi 25 septembre',
  heure: '14h30',
  cabinet: 'Cabinet de Marie-Galante',
  adresse: '12 Route de la Marine, 97112 Grand-Bourg',
  lien: 'https://cabinet-dentaire.example/rendez-vous?motif=abcdef12-3456',
  espace: 'https://cabinet-dentaire-antilles.example/mes-rendez-vous',
  // Le plus long des deux variantes réellement rendues (voir messages.ts) :
  // l'aperçu ne doit jamais sous-estimer.
  consigne_reponse: 'Pour le gérer : https://cabinet-dentaire-antilles.example/mes-rendez-vous',
}

function verifierAccolades(texte: string): string | null {
  let ouverte = false
  for (const car of texte) {
    if (car === '{') {
      if (ouverte) return 'Une accolade ouvrante apparaît avant que la précédente ne soit refermée.'
      ouverte = true
    } else if (car === '}') {
      if (!ouverte) return 'Une accolade fermante apparaît sans accolade ouvrante.'
      ouverte = false
    }
  }
  if (ouverte) return 'Une accolade ouverte n’est jamais refermée.'
  return null
}

function extraireChamps(texte: string): string[] {
  return [...texte.matchAll(/\{([a-zA-Z_]*)\}/g)].map((m) => m[1] ?? '')
}

/** Rend un modèle : remplace chaque {champ} connu par sa valeur, et un champ
 *  absent des valeurs fournies par une chaîne vide — jamais « null » affiché
 *  (D24, même principe que `Site.adresse`). Pure. */
export function rendreModele(corps: string, valeurs: Partial<Record<ChampFusion, string>>): string {
  return corps.replace(/\{([a-zA-Z_]*)\}/g, (_correspondance, champ: string) => valeurs[champ as ChampFusion] ?? '')
}

export type SegmentsSms = { segments: number; encodage: 'GSM-7' | 'UCS-2'; longueur: number }

// Jeu de caractères GSM 03.38 (alphabet par défaut + extension). Un caractère
// hors de cet ensemble fait basculer tout le message en UCS-2 (70 / 67), le
// fournisseur SMS n'encodant pas un message moitié GSM-7 moitié UCS-2.
const GSM7_BASE =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
// Caractères étendus : comptent pour 2 septets (échappement).
const GSM7_ETENDU = '^{}\\[~]|€'

function estGsm7(texte: string): boolean {
  for (const car of texte) {
    if (!GSM7_BASE.includes(car) && !GSM7_ETENDU.includes(car)) return false
  }
  return true
}

/** Segments SMS d'un texte déjà rendu (D-lot5-segments, tranchée) :
 *  GSM-7 → 160 en un segment, 153 par segment au-delà ; dès qu'un caractère
 *  hors GSM-7 est présent → UCS-2 → 70 / 67. */
export function compterSegmentsSms(texte: string): SegmentsSms {
  const gsm7 = estGsm7(texte)
  let longueur = 0
  if (gsm7) {
    for (const car of texte) longueur += GSM7_ETENDU.includes(car) ? 2 : 1
  } else {
    longueur = Array.from(texte).length
  }
  const seuilUnSegment = gsm7 ? 160 : 70
  const parSegmentSuite = gsm7 ? 153 : 67
  const segments = longueur <= seuilUnSegment ? 1 : Math.ceil(longueur / parSegmentSuite)
  return { segments, encodage: gsm7 ? 'GSM-7' : 'UCS-2', longueur }
}

export type ResultatValidationModele =
  | { ok: true; avertissement?: string }
  | { ok: false; erreur: string }

/**
 * Valide un modèle avant enregistrement (D-lot5-segments) :
 *   - corps vide → refus
 *   - sujet obligatoire pour EMAIL
 *   - accolade non fermée → refus
 *   - {champ} inconnu OU non disponible pour ce type (ex. {motif}, {lien} sur
 *     une confirmation) → refus, message nommant le champ
 *   - SMS seulement : segments calculés sur l'aperçu à valeurs longues —
 *     plus d'1 segment = avertissement (enregistrable quand même), plus de 2 =
 *     refus.
 *
 * Pure : aucun accès base, aucune horloge.
 */
export function validerModele(
  type: TypeModelisable,
  canal: CanalNotification,
  corps: string,
  sujet: string | null,
): ResultatValidationModele {
  const texteCorps = corps.trim()
  if (texteCorps.length === 0) return { ok: false, erreur: 'Le corps du message ne peut pas être vide.' }

  const texteSujet = sujet?.trim() ?? ''
  if (canal === CanalNotification.EMAIL && texteSujet.length === 0) {
    return { ok: false, erreur: 'Le sujet est obligatoire pour un e-mail.' }
  }

  const disponibles = new Set<string>(CHAMPS_DISPONIBLES[type])

  for (const texte of [texteCorps, texteSujet]) {
    const erreurAccolade = verifierAccolades(texte)
    if (erreurAccolade) return { ok: false, erreur: erreurAccolade }

    for (const champ of extraireChamps(texte)) {
      if (champ.length === 0) return { ok: false, erreur: 'Une accolade vide ({}) ne désigne aucun champ.' }
      if (!CHAMPS_CONNUS.has(champ)) return { ok: false, erreur: `Champ inconnu : {${champ}}.` }
      if (!disponibles.has(champ)) {
        return { ok: false, erreur: `Le champ {${champ}} n’est pas disponible pour ce message.` }
      }
    }
  }

  if (canal === CanalNotification.SMS) {
    const apercu = rendreModele(texteCorps, VALEURS_EXEMPLE)
    const { segments } = compterSegmentsSms(apercu)
    if (segments > 2) {
      return {
        ok: false,
        erreur: `Ce message tiendrait sur ${segments} SMS avec des valeurs réalistes : raccourcissez-le à deux segments au plus.`,
      }
    }
    if (segments > 1) {
      return { ok: true, avertissement: `Ce message tiendra sur ${segments} SMS avec des valeurs réalistes.` }
    }
  }

  return { ok: true }
}
