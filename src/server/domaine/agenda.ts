import { StatutRendezVous, TypeIndisponibilite } from '@prisma/client'

import { jourLocal } from '@/lib/dates'

// Règles d'agenda du cabinet, en fonctions pures (D11).
//
// AUCUN accès à la base ici, et c'est le point : trois chemins écriront des
// rendez-vous — l'agenda interne, le portail public et la resynchronisation hors
// ligne. Une règle posée dans un écran n'existe que sur celui-là. Une règle
// posée ici s'éprouve en millisecondes, sans base, et se rejoue à l'identique
// sur les trois.
//
// Le moteur tient sa part en parallèle : contraintes d'exclusion et trigger dans
// prisma/sql/03_agenda_contraintes.sql. La redite est voulue. La base est le
// dernier rempart et rend des erreurs illisibles pour un humain ; ce fichier
// rend des refus explicables, avant d'écrire.

export type Creneau = { debut: Date; fin: Date }

export type PresenceConnue = Creneau & {
  praticienId: string
  siteId: string
  fauteuilId: string
}

export type IndisponibiliteConnue = Creneau & {
  type: TypeIndisponibilite
  praticienId: string | null
  siteId: string | null
}

export type RendezVousConnu = Creneau & {
  id: string
  praticienId: string
  fauteuilId: string
  /** Un rendez-vous annulé ou non honoré libère son créneau. */
  compteDansLOccupation: boolean
}

export type DemandeCreneau = Creneau & {
  praticienId: string
  siteId: string
  motifEstUrgence: boolean
  surbooking: boolean
  /**
   * Rendez-vous posé par le praticien hors de ses horaires (Q23) : avant ou après sa présence, le jour où il
   * reçoit dans ce cabinet, sur le fauteuil de sa journée. Un jour où il n'y est pas, le refus demeure.
   */
  horsHoraire?: boolean
  /** Ignoré lors d'un déplacement : un rendez-vous ne se chevauche pas lui-même. */
  rendezVousId?: string
  /**
   * Fauteuil visé, s'il est explicitement demandé (lot 6, glisser-déposer vers
   * une autre colonne). Le fauteuil reste déduit de la présence du praticien
   * (voir `verifierCreneau` plus bas) — ce champ ne le CHOISIT pas, il permet
   * seulement de refuser proprement quand la colonne visée ne correspond pas
   * à la plage qui couvre ce créneau, plutôt que de déplacer silencieusement
   * le rendez-vous ailleurs que là où on l'a déposé.
   */
  fauteuilSouhaite?: string
}

export type Violation =
  | { code: 'FIN_AVANT_DEBUT' }
  | { code: 'PRATICIEN_ABSENT'; siteId: string }
  | { code: 'DEBORDE_PRESENCE' }
  | { code: 'CHEVAUCHEMENT_FAUTEUIL'; rendezVousId: string }
  | { code: 'CHEVAUCHEMENT_PRATICIEN'; rendezVousId: string }
  | { code: 'INDISPONIBLE'; type: TypeIndisponibilite }
  | { code: 'CRENEAU_RESERVE_URGENCE' }
  | { code: 'FAUTEUIL_INDISPONIBLE' }

export type Verdict =
  | { ok: true; fauteuilId: string }
  | { ok: false; violations: Violation[] }

/** Deux intervalles se chevauchent-ils ? Bornes `[)` : 9h-9h30 et 9h30-10h non. */
export function seChevauchent(a: Creneau, b: Creneau): boolean {
  return a.debut < b.fin && a.fin > b.debut
}

/** `contenant` couvre-t-il entièrement `contenu` ? */
export function couvre(contenant: Creneau, contenu: Creneau): boolean {
  return contenant.debut <= contenu.debut && contenant.fin >= contenu.fin
}

export function calculerFin(debut: Date, dureeMinutes: number): Date {
  return new Date(debut.getTime() + dureeMinutes * 60_000)
}

/**
 * Le rendez-vous demandé est-il posable ?
 *
 * Rend TOUTES les violations plutôt que la première : à l'accueil, apprendre
 * qu'un créneau est pris puis, après correction, qu'il tombe un jour férié, fait
 * reprendre la saisie deux fois. Le domaine dit tout ce qui cloche d'un coup.
 *
 * En cas de succès, rend le `fauteuilId` : il n'est jamais choisi mais déduit de
 * la présence du praticien — on prend rendez-vous avec un praticien, qui a son
 * fauteuil.
 */
