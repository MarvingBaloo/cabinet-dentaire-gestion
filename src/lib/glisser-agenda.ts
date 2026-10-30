// Calcul pur du glisser-déposer et du redimensionnement de la vue jour (lot 6).
//
// Aucun DOM, aucun React ici : testable en millisecondes, comme le domaine de
// l'agenda (D11). `grille-jour.tsx` et le composant interactif qui l'enveloppe
// importent CES constantes plutôt que d'en redéfinir une copie, pour rester
// alignés sur le même pas — la consigne du lot 6 est explicite là-dessus.
//
// Module neutre, ni `'use client'` ni `server-only` : le composant serveur
// (grille-jour.tsx) et le composant client (grille-jour-glissable.tsx) en ont
// tous les deux besoin.

export const DEBUT_GRILLE = 7 * 60 // 07h00 : les urgences commencent à 7h30
export const FIN_GRILLE = 19 * 60 // 19h00 : la Guadeloupe ferme à 18h
export const PAS = 15 // le pas du glisser et du redimensionnement, en minutes (décision du 2026-10-12, remplace 30)
// La trame affichée de la vue jour reste une ligne par demi-heure : seul le pas du geste a changé.
export const MINUTES_PAR_LIGNE = 30
export const HAUTEUR_LIGNE = 44 // pixels par ligne de la vue jour
export const HAUTEUR_PAS = (HAUTEUR_LIGNE * PAS) / MINUTES_PAR_LIGNE // 22 px par quart d'heure, vue jour
export const HAUTEUR_PAS_SEMAINE = 24 // pixels par quart d'heure, vue semaine (96 px par heure : une carte de 30 min montre ses trois lignes)

export type PlageMinutes = { debut: number; fin: number }

/** Arrondit des minutes au pas le plus proche. */
export function arrondirAuPas(minutes: number, pas: number = PAS): number {
  return Math.round(minutes / pas) * pas
}

/**
 * Un déplacement vertical de `deltaPixels` représente combien de minutes,
 * arrondies au pas le plus proche ? Positif vers le bas (plus tard).
 */
export function deltaMinutesDepuisPixels(
  deltaPixels: number,
  hauteurPas: number = HAUTEUR_PAS,
  pas: number = PAS,
): number {
  return arrondirAuPas((deltaPixels / hauteurPas) * pas, pas)
}

/**
 * Nouvelle position d'un bloc glissé verticalement : conserve la durée,
 * applique le décalage (déjà arrondi au pas), et borne à la fenêtre affichée
 * — jamais avant `bornes.debut`, jamais au point de dépasser `bornes.fin`.
 */
export function deplacerPlage(
  plage: PlageMinutes,
  deltaMinutes: number,
  bornes: PlageMinutes = { debut: DEBUT_GRILLE, fin: FIN_GRILLE },
): PlageMinutes {
  const duree = plage.fin - plage.debut
  const debutMax = bornes.fin - duree
  const debut = Math.max(bornes.debut, Math.min(plage.debut + deltaMinutes, Math.max(bornes.debut, debutMax)))
  return { debut, fin: debut + duree }
}

/**
 * Nouvelle fin d'un bloc étiré par sa poignée basse : le début ne bouge
 * jamais. Bornée à une durée minimale d'un pas, et à la fin de la fenêtre
 * affichée.
 */
export function redimensionnerFin(
  plage: PlageMinutes,
  deltaMinutes: number,
  bornes: PlageMinutes = { debut: DEBUT_GRILLE, fin: FIN_GRILLE },
  dureeMinimale: number = PAS,
): number {
  const fin = plage.fin + deltaMinutes
  return Math.max(plage.debut + dureeMinimale, Math.min(fin, bornes.fin))
}

/**
 * Colonne visée par une position horizontale `offsetX` (relative au bord
 * gauche de la première colonne), sur `nombreColonnes` colonnes de largeur
 * égale `largeurColonne`. `null` hors de la grille : le geste est annulé,
 * pas rattrapé à la colonne la plus proche — déposer hors de la grille n'a
 * pas de sens plutôt qu'un sens approximatif.
 */
export function colonneDepuisX(offsetX: number, largeurColonne: number, nombreColonnes: number): number | null {
  if (largeurColonne <= 0 || nombreColonnes <= 0) return null
  if (offsetX < 0 || offsetX >= largeurColonne * nombreColonnes) return null
  return Math.min(nombreColonnes - 1, Math.floor(offsetX / largeurColonne))
}

/** Un déplacement franchit-il le seuil avant d'être un glisser plutôt qu'un clic ? */
export function depasseLeSeuil(deltaX: number, deltaY: number, seuil = 4): boolean {
  return Math.abs(deltaX) > seuil || Math.abs(deltaY) > seuil
}

/** Position/hauteur en pixels d'une plage horaire, pour l'aperçu fantôme. */
export function pixelsDepuisPlage(
  plage: PlageMinutes,
  debutGrille: number = DEBUT_GRILLE,
  pas: number = PAS,
  hauteurPas: number = HAUTEUR_PAS,
): { top: number; hauteur: number } {
  const top = ((plage.debut - debutGrille) / pas) * hauteurPas
  const hauteur = ((plage.fin - plage.debut) / pas) * hauteurPas
  return { top, hauteur }
}

