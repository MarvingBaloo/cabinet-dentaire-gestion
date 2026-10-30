import { StatutRendezVous } from '@prisma/client'

import { decalerJour, formatHeureMinutesISO, instantCabinet } from '@/lib/dates'
import { estJourFerie } from '@/lib/jours-feries'

import { type Creneau, couvre } from './agenda'

/**
 * Rendez-vous « actifs » au sens des gardes anti-orphelin de ce fichier :
 * ceux qu'un changement de présence OU une nouvelle indisponibilité pourrait
 * rendre orphelins (Q5). Vit ici — pure donnée, aucun accès base — pour que
 * `src/server/services/presences.ts` (semaine type, exceptions) et
 * `src/server/services/indisponibilites.ts` (congés, fermetures, lot 2)
 * appliquent EXACTEMENT la même définition plutôt que d'en tenir chacun la
 * sienne.
 *
 * ⚠ DIFFÉRENT de `OCCUPE` (`src/server/services/agenda.ts`), qui sert à
 * refuser un double-booking : TERMINE et EN_CAISSE y figurent, parce qu'un
 * rendez-vous déjà passé continue d'occuper son créneau pour l'historique.
 * Ici, la question est inverse — un rendez-vous déjà passé n'a plus besoin
 * d'être couvert par une présence future, changer la présence ne peut plus
 * lui nuire.
 */
export const STATUTS_ACTIFS_POUR_PRESENCE: StatutRendezVous[] = [
  StatutRendezVous.A_CONFIRMER,
  StatutRendezVous.CONFIRME,
  StatutRendezVous.SALLE_ATTENTE,
  StatutRendezVous.AU_FAUTEUIL,
  StatutRendezVous.ANNULATION_DEMANDEE,
]

// Semaine type + exceptions → présence effective, en fonctions pures (D11,
// même principe que `agenda.ts`).
//
// AUCUN accès à la base ici, et c'est le point : la même règle doit produire
// EXACTEMENT le même résultat qu'elle soit rejouée à l'enregistrement d'une
// modification (src/server/services/presences.ts, garde anti-orphelin — Q5)
// ou par le worker qui fait glisser l'horizon d'un jour chaque nuit. Deux
// implémentations, même approchées, finiraient par diverger.

/** 1 = lundi … 7 = dimanche (ISO 8601) — jamais `Date.getUTCDay()`, où 0 = dimanche. */
export function jourSemaineISO(jour: string): number {
  const jsDay = new Date(`${jour}T12:00:00.000Z`).getUTCDay()
  return jsDay === 0 ? 7 : jsDay
}

/** Tous les jours civils de `debut` à `fin` INCLUS, dans l'ordre. */
export function joursDeLHorizon(debut: string, fin: string): string[] {
  const jours: string[] = []
  let courant = debut
  // Comparaison lexicographique valide : les deux bornes sont au format
  // "AAAA-MM-JJ", où l'ordre des caractères suit l'ordre chronologique.
  while (courant <= fin) {
    jours.push(courant)
    courant = decalerJour(courant, 1)
  }
  return jours
}

export type LigneSemaineTypeConnue = {
  jourSemaine: number
  siteId: string
  fauteuilId: string
  heureDebut: number
  heureFin: number
  /** Pause facultative (le midi) : la journée donne alors deux plages. */
  pauseDebut?: number | null
  pauseFin?: number | null
}

export type ExceptionConnue = {
  /** Jour civil "AAAA-MM-JJ". */
  date: string
  type: 'RETRAIT' | 'AJOUT_OU_MODIFICATION'
  /** Nuls pour RETRAIT, renseignés pour AJOUT_OU_MODIFICATION (garanti en base
   *  par `exception_presence_coherente`, prisma/sql/03_agenda_contraintes.sql). */
  siteId: string | null
  fauteuilId: string | null
  heureDebut: number | null
  heureFin: number | null
}

export type PlageVoulue = Creneau & {
  jour: string
  siteId: string
  fauteuilId: string
  heureDebut: number
  heureFin: number
}

/**
 * Les plages de présence que la semaine type et les exceptions IMPLIQUENT sur
 * un horizon donné — ce que `PlageDePresence` devrait contenir si elle était
 * recalculée à l'instant.
 *
 * Une exception REMPLACE la semaine type pour son jour, elle ne s'y ajoute
 * jamais (Q1 — un seul site par jour) : RETRAIT vide le jour, AJOUT_OU_MODIFICATION
 * lui substitue son propre site/fauteuil/heures, y compris un jour que la
 * semaine type laissait vide.
 */