export function verifierCreneau(
  demande: DemandeCreneau,
  connu: {
    presences: PresenceConnue[]
    indisponibilites: IndisponibiliteConnue[]
    rendezVous: RendezVousConnu[]
  },
): Verdict {
  const violations: Violation[] = []

  if (demande.fin <= demande.debut) {
    // Inutile d'aller plus loin : toute comparaison d'intervalle serait fausse.
    return { ok: false, violations: [{ code: 'FIN_AVANT_DEBUT' }] }
  }

  // ── Présence du praticien ──
  // Le fauteuil en découle, d'où la recherche d'une plage qui COUVRE le
  // rendez-vous. Une plage qui le chevauche seulement laisserait le patient
  // seul au fauteuil après le départ du praticien.
  const plagesDuJour = connu.presences.filter(
    (p) => p.praticienId === demande.praticienId && p.siteId === demande.siteId,
  )
  // Q23 : hors des horaires, la plage de la journée dans ce cabinet porte le rendez-vous (son fauteuil),
  // sans avoir à le couvrir. Elle n'existait jusqu'ici que comme case à cocher, sans effet (21/10).
  const plagePorteuse =
    plagesDuJour.find((p) => couvre(p, demande)) ??
    (demande.horsHoraire ? plagesDuJour.find((p) => jourLocal(p.debut) === jourLocal(demande.debut)) : undefined)

  if (!plagePorteuse) {
    const chevauche = plagesDuJour.some((p) => seChevauchent(p, demande))
    // Deux refus distincts : « il n'est pas là » et « il est là mais pas assez
    // longtemps » n'appellent pas la même correction à l'accueil.
    violations.push(
      chevauche ? { code: 'DEBORDE_PRESENCE' } : { code: 'PRATICIEN_ABSENT', siteId: demande.siteId },
    )
  } else if (demande.fauteuilSouhaite && plagePorteuse.fauteuilId !== demande.fauteuilSouhaite) {
    // Le praticien est bien présent sur ce créneau, mais pas au fauteuil visé
    // (lot 6 : glisser-déposer vers une autre colonne). Le fauteuil reste
    // déduit de sa présence, jamais choisi (commentaire de `verifierCreneau`
    // ci-dessus) : on refuse proprement plutôt que de le poser silencieusement
    // dans la colonne d'origine.
    violations.push({ code: 'FAUTEUIL_INDISPONIBLE' })
  }

  // ── Indisponibilités ──
  for (const indispo of connu.indisponibilites) {
    if (!seChevauchent(indispo, demande)) continue

    const viseLePraticien = indispo.praticienId === demande.praticienId
    const viseLeSite = indispo.siteId === demande.siteId
    // Une indisponibilité sans praticien ni site ne devrait pas exister — une
    // contrainte de base l'interdit — mais on ne lui fait pas confiance ici.
    if (!viseLePraticien && !viseLeSite) continue

    if (indispo.type === TypeIndisponibilite.RESERVE_URGENCE) {
      // Ce créneau n'est pas fermé : il est gardé. Seule une urgence y entre.
      if (!demande.motifEstUrgence) violations.push({ code: 'CRENEAU_RESERVE_URGENCE' })
      continue
    }

    violations.push({ code: 'INDISPONIBLE', type: indispo.type })
  }

  // ── Chevauchements ──
  // Le surbooking en dispense : c'est l'urgence que le praticien glisse par
  // dessus un planning plein, seule exception admise, et elle est tracée.
  if (!demande.surbooking) {
    const fauteuilId = plagePorteuse?.fauteuilId
    for (const rdv of connu.rendezVous) {
      if (!rdv.compteDansLOccupation) continue
      if (rdv.id === demande.rendezVousId) continue
      if (!seChevauchent(rdv, demande)) continue

      if (fauteuilId && rdv.fauteuilId === fauteuilId) {
        violations.push({ code: 'CHEVAUCHEMENT_FAUTEUIL', rendezVousId: rdv.id })
      }
      if (rdv.praticienId === demande.praticienId) {
        violations.push({ code: 'CHEVAUCHEMENT_PRATICIEN', rendezVousId: rdv.id })
      }
    }
  }

  if (violations.length > 0) return { ok: false, violations }

  // `plagePorteuse` est forcément défini ici : son absence aurait produit une
  // violation, et on ne parvient à cette ligne qu'avec la liste vide.
  return { ok: true, fauteuilId: plagePorteuse!.fauteuilId }
}