/**
 * Glisser d'une colonne-jour à une autre (vue semaine) : la plage garde sa
 * durée via `deplacerPlage`, la colonne visée remplace celle d'origine. Hors de
 * la grille (`null`), la colonne d'origine est conservée, comme la vue jour.
 */
export function deplacerEntreJours(
  plage: PlageMinutes,
  colonneOrigine: number,
  deltaMinutes: number,
  colonneVisee: number | null,
  bornes: PlageMinutes = { debut: DEBUT_GRILLE, fin: FIN_GRILLE },
): { colonne: number; debut: number; fin: number } {
  const deplacee = deplacerPlage(plage, deltaMinutes, bornes)
  return { colonne: colonneVisee ?? colonneOrigine, debut: deplacee.debut, fin: deplacee.fin }
}

/**
 * Le déplacement au clavier (24/10), pendant qu'un rendez-vous a le focus : ↑ ↓ d'un quart d'heure, ← → d'une
 * colonne (le fauteuil voisin en vue jour, le jour voisin en vue semaine) ; avec Maj, ↑ ↓ raccourcit ou allonge.
 * Rend la place visée, bornée à la grille, ou `null` si la touche n'est pas une flèche.
 */
export function deplacementClavier(
  touche: string,
  maj: boolean,
  place: { colonne: number; debut: number; fin: number },
  nombreColonnes: number,
): { colonne: number; debut: number; fin: number } | null {
  const plage = { debut: place.debut, fin: place.fin }
  switch (touche) {
    case 'ArrowUp':
    case 'ArrowDown': {
      const delta = touche === 'ArrowUp' ? -PAS : PAS
      if (maj) return { colonne: place.colonne, debut: place.debut, fin: redimensionnerFin(plage, delta) }
      return { colonne: place.colonne, ...deplacerPlage(plage, delta) }
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const colonne = place.colonne + (touche === 'ArrowLeft' ? -1 : 1)
      return { ...place, colonne: Math.max(0, Math.min(nombreColonnes - 1, colonne)) }
    }
    default:
      return null
  }
}

/**
 * Répartit des plages qui se chevauchent en couloirs côte à côte : sans cela,
 * deux rendez-vous simultanés (deux praticiens) s'empilent et se masquent.
 * Rend, dans l'ordre d'entrée, le couloir de chaque plage et le nombre de
 * couloirs de son groupe de plages liées par chevauchement.
 */
export function repartirEnCouloirs(plages: PlageMinutes[]): { couloir: number; couloirs: number }[] {
  const ordre = plages
    .map((_, i) => i)
    .sort((a, b) => plages[a]!.debut - plages[b]!.debut || plages[a]!.fin - plages[b]!.fin)
  const resultat = plages.map(() => ({ couloir: 0, couloirs: 1 }))
  let groupe: number[] = []
  let finGroupe = -Infinity
  let finsCouloirs: number[] = []

  const clore = () => {
    for (const i of groupe) resultat[i]!.couloirs = finsCouloirs.length
    groupe = []
    finsCouloirs = []
  }

  for (const i of ordre) {
    const p = plages[i]!
    if (groupe.length > 0 && p.debut >= finGroupe) clore()
    let couloir = finsCouloirs.findIndex((fin) => fin <= p.debut)
    if (couloir === -1) {
      couloir = finsCouloirs.length
      finsCouloirs.push(p.fin)
    } else {
      finsCouloirs[couloir] = p.fin
    }
    resultat[i]!.couloir = couloir
    groupe.push(i)
    finGroupe = groupe.length === 1 ? p.fin : Math.max(finGroupe, p.fin)
  }
  clore()
  return resultat
}

// ─── Créer au clic sur une case vide (19/10) ───────────────────────────────

/** Une plage de présence telle que la grille la lit : en minutes depuis minuit, jour local. */
export type PresenceGrille = {
  praticienId: string
  siteId: string
  fauteuilId: string
  jour: string
  debut: number
  fin: number
}

/**
 * L'heure visée par un clic à `y` pixels du haut de la colonne : arrondie au
 * pas inférieur (on clique « dans » le quart d'heure), bornée à la grille.
 */
export function minutesDepuisY(
  y: number,
  hauteurPas: number,
  pas: number = PAS,
  bornes: PlageMinutes = { debut: DEBUT_GRILLE, fin: FIN_GRILLE },
): number {
  const m = bornes.debut + Math.floor(y / hauteurPas) * pas
  return Math.min(Math.max(m, bornes.debut), bornes.fin - pas)
}

/**
 * L'adresse du formulaire « Nouveau rendez-vous » pré-rempli pour une case de
 * la grille : jour et heure toujours ; praticien et cabinet quand une présence
 * couvre la case (dans ce fauteuil en vue jour, dans ce cabinet en vue semaine).
 * Sans présence, le cabinet affiché seulement — la secrétaire choisit le reste.
 */
