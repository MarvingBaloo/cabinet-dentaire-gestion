import 'server-only'

import { StatutRendezVous } from '@prisma/client'

import { type Creneau, creneauxLibres } from '@/server/domaine/agenda'
import { prisma } from '@/server/db/client'

// Les créneaux proposés au patient sur le portail.
//
// ⚠ Lire le README de ce dossier. En particulier : un créneau occupé et un
// créneau fermé se ressemblent vus d'ici — ils sont absents, et rien ne dit
// lequel des deux. C'est voulu : la liste des créneaux libres ne doit pas
// laisser déduire l'agenda du cabinet.

/**
 * Profondeur d'ouverture du portail : deux mois (Q3).
 *
 * Exportée : le déplacement en ligne (`src/server/services/acces-patient.ts`,
 * D28) revérifie le même horizon à l'écriture — une seconde constante aurait
 * fini par diverger de celle-ci.
 */
export const HORIZON_JOURS = 62

/** Granularité des propositions. Ne borne pas ce que la secrétaire pose à la main. */
const PAS_MINUTES = 15

/**
 * Statuts qui occupent réellement un créneau. Annulé et absent le libèrent.
 *
 * `ANNULATION_DEMANDEE` y figure : une demande d'annulation de l'accueil, en
 * attente du praticien, ne libère rien tant qu'elle n'est pas validée (D17,
 * retournée le 2026-09-23) — sans quoi le portail proposerait un créneau que le
 * rendez-vous en attente occupe encore.
 */
const OCCUPE: StatutRendezVous[] = [
  StatutRendezVous.A_CONFIRMER,
  StatutRendezVous.CONFIRME,
  StatutRendezVous.SALLE_ATTENTE,
  StatutRendezVous.AU_FAUTEUIL,
  StatutRendezVous.TERMINE,
  StatutRendezVous.EN_CAISSE,
  StatutRendezVous.ANNULATION_DEMANDEE,
]

export type CreneauPropose = Creneau & {
  praticienId: string
  siteId: string
}

export type DemandeDisponibilites = {
  /** L'acte, d'où viennent la durée et le caractère d'urgence. */
  motifId: string
  /** Facultatifs : le patient peut chercher partout, ou viser un site ou un praticien. */
  siteId?: string
  praticienId?: string
  /**
   * Facultatifs eux aussi. Sans eux, la fenêtre va de maintenant à l'horizon
   * d'ouverture — ce qui est le cas courant, et évite à l'appelant de lire
   * l'heure. Une page qui la lirait pendant son rendu ne serait plus pure.
   */
  debut?: Date
  fin?: Date
}

/**
 * Les créneaux où un patient peut se poser, pour cet acte.
 *
 * La fenêtre demandée est bornée des deux côtés, sans le dire à l'appelant :
 * jamais dans le passé, jamais au-delà de l'horizon d'ouverture. Un appelant
 * public ne doit pas pouvoir demander l'agenda de l'an prochain, ni faire
 * travailler le serveur sur dix ans pour le plaisir.
 */
export async function creneauxDisponibles(
  demande: DemandeDisponibilites,
): Promise<CreneauPropose[]> {
  const maintenant = new Date()
  const horizon = new Date(maintenant.getTime() + HORIZON_JOURS * 86_400_000)

  const debut = new Date(Math.max(demande.debut?.getTime() ?? 0, maintenant.getTime()))
  const fin = new Date(Math.min(demande.fin?.getTime() ?? Infinity, horizon.getTime()))
  if (fin <= debut) return []

  const motif = await prisma.motifConsultation.findFirst({
    where: { id: demande.motifId, actif: true },
    select: { id: true, estUrgence: true },
  })
  if (!motif) return []

  // La durée appartient au couple praticien × motif (D14) : un praticien qui ne
  // pratique pas l'acte n'a pas de ligne, donc ne propose rien. C'est une
  // réponse, pas une panne.
  const praticiens = await prisma.praticienMotif.findMany({
    where: {
      motifId: motif.id,
      praticien: { actif: true },
      ...(demande.praticienId ? { praticienId: demande.praticienId } : {}),
    },
    select: { praticienId: true, dureeMinutes: true },
  })
  if (praticiens.length === 0) return []

  const praticienIds = praticiens.map((p) => p.praticienId)

  // Une seule requête pour tout le monde : autant d'allers-retours que de
  // praticiens rendrait la page lente sans rien apporter.
  const [presences, rendezVous, indisponibilites] = await Promise.all([
    prisma.plageDePresence.findMany({
      where: {
        praticienId: { in: praticienIds },
        ...(demande.siteId ? { siteId: demande.siteId } : {}),
        // Aucun créneau dans un cabinet décoché (D74), même demandé par son identifiant.
        site: { actif: true },
        debut: { lt: fin },
        fin: { gt: debut },
      },
      select: { praticienId: true, siteId: true, fauteuilId: true, debut: true, fin: true },
    }),
    prisma.rendezVous.findMany({
      where: {
        ...(demande.siteId ? { siteId: demande.siteId } : {}),
        debut: { lt: fin },
        fin: { gt: debut },
      },
      // ⚠ Rien qui identifie le patient, ni le motif : seulement de quoi savoir
      // qu'un fauteuil est pris. Ces lignes ne quittent pas le serveur.
      select: {
        id: true,
        praticienId: true,
        fauteuilId: true,
        debut: true,
        fin: true,
        statut: true,
        surbooking: true,
      },
    }),
    prisma.indisponibilite.findMany({
      where: { debut: { lt: fin }, fin: { gt: debut } },
      select: { type: true, praticienId: true, siteId: true, debut: true, fin: true },
    }),
  ])

  const connu = {
    presences,
    indisponibilites,
    rendezVous: rendezVous.map((r) => ({
      id: r.id,
      praticienId: r.praticienId,
      fauteuilId: r.fauteuilId,
      debut: r.debut,
      fin: r.fin,
      compteDansLOccupation: OCCUPE.includes(r.statut) && !r.surbooking,
    })),
  }

  // Un praticien peut tenir les deux cabinets sur la fenêtre : on cherche par
  // couple praticien × site, en ne gardant que les sites où il est présent.
  const couples = new Set(presences.map((p) => `${p.praticienId}|${p.siteId}`))

  const proposes: CreneauPropose[] = []
  for (const { praticienId, dureeMinutes } of praticiens) {
    for (const couple of couples) {
      const [id, siteId] = couple.split('|') as [string, string]
      if (id !== praticienId) continue

      const libres = creneauxLibres(
        {
          praticienId,
          siteId,
          dureeMinutes,
          motifEstUrgence: motif.estUrgence,
          debut,
          fin,
          pasMinutes: PAS_MINUTES,
        },
        connu,
      )

      for (const c of libres) proposes.push({ ...c, praticienId, siteId })
    }
  }

  return proposes.sort((a, b) => a.debut.getTime() - b.debut.getTime())
}
