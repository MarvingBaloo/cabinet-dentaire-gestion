import 'server-only'

import type { SiteCode } from '@prisma/client'
import { cache } from 'react'

import { prisma } from '@/server/db/client'

// Ce que le portail de réservation montre avant toute saisie : où, avec qui,
// pour quoi. Aucune de ces lectures ne demande à savoir qui regarde.
//
// ⚠ Lire le README de ce dossier avant d'y ajouter quoi que ce soit.

/** Les cabinets, tels qu'ils s'affichent sur le site : en activité seulement (D74). */
export async function listerSitesPublics() {
  return prisma.site.findMany({
    where: { actif: true },
    select: { id: true, code: true, nom: true, adresse: true },
    orderBy: { nom: 'asc' },
  })
}

/**
 * Les codes des cabinets en activité, une fois par requête : l'en-tête, le pied de page et l'accueil du site
 * écrivent « Marie-Galante · Guadeloupe » ou « Marie-Galante » selon ce qu'ils renvoient (D74).
 */
export const codesCabinetsEnActivite = cache(async () =>
  (await prisma.site.findMany({ where: { actif: true }, select: { code: true } })).map((s) => s.code),
)

const NOM_COURT: Record<SiteCode, string> = { MARIE_GALANTE: 'Marie-Galante', GUADELOUPE: 'Guadeloupe' }

/** « Marie-Galante · Guadeloupe », ou « Marie-Galante » seul : la mention sous le nom du cabinet. */
export async function lieuxEnActivite(): Promise<string> {
  const codes = await codesCabinetsEnActivite()
  return (['MARIE_GALANTE', 'GUADELOUPE'] as const)
    .filter((c) => codes.includes(c))
    .map((c) => NOM_COURT[c])
    .join(' · ')
}

/**
 * Les praticiens, avec les actes qu'ils pratiquent.
 *
 * Le nom et le titre sont déjà publics — ils figurent sur la plaque du cabinet
 * et sur le site vitrine. La durée de chaque acte, elle, ne sort pas : elle
 * renseignerait sur l'organisation interne sans servir au patient, qui voit des
 * créneaux, pas des minutes.
 */
export async function listerPraticiensPublics() {
  return prisma.praticien.findMany({
    where: { actif: true },
    select: {
      id: true,
      nom: true,
      prenom: true,
      titre: true,
      motifs: { select: { motifId: true } },
    },
    orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
  })
}

export type EntreeMotifPatient = {
  id: string
  libelle: string
  aide: string | null
  /** Renseigné sur un choix final ; nul sur une entrée qui ouvre une liste. */
  motifId: string | null
  enfants: { id: string; libelle: string; aide: string | null; motifId: string }[]
}

/**
 * Le menu que le patient parcourt, en deux niveaux.
 *
 * Une entrée sans acte rattaché n'est PAS rendue : sans acte, pas de durée,
 * donc aucun créneau calculable. Mieux vaut qu'elle n'apparaisse pas que de
 * mener le patient à une liste vide qu'il prendrait pour un agenda plein.
 *
 * De même, une entrée qui ouvre une liste dont tous les choix sont muets
 * disparaît avec eux : « Consultation de suivi » n'a aucun sens si le seul
 * suivi proposé n'existe pas encore côté actes.
 */
export async function listerMotifsPatient(): Promise<EntreeMotifPatient[]> {
  const entrees = await prisma.motifPatient.findMany({
    where: { actif: true, parentId: null },
    orderBy: { ordre: 'asc' },
    select: {
      id: true,
      libelle: true,
      aide: true,
      motifId: true,
      enfants: {
        where: { actif: true, motifId: { not: null } },
        orderBy: { ordre: 'asc' },
        select: { id: true, libelle: true, aide: true, motifId: true },
      },
    },
  })

  return entrees
    .map((e) => ({
      ...e,
      // `motifId: { not: null }` filtre déjà, mais TypeScript ne le sait pas.
      enfants: e.enfants.flatMap((c) => (c.motifId ? [{ ...c, motifId: c.motifId }] : [])),
    }))
    .filter((e) => e.enfants.length > 0 || e.motifId !== null)
}