/** Rendus lisibles pour l'accueil. Le domaine refuse ; l'écran explique. */
export const LIBELLES_VIOLATION: Record<Violation['code'], string> = {
  FIN_AVANT_DEBUT: 'La fin du rendez-vous précède son début.',
  PRATICIEN_ABSENT: 'Le praticien n’est pas présent sur ce site à cette date.',
  DEBORDE_PRESENCE: 'Le rendez-vous dépasse les heures de présence du praticien.',
  CHEVAUCHEMENT_FAUTEUIL: 'Le fauteuil est déjà occupé sur ce créneau.',
  CHEVAUCHEMENT_PRATICIEN: 'Le praticien a déjà un rendez-vous sur ce créneau.',
  INDISPONIBLE: 'Le cabinet est fermé ou le praticien indisponible sur ce créneau.',
  CRENEAU_RESERVE_URGENCE: 'Ce créneau est réservé aux urgences.',
  FAUTEUIL_INDISPONIBLE: 'Le praticien n’est pas à ce fauteuil sur ce créneau.',
}

export function expliquer(violations: Violation[]): string {
  return violations.map((v) => LIBELLES_VIOLATION[v.code]).join(' ')
}

// ── Recherche des créneaux libres ──────────────────────────────────────────
//
// Le portail public a besoin de l'inverse de `verifierCreneau` : non pas « ce
// créneau-là est-il possible ? » mais « qu'est-ce qui reste ? ».
//
// La recherche s'appuie sur `verifierCreneau` plutôt que de refaire le calcul.
// C'est délibéré : si les deux divergeaient, le portail proposerait des créneaux
// que l'enregistrement refuserait ensuite — le patient choisirait 9h20 et se
// verrait répondre non. Une seule règle, deux usages.

export type DemandeCreneauxLibres = {
  praticienId: string
  siteId: string
  /** Durée de l'acte pour CE praticien (D14), pas une durée générique. */
  dureeMinutes: number
  motifEstUrgence: boolean
  /** Fenêtre de recherche. Le début sert aussi à ne rien proposer dans le passé. */
  debut: Date
  fin: Date
  /**
   * Granularité des propositions, en minutes.
   *
   * Ne borne PAS les rendez-vous existants : la secrétaire pose 9h20 si elle
   * veut (Q22). Ne borne que ce qu'on propose à un patient, pour lui éviter une
   * liste de départs à la minute près.
   */
  pasMinutes: number
}

/**
 * Les créneaux où ce praticien peut recevoir, sur cette fenêtre.
 *
 * Les propositions s'alignent sur le début de chaque plage de présence : un
 * praticien qui commence à 7h30 se voit proposer 7h30, 7h45, 8h00… et non 7h00,
 * qui n'existerait pas.
 *
 * La liste peut être longue — deux mois d'ouverture, c'est l'ordre du millier.
 * C'est à l'appelant de choisir sa fenêtre, pas à cette fonction de tronquer en
 * silence : une liste amputée sans le dire ferait croire à un agenda plein.
 */