export function plagesVoulues(
  semaineType: LigneSemaineTypeConnue[],
  exceptions: ExceptionConnue[],
  horizon: { debut: string; fin: string },
): PlageVoulue[] {
  const parJourSemaine = new Map(semaineType.map((l) => [l.jourSemaine, l]))
  const exceptionParDate = new Map(exceptions.map((e) => [e.date, e]))

  const voulues: PlageVoulue[] = []

  for (const jour of joursDeLHorizon(horizon.debut, horizon.fin)) {
    const exception = exceptionParDate.get(jour)

    let ligne: {
      siteId: string
      fauteuilId: string
      heureDebut: number
      heureFin: number
      pauseDebut?: number | null
      pauseFin?: number | null
    } | null = null

    if (exception) {
      if (
        exception.type === 'AJOUT_OU_MODIFICATION' &&
        exception.siteId &&
        exception.fauteuilId &&
        exception.heureDebut != null &&
        exception.heureFin != null
      ) {
        ligne = {
          siteId: exception.siteId,
          fauteuilId: exception.fauteuilId,
          heureDebut: exception.heureDebut,
          heureFin: exception.heureFin,
        }
      }
      // RETRAIT (ou AJOUT_OU_MODIFICATION incomplète, qui ne devrait pas
      // exister en base) : `ligne` reste nulle, ce jour est vide.
    } else {
      ligne = parJourSemaine.get(jourSemaineISO(jour)) ?? null
    }

    if (!ligne || ligne.heureFin <= ligne.heureDebut) continue

    // Une pause (le midi, semaine type seulement) coupe la journée en deux
    // plages : rien ne peut être posé entre les deux. Ignorée si elle ne tient
    // pas strictement dans la journée — la base l'interdit déjà
    // (`presence_hebdo_pause_coherente`).
    const { pauseDebut, pauseFin } = ligne
    const morceaux =
      pauseDebut != null && pauseFin != null && ligne.heureDebut < pauseDebut && pauseDebut < pauseFin && pauseFin < ligne.heureFin
        ? [
            [ligne.heureDebut, pauseDebut],
            [pauseFin, ligne.heureFin],
          ]
        : [[ligne.heureDebut, ligne.heureFin]]

    for (const [heureDebut, heureFin] of morceaux as [number, number][]) {
      const debut = instantCabinet(jour, formatHeureMinutesISO(heureDebut))
      const fin = instantCabinet(jour, formatHeureMinutesISO(heureFin))
      // Ne devrait pas arriver : les heures sont déjà bornées à 0-1440 en base
      // (`presence_hebdo_heures_coherentes`, `exception_presence_coherente`) et
      // à la validation Zod. Un jour ignoré plutôt qu'une exception qui romprait
      // toute la génération pour un seul praticien mal configuré.
      if (!debut || !fin) continue
      voulues.push({ jour, siteId: ligne.siteId, fauteuilId: ligne.fauteuilId, heureDebut, heureFin, debut, fin })
    }
  }

  return voulues
}

/**
 * Retire d'un résultat de `plagesVoulues` les plages qui tombent un jour
 * férié SANS exception `AJOUT_OU_MODIFICATION` sur ce jour-là (Q29, Q30 :
 * fermé par défaut, sauf si le praticien a explicitement ouvert ce férié).
 *
 * Fonction SÉPARÉE plutôt que fusionnée dans `plagesVoulues` : celle-ci reste
 * la primitive « semaine type + exceptions », éprouvée par
 * `tests/domaine-presences.test.ts` sur des dates qui incluent le 1er janvier
 * comme lundi ordinaire — la composer avec les fériés ailleurs évite de
 * réécrire ces tests pour une règle qu'ils ne visaient pas.
 *
 * Une exception `RETRAIT` sur un férié ne change rien au résultat : le jour
 * est déjà fermé par défaut, et le restera.
 */
export function retirerJoursFeries(voulues: PlageVoulue[], exceptions: ExceptionConnue[]): PlageVoulue[] {
  const exceptionParDate = new Map(exceptions.map((e) => [e.date, e]))
  return voulues.filter((p) => {
    if (!estJourFerie(p.jour)) return true
    return exceptionParDate.get(p.jour)?.type === 'AJOUT_OU_MODIFICATION'
  })
}

/**
 * `plagesVoulues` composée avec la fermeture par défaut des jours fériés
 * (Q29, Q30) — c'est CETTE fonction que les points d'écriture (service,
 * worker, seed de démonstration) doivent appeler, jamais `plagesVoulues` nue,
 * sous peine de reproduire une présence un jour férié fermé.
 */
export function plagesVouluesAvecFeries(
  semaineType: LigneSemaineTypeConnue[],
  exceptions: ExceptionConnue[],
  horizon: { debut: string; fin: string },
): PlageVoulue[] {
  return retirerJoursFeries(plagesVoulues(semaineType, exceptions, horizon), exceptions)
}

export type RendezVousActifConnu = Creneau & {
  id: string
  fauteuilId: string
}

/**
 * Parmi des rendez-vous actifs, lesquels ne seraient plus couverts par CES
 * plages voulues (Q5 : jamais de rendez-vous orphelin) ?
 *
 * Même fauteuil ET intervalle couvert — exactement le critère qui, dans
 * `verifierCreneau` (agenda.ts), désigne la plage porteuse d'un rendez-vous.
 * Un rendez-vous que plus aucune plage voulue ne couvre ainsi perdrait son
 * praticien ou son fauteuil si le changement était appliqué : il faut le
 * déplacer ou l'annuler d'abord, par le circuit existant (D17).
 */
export function rendezVousOrphelins(
  rendezVous: RendezVousActifConnu[],
  voulues: PlageVoulue[],
): RendezVousActifConnu[] {
  return rendezVous.filter(
    (rdv) => !voulues.some((p) => p.fauteuilId === rdv.fauteuilId && couvre(p, rdv)),
  )
}
