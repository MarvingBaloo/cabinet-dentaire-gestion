import 'server-only'

import { StatutRendezVous } from '@prisma/client'

import { bornesDuJour, decalerJour, jourLocal } from '@/lib/dates'
import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { exigerAccesSite } from '@/server/auth/portee'
import type { CabinetAccessible } from '@/server/cabinet-choisi'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

/** Ce qui ne demande plus l'attention de personne dans « Prochains rendez-vous ». */
const HORS_SUITE: StatutRendezVous[] = [
  StatutRendezVous.ANNULE,
  StatutRendezVous.ABSENT,
  StatutRendezVous.TERMINE,
  StatutRendezVous.EN_CAISSE,
]

const ATTENTE_LONGUE_MS = 20 * 60_000

export type CabinetDuJour = {
  id: string
  nom: string
  adresse: string | null
  fauteuils: number
  praticiens: string[]
  /** Prochain jour de présence quand le cabinet est fermé aujourd'hui. */
  prochainJour: string | null
}

/**
 * Tout ce que montre l'Accueil, pour UN cabinet (celui de la barre du haut).
 *
 * `praticienId` restreint aux rendez-vous d'un praticien : l'Accueil du
 * praticien ne montre que les siens (maquette du 13/10). La secrétaire voit
 * tout le cabinet.
 */
export async function lireAccueil(
  ctx: AuthContext,
  cabinet: CabinetAccessible,
  cabinets: CabinetAccessible[],
  options: { praticienId?: string; maintenant?: Date } = {},
) {
  await requirePermission(ctx, 'agenda', 'read')
  await exigerAccesSite(ctx, cabinet.id)

  const maintenant = options.maintenant ?? new Date()
  const jour = jourLocal(maintenant)
  const { debut, fin } = bornesDuJour(jour)
  const duPraticien = options.praticienId ? { praticienId: options.praticienId } : {}

  const [rendezVous, annulations, creneauxLiberes, cabinetsDuJour] = await Promise.all([
    prisma.rendezVous.findMany({
      where: {
        siteId: cabinet.id,
        ...duPraticien,
        debut: { lt: fin },
        fin: { gt: debut },
        statut: { not: StatutRendezVous.ANNULE },
      },
      select: {
        id: true,
        debut: true,
        statut: true,
        createdAt: true,
        // Approché par la dernière modification : passer en salle d'attente est
        // ce qui modifie un rendez-vous le jour même, l'heure d'arrivée n'est
        // pas stockée à part.
        updatedAt: true,
        fauteuil: { select: { nom: true } },
        praticien: { select: { nom: true, couleur: true } },
        motif: { select: { libelle: true } },
        patient: { select: { nom: true, prenom: true } },
      },
      orderBy: { debut: 'asc' },
    }),
    prisma.rendezVous.count({
      where: { siteId: cabinet.id, ...duPraticien, statut: StatutRendezVous.ANNULATION_DEMANDEE },
    }),
    prisma.envoiListeAttente.count({
      where: { siteId: cabinet.id, ...duPraticien, createdAt: { gte: debut, lt: fin } },
    }),
    lireCabinetsDuJour(cabinets, jour),
  ])

  const enSalle = rendezVous.filter((r) => r.statut === StatutRendezVous.SALLE_ATTENTE)
  const prochains = rendezVous
    .filter((r) => !HORS_SUITE.includes(r.statut) && r.debut.getTime() >= maintenant.getTime() - 30 * 60_000)
    .slice(0, 5)
  const fauteuilsDuJour = [...new Set(rendezVous.map((r) => r.fauteuil.nom))]

  await recordRead(ctx, 'agenda', rendezVous.length)

  return {
    jour,
    rendezVousDuJour: rendezVous.filter((r) => r.statut !== StatutRendezVous.ABSENT).length,
    fauteuilsDuJour,
    salleAttente: {
      nombre: enSalle.length,
      longues: enSalle.filter((r) => maintenant.getTime() - r.updatedAt.getTime() > ATTENTE_LONGUE_MS).length,
      premier: enSalle[0] ?? null,
    },
    annulations,
    creneauxLiberes,
    prochains,
    cabinets: cabinetsDuJour,
  }
}

async function lireCabinetsDuJour(cabinets: CabinetAccessible[], jour: string): Promise<CabinetDuJour[]> {
  const { debut, fin } = bornesDuJour(jour)
  const horizon = bornesDuJour(decalerJour(jour, 14)).fin

  return Promise.all(
    cabinets.map(async (c) => {
      const [site, fauteuils, aujourdhui, prochaine] = await Promise.all([
        prisma.site.findUniqueOrThrow({ where: { id: c.id }, select: { adresse: true } }),
        prisma.fauteuil.count({ where: { siteId: c.id, actif: true } }),
        prisma.plageDePresence.findMany({
          where: { siteId: c.id, debut: { lt: fin }, fin: { gt: debut } },
          select: { praticien: { select: { nom: true } } },
          orderBy: { debut: 'asc' },
        }),
        prisma.plageDePresence.findFirst({
          where: { siteId: c.id, debut: { gte: fin, lt: horizon } },
          select: { debut: true },
          orderBy: { debut: 'asc' },
        }),
      ])
      const praticiens = [...new Set(aujourdhui.map((p) => `Dr ${p.praticien.nom}`))]
      return {
        id: c.id,
        nom: c.nom,
        adresse: site.adresse,
        fauteuils,
        praticiens,
        prochainJour: praticiens.length === 0 && prochaine ? jourLocal(prochaine.debut) : null,
      }
    }),
  )
}

/**
 * Les demandes d'annulation en attente sur le cabinet, vues de l'accueil :
 * qui l'a transmise, et quel praticien doit trancher (D17).
 */
export async function lireDemandesTransmises(ctx: AuthContext, cabinet: CabinetAccessible) {
  await requirePermission(ctx, 'agenda', 'read')
  await exigerAccesSite(ctx, cabinet.id)

  const demandes = await prisma.rendezVous.findMany({
    where: { siteId: cabinet.id, statut: StatutRendezVous.ANNULATION_DEMANDEE },
    select: {
      id: true,
      debut: true,
      annulationDemandeeLe: true,
      annulationDemandeeParId: true,
      annulationDemandeePar: { select: { prenom: true, nom: true } },
      praticien: { select: { nom: true } },
      patient: { select: { nom: true, prenom: true } },
      motif: { select: { libelle: true } },
    },
    orderBy: { debut: 'asc' },
    take: 4,
  })

  await recordRead(ctx, 'agenda', demandes.length)
  return demandes
}