export function creneauxLibres(
  demande: DemandeCreneauxLibres,
  connu: {
    presences: PresenceConnue[]
    indisponibilites: IndisponibiliteConnue[]
    rendezVous: RendezVousConnu[]
  },
): Creneau[] {
  if (demande.pasMinutes <= 0 || demande.dureeMinutes <= 0) return []
  if (demande.fin <= demande.debut) return []

  const pasMs = demande.pasMinutes * 60_000
  const libres: Creneau[] = []

  const plages = connu.presences.filter(
    (p) => p.praticienId === demande.praticienId && p.siteId === demande.siteId,
  )

  for (const plage of plages) {
    // Départ : le début de la plage, avancé jusqu'à la fenêtre demandée en
    // gardant l'alignement sur le pas. Sinon une recherche lancée à 9h07
    // proposerait 9h07, 9h22, 9h37 — des horaires que personne n'annonce.
    let t = plage.debut.getTime()
    if (demande.debut.getTime() > t) {
      const retard = demande.debut.getTime() - t
      t += Math.ceil(retard / pasMs) * pasMs
    }

    const borne = Math.min(plage.fin.getTime(), demande.fin.getTime())

    for (; t + demande.dureeMinutes * 60_000 <= borne; t += pasMs) {
      const debut = new Date(t)
      const candidat = {
        praticienId: demande.praticienId,
        siteId: demande.siteId,
        debut,
        fin: calculerFin(debut, demande.dureeMinutes),
        motifEstUrgence: demande.motifEstUrgence,
        // Jamais de surbooking dans une proposition : le surbooking est une
        // urgence que le praticien glisse lui-même par-dessus un planning
        // plein (Q19), pas quelque chose qu'on offre à un patient.
        surbooking: false,
      }

      if (verifierCreneau(candidat, connu).ok) {
        libres.push({ debut: candidat.debut, fin: candidat.fin })
      }
    }
  }

  // Deux praticiens peuvent tenir deux plages le même jour ; les plages ne sont
  // pas garanties ordonnées en entrée.
  return libres.sort((a, b) => a.debut.getTime() - b.debut.getTime())
}

// ─── Manquements du patient (Q27) ───

/**
 * Trois rendez-vous annulés ou non honorés et la réservation en ligne se ferme,
 * jusqu'à déblocage par un administrateur.
 *
 * ⚠ Le délai n'entre PAS dans le compte. Le cabinet a écrit « 3 rendez-vous
 * annulés ou non honorés » sans distinguer l'annulation de la veille de celle
 * faite huit jours avant. C'est leur règle, appliquée telle quelle : l'adoucir
 * ici reviendrait à leur en inventer une autre.
 */
export const SEUIL_MANQUEMENTS = 3

/** Qui est à l'origine du changement de statut. */
export type AuteurStatut = 'patient' | 'cabinet'

/**
 * Ce rendez-vous doit-il coûter un manquement à son patient ?
 *
 * `ABSENT` compte toujours : c'est le sens même du statut, quelle que soit la
 * personne qui le saisit — la secrétaire clique, mais c'est le patient qui n'est
 * pas venu.
 *
 * `ANNULE` dépend de l'auteur. Le patient qui annule depuis le portail compte ;
 * le cabinet qui annule pour lui ne compte pas. Sans cette distinction, un
 * praticien souffrant qui fait annuler sa journée bloquerait d'un coup les
 * patients qui en étaient déjà à deux (Q5).
 */
export function compteUnManquement(
  statut: StatutRendezVous,
  auteur: AuteurStatut,
): boolean {
  if (statut === StatutRendezVous.ABSENT) return true
  if (statut === StatutRendezVous.ANNULE) return auteur === 'patient'
  return false
}

/** La réservation en ligne est-elle fermée à ce compteur ? */
export function reservationFermee(manquements: number): boolean {
  return manquements >= SEUIL_MANQUEMENTS
}

// ─── Annulation en ligne par le patient (Q28) ─────────────────────────────────

/**
 * Le patient annule lui-même jusqu'à 24 heures avant son rendez-vous.
 *
 * En deçà, l'écran ne lui propose plus rien et l'invite à appeler le cabinet :
 * le créneau est trop proche pour être replacé sans qu'on en parle. C'est la
 * réponse du cabinet à Q28, reprise telle quelle.
 */
export const DELAI_ANNULATION_HEURES = 24

/**
 * L'annulation en ligne est-elle encore ouverte pour ce rendez-vous ?
 *
 * `maintenant` est un paramètre et non `new Date()` : une règle qui lit
 * l'horloge ne se teste qu'en attendant, et un écran qui l'appellerait pendant
 * son rendu deviendrait impur.
 */
export function annulationOuverte(debut: Date, maintenant: Date): boolean {
  const heuresRestantes = (debut.getTime() - maintenant.getTime()) / 3_600_000
  return heuresRestantes >= DELAI_ANNULATION_HEURES
}
