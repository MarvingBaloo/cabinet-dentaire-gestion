import { StatutRendezVous } from '@prisma/client'

// Module neutre, ni serveur ni client, et c'est le point : la grille et la
// liste sont rendues sur le serveur, les boutons de ligne sur le client, et les
// deux nomment les mêmes statuts.
//
// ⚠ Ne pas remettre cette table dans un fichier `'use client'` : importée
// depuis un composant serveur, elle n'y arrive pas telle quelle et les libellés
// disparaissent de l'écran — sans erreur, sans rien dans la console, juste une
// colonne vide.

/** Libellés destinés à l'accueil, pas les noms techniques de l'énumération. */
export const LIBELLE_STATUT: Record<StatutRendezVous, string> = {
  A_CONFIRMER: 'À confirmer',
  CONFIRME: 'Confirmé',
  SALLE_ATTENTE: "En salle d'attente",
  AU_FAUTEUIL: 'Au fauteuil',
  TERMINE: 'Terminé',
  EN_CAISSE: 'En caisse',
  ABSENT: 'Absent',
  ANNULE: 'Annulé',
  // Jamais choisi dans le menu de statut (absent de `PARCOURS`) : on y entre en
  // demandant une annulation, on en sort en la validant ou en la refusant (D17,
  // retournée le 2026-09-23).
  ANNULATION_DEMANDEE: 'Annulation demandée',
}

/**
 * Le parcours du patient, dans l'ordre où il se déroule (Q24).
 *
 * `ANNULE` en fait partie depuis que Q36 est tranchée (2026-09-17) : praticiens,
 * secrétaire et assistantes annulent. Il vient après `ABSENT` parce que ce sont
 * les deux sorties du parcours, pas des étapes : on n'y passe pas, on s'y arrête.
 *
 * ⚠ `ANNULATION_DEMANDEE` n'y figure PAS, à dessein (retournée le 2026-09-23) :
 * ce n'est pas un choix qu'on pose dans le menu, c'est ce que devient une
 * sélection d'`ANNULE` par qui n'est pas le praticien du rendez-vous. L'y
 * ajouter permettrait de le choisir directement, sans demandeur ni statut à
 * restaurer — et court-circuiterait la validation.
 */
export const PARCOURS: StatutRendezVous[] = [
  StatutRendezVous.A_CONFIRMER,
  StatutRendezVous.CONFIRME,
  StatutRendezVous.SALLE_ATTENTE,
  StatutRendezVous.AU_FAUTEUIL,
  StatutRendezVous.TERMINE,
  StatutRendezVous.EN_CAISSE,
  StatutRendezVous.ABSENT,
  StatutRendezVous.ANNULE,
]

/** Un rendez-vous annulé ou non honoré s'efface visuellement sans disparaître. */
export const ESTOMPE: StatutRendezVous[] = [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT]

/**
 * En attente d'une décision sur une demande d'annulation (D17, retournée le
 * 2026-09-23). Ni « estompé » — le rendez-vous reste actif, son créneau occupé
 * — ni manipulable par le menu de statut ordinaire : seules la validation et le
 * refus en sortent.
 */
export const EN_ATTENTE_DECISION: StatutRendezVous[] = [StatutRendezVous.ANNULATION_DEMANDEE]

/**
 * Statuts sur lesquels le glisser-déposer de la grille jour (lot 6) est
 * proposé : seulement tant que le rendez-vous n'a pas commencé à être pris en
 * charge. Restriction purement côté interaction (elle gouverne quand le geste
 * démarre) — `deplacerRendezVous` (le service) n'impose rien de plus que ce
 * qu'il imposait déjà avant le lot 6 : le formulaire « Décaler à » existant
 * continue d'accepter n'importe quel statut, inchangé.
 *
 * `AU_FAUTEUIL`, `TERMINE` et `EN_CAISSE` en sont exclus à dessein : décaler
 * dans le temps un rendez-vous en cours ou déjà soldé n'a pas de sens. `ANNULE`,
 * `ABSENT` (ESTOMPE) et `ANNULATION_DEMANDEE` (EN_ATTENTE_DECISION) le sont
 * déjà pour d'autres raisons, listées ci-dessus.
 */
export const DEPLACABLE_PAR_GLISSER: StatutRendezVous[] = [
  StatutRendezVous.A_CONFIRMER,
  StatutRendezVous.CONFIRME,
  StatutRendezVous.SALLE_ATTENTE,
]

/**
 * Pourquoi un rendez-vous ne se glisse pas, en une phrase (24/10) : au survol, et dans le bandeau quand on
 * essaie quand même. Rien à l'écran ne le disait, et on croyait le glisser-déposer en panne.
 */
export const RAISON_FIGE: Partial<Record<StatutRendezVous, string>> = {
  AU_FAUTEUIL: 'Soin en cours : ce rendez-vous ne se déplace plus.',
  TERMINE: 'Rendez-vous terminé : il ne se déplace plus.',
  EN_CAISSE: 'Rendez-vous passé en caisse : il ne se déplace plus.',
  ABSENT: 'Patient absent : le créneau est déjà libéré.',
  ANNULE: 'Rendez-vous annulé : le créneau est déjà libéré.',
  ANNULATION_DEMANDEE: 'Annulation demandée : le praticien doit d’abord la valider ou la refuser.',
}

/** Teinte de la pastille de chaque statut, celle des maquettes du 13/10. */
export const TEINTE_STATUT: Record<StatutRendezVous, string> = {
  A_CONFIRMER: 'bg-etat-alerte-fond text-etat-alerte',
  CONFIRME: 'bg-primary/10 text-marine',
  SALLE_ATTENTE: 'bg-etat-succes-fond text-etat-succes',
  AU_FAUTEUIL: 'bg-primary/10 text-primary',
  TERMINE: 'bg-secondary text-muted-foreground',
  EN_CAISSE: 'bg-secondary text-muted-foreground',
  ABSENT: 'bg-etat-erreur-fond text-etat-erreur',
  ANNULE: 'bg-secondary text-muted-foreground',
  ANNULATION_DEMANDEE: 'bg-etat-erreur-fond text-etat-erreur',
}

/** Rendez-vous déjà honoré : il s'estompe dans la grille, sans être barré. */
export const PASSE: StatutRendezVous[] = [StatutRendezVous.TERMINE, StatutRendezVous.EN_CAISSE]