export function lienNouveauRendezVous(p: {
  jour: string
  minutes: number
  presences: PresenceGrille[]
  fauteuilId?: string
  siteId?: string | null
}): string {
  const present = p.presences.find(
    (x) =>
      x.jour === p.jour &&
      x.debut <= p.minutes &&
      p.minutes < x.fin &&
      (!p.fauteuilId || x.fauteuilId === p.fauteuilId) &&
      (!p.siteId || x.siteId === p.siteId),
  )
  const h = String(Math.floor(p.minutes / 60)).padStart(2, '0')
  const m = String(p.minutes % 60).padStart(2, '0')
  const q = new URLSearchParams({ jour: p.jour, heure: `${h}:${m}` })
  const site = present?.siteId ?? p.siteId
  if (site) q.set('site', site)
  if (present) q.set('praticien', present.praticienId)
  return `/tableau-de-bord/agenda/nouveau?${q.toString()}`
}

// ─── Une place est-elle permise ? (glisser-déposer, 23/10) ─────────────────────
//
// Le serveur a le dernier mot (`verifierCreneau`) ; ce calcul ne sert qu'à le dire PENDANT le geste, avec la
// raison, au lieu d'un refus découvert après avoir lâché. Il ne connaît que ce que la grille affiche : présences
// et rendez-vous visibles — un congé ou un rendez-vous d'un praticien décoché reste l'affaire du serveur.

export type PresenceNommee = PresenceGrille & { praticienNom: string; fauteuilNom: string }

export type RendezVousPlace = {
  id: string
  praticienId: string
  fauteuilId: string
  jour: string
  debut: number
  fin: number
  /** Annulé ou absent : le créneau est rendu, il ne gêne personne. */
  libere: boolean
  /** « Marie Dupont », pour dire qui occupe la place. */
  patient: string
}

export type DemandeDepot = {
  id: string
  praticienId: string
  praticienNom: string
  jour: string
  debut: number
  fin: number
  /** Le fauteuil visé (vue jour) ; `null` en vue semaine, où c'est la présence du praticien qui le donne. */
  fauteuilId: string | null
  /** Urgence glissée sur un planning plein, ou rendez-vous hors des horaires : le serveur seul en juge. */
  exception: boolean
}

export type VerdictDepot = { ok: true; fauteuilId: string | null } | { ok: false; raison: string }

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function verdictDepot(d: DemandeDepot, presences: PresenceNommee[], rendezVous: RendezVousPlace[]): VerdictDepot {
  const siennes = presences.filter((p) => p.praticienId === d.praticienId && p.jour === d.jour)
  const couvre = (p: PresenceGrille) => p.debut <= d.debut && d.fin <= p.fin

  if (d.exception) return { ok: true, fauteuilId: d.fauteuilId ?? siennes[0]?.fauteuilId ?? null }

  let fauteuilId: string
  if (d.fauteuilId) {
    const presence = siennes.find((p) => p.fauteuilId === d.fauteuilId && couvre(p))
    if (!presence) {
      const autre = presences.find(
        (p) =>
          p.jour === d.jour &&
          p.fauteuilId === d.fauteuilId &&
          p.praticienId !== d.praticienId &&
          p.debut < d.fin &&
          d.debut < p.fin,
      )
      if (autre) return { ok: false, raison: `${autre.fauteuilNom} : c’est le fauteuil du Dr ${autre.praticienNom} à cette heure.` }
      const ailleurs = siennes.find((p) => p.fauteuilId !== d.fauteuilId)
      if (ailleurs) return { ok: false, raison: `Le Dr ${d.praticienNom} est au ${ailleurs.fauteuilNom} ce jour-là.` }
      return siennes.length
        ? { ok: false, raison: `En dehors des heures de présence du Dr ${d.praticienNom}.` }
        : { ok: false, raison: `Le Dr ${d.praticienNom} n’est pas présent ce jour-là.` }
    }
    fauteuilId = presence.fauteuilId
  } else {
    const presence = siennes.find(couvre)
    if (!presence) {
      return siennes.length
        ? {
            ok: false,
            raison: `En dehors des heures de présence du Dr ${d.praticienNom} (${siennes.map((p) => `${hm(p.debut)}–${hm(p.fin)}`).join(', ')}).`,
          }
        : { ok: false, raison: `Le Dr ${d.praticienNom} n’est pas présent ce jour-là.` }
    }
    fauteuilId = presence.fauteuilId
  }

  const occupant = rendezVous.find(
    (r) =>
      r.id !== d.id &&
      !r.libere &&
      r.jour === d.jour &&
      (r.praticienId === d.praticienId || r.fauteuilId === fauteuilId) &&
      r.debut < d.fin &&
      d.debut < r.fin,
  )
  if (occupant) return { ok: false, raison: `Créneau déjà pris : ${occupant.patient} à ${hm(occupant.debut)}.` }

  return { ok: true, fauteuilId }
}
