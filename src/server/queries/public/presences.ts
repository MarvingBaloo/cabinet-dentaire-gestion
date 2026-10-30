import 'server-only'

import type { SiteCode } from '@prisma/client'

import { jourLocal } from '@/lib/dates'
import { prisma } from '@/server/db/client'

import { HORIZON_JOURS } from './creneaux'

// Qui reçoit où, et quels jours (maquettes du site public, 13/10) : « Dr Valmy ·
// Guadeloupe le vendredi ». Déduit des plages de présence à venir, sur le même
// horizon que la réservation — comme les horaires d'ouverture (D34) : ce que la
// page annonce, c'est ce que le patient pourrait réserver. Aucun rendez-vous,
// aucun patient : des jours de semaine par praticien et par cabinet.

/** Jours de semaine 1 (lundi) à 7 (dimanche). */
export type JoursSite = { siteId: string; siteCode: SiteCode; siteNom: string; jours: number[] }

export type CabinetPublic = {
  id: string
  code: SiteCode
  nom: string
  adresse: string | null
  fauteuils: number
  jours: number[]
}

export type PraticienPublic = {
  id: string
  prenom: string
  nom: string
  titre: string
  /** Le cabinet où il reçoit le plus de jours d'abord. */
  sites: JoursSite[]
}

const jourIso = (instant: Date) => {
  const j = new Date(`${jourLocal(instant)}T12:00:00.000Z`).getUTCDay()
  return j === 0 ? 7 : j
}

export async function presencesPubliques(): Promise<{ cabinets: CabinetPublic[]; praticiens: PraticienPublic[] }> {
  const maintenant = new Date()
  const horizon = new Date(maintenant.getTime() + HORIZON_JOURS * 86_400_000)

  const [sites, praticiens, plages] = await Promise.all([
    prisma.site.findMany({
      where: { actif: true },
      select: { id: true, code: true, nom: true, adresse: true, _count: { select: { fauteuils: true } } },
      orderBy: { code: 'desc' },
    }),
    prisma.praticien.findMany({
      where: { actif: true },
      select: { id: true, prenom: true, nom: true, titre: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    }),
    prisma.plageDePresence.findMany({
      where: { site: { actif: true }, debut: { lt: horizon }, fin: { gt: maintenant } },
      select: { praticienId: true, siteId: true, debut: true },
    }),
  ])

  const joursParSite = new Map<string, Set<number>>()
  const joursParPraticien = new Map<string, Map<string, Set<number>>>()
  for (const p of plages) {
    const j = jourIso(p.debut)
    joursParSite.set(p.siteId, (joursParSite.get(p.siteId) ?? new Set()).add(j))
    const parSite = joursParPraticien.get(p.praticienId) ?? new Map<string, Set<number>>()
    parSite.set(p.siteId, (parSite.get(p.siteId) ?? new Set()).add(j))
    joursParPraticien.set(p.praticienId, parSite)
  }
  const tri = (s: Set<number> | undefined) => [...(s ?? [])].sort((a, b) => a - b)

  return {
    cabinets: sites.map((s) => ({
      id: s.id,
      code: s.code,
      nom: s.nom,
      adresse: s.adresse,
      fauteuils: s._count.fauteuils,
      jours: tri(joursParSite.get(s.id)),
    })),
    praticiens: praticiens
      .map((p) => ({
        ...p,
        sites: sites
          .flatMap((s) => {
            const jours = tri(joursParPraticien.get(p.id)?.get(s.id))
            return jours.length > 0 ? [{ siteId: s.id, siteCode: s.code, siteNom: s.nom, jours }] : []
          })
          .sort((a, b) => b.jours.length - a.jours.length),
      }))
      // Un praticien sans aucune plage à venir ne reçoit personne : le montrer
      // sur le site promettrait des rendez-vous introuvables.
      .filter((p) => p.sites.length > 0),
  }
}
