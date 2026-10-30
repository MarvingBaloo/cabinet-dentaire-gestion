import 'server-only'

import { HORIZON_JOURS, creneauxDisponibles } from '@/server/queries/public/creneaux'
import { prisma } from '@/server/db/client'
import { fenetreValide } from '@/server/services/acces-patient'
import type { InscrireListeAttenteInput } from '@/server/validation/liste-attente'

// Inscription à la liste d'attente, depuis le portail public (lot D, D29).
//
// ⚠ ZONE AUTORISÉE, PAS `queries/public/` (D19). L'inscription touche un
// numéro de téléphone vérifié : elle suit le même chemin que
// `services/acces-patient.ts`, dont elle réutilise le jeton de fenêtre —
// aucun second système de code à usage unique.

export type EtatInscription =
  | { etat: 'inscrit'; id: string }
  | { etat: 'fenetre_expiree' }
  | { etat: 'reservation_bloquee' }
  | { etat: 'motif_invalide' }

export type EtatDesinscription =
  | { etat: 'desinscrit' }
  | { etat: 'fenetre_expiree' }
  | { etat: 'introuvable' }

/**
 * Inscrit le numéro derrière ce jeton à la liste d'attente d'un motif et d'un
 * cabinet (praticien facultatif).
 *
 * Idempotente : une inscription identique déjà active (même numéro, même
 * motif, même site, même praticien ou même absence de préférence) n'est pas
 * dupliquée — son identifiant est simplement rendu à nouveau.
 */
export async function inscrireListeAttente(
  jeton: string,
  input: InscrireListeAttenteInput,
  ipAddress: string,
  maintenant: Date,
): Promise<EtatInscription> {
  const acces = await fenetreValide(jeton)
  if (!acces) return { etat: 'fenetre_expiree' }

  // Patient bloqué (D21) : la même garde qu'à la réservation — un numéro
  // suivi qui a atteint trois manquements ne s'inscrit pas davantage qu'il ne
  // réserve.
  const patient = await prisma.patient.findFirst({
    where: { telephone: acces.telephone, actif: true },
    select: { reservationBloquee: true },
  })
  if (patient?.reservationBloquee) return { etat: 'reservation_bloquee' }

  const motif = await prisma.motifConsultation.findFirst({
    where: { id: input.motifId, actif: true },
    select: { id: true },
  })
  if (!motif) return { etat: 'motif_invalide' }
  // Un cabinet décoché (D74) ne se propose pas : même réponse qu'un choix qui n'existe pas.
  if (!(await prisma.site.count({ where: { id: input.siteId, actif: true } }))) return { etat: 'motif_invalide' }

  if (input.praticienId) {
    // Le praticien précisé doit pratiquer cet acte (D14), comme à la
    // réservation — sans quoi l'inscription ne correspondrait jamais à rien.
    const lien = await prisma.praticienMotif.findUnique({
      where: { praticienId_motifId: { praticienId: input.praticienId, motifId: input.motifId } },
      select: { praticienId: true },
    })
    if (!lien) return { etat: 'motif_invalide' }
  }

  const existante = await prisma.inscriptionListeAttente.findFirst({
    where: {
      telephone: acces.telephone,
      motifId: input.motifId,
      siteId: input.siteId,
      praticienId: input.praticienId ?? null,
      expiresAt: { gt: maintenant },
    },
    select: { id: true },
  })
  if (existante) return { etat: 'inscrit', id: existante.id }

  // Date butoir (D29) : le début du premier créneau proposé pour ce motif, ce
  // site (et ce praticien si précisé), avec exactement les mêmes paramètres
  // que ceux qu'`/rendez-vous` interrogerait pour ce patient — recalculée ICI,
  // jamais reçue du formulaire. Aucun créneau disponible → pas de date butoir,
  // comme aujourd'hui.
  const creneaux = await creneauxDisponibles({
    motifId: input.motifId,
    siteId: input.siteId,
    ...(input.praticienId ? { praticienId: input.praticienId } : {}),
  })
  const avantLe = creneaux[0]?.debut ?? null

  // Écriture et trace dans la même transaction (D9).
  const inscription = await prisma.$transaction(async (tx) => {
    const creee = await tx.inscriptionListeAttente.create({
      data: {
        telephone: acces.telephone,
        motifId: input.motifId,
        siteId: input.siteId,
        praticienId: input.praticienId ?? null,
        // Horizon d'ouverture du portail (D29) : au-delà, plus rien à proposer.
        expiresAt: new Date(maintenant.getTime() + HORIZON_JOURS * 86_400_000),
        avantLe,
      },
      select: { id: true },
    })

    await tx.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'liste_attente',
        entityId: creee.id,
        actorRoles: [],
        ipAddress,
        siteId: input.siteId,
        // Sans téléphone : comme les autres traces du portail public.
        metadata: { origine: 'portail public', motifId: input.motifId, praticienId: input.praticienId ?? null },
      },
    })
    return creee
  })

  return { etat: 'inscrit', id: inscription.id }
}

/** Les inscriptions actives du numéro derrière ce jeton. */
export async function inscriptionsDuPatient(jeton: string, maintenant: Date) {
  const acces = await fenetreValide(jeton)
  if (!acces) return null

  return prisma.inscriptionListeAttente.findMany({
    where: { telephone: acces.telephone, expiresAt: { gt: maintenant } },
    select: {
      id: true,
      createdAt: true,
      avantLe: true,
      motif: { select: { libelle: true } },
      site: { select: { nom: true } },
      praticien: { select: { nom: true, prenom: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
}

/** Désinscription depuis l'accès patient (D29). */
export async function desinscrireListeAttente(
  jeton: string,
  inscriptionId: string,
  ipAddress: string,
): Promise<EtatDesinscription> {
  const acces = await fenetreValide(jeton)
  if (!acces) return { etat: 'fenetre_expiree' }

  const inscription = await prisma.inscriptionListeAttente.findFirst({
    where: { id: inscriptionId, telephone: acces.telephone },
    select: { id: true, siteId: true, motifId: true, praticienId: true },
  })
  if (!inscription) return { etat: 'introuvable' }

  // Sous condition et avec sa trace (D9) : deux désinscriptions simultanées n'en appliquent qu'une, l'autre
  // répond « introuvable » au lieu d'une erreur (21/10).
  const supprimee = await prisma.$transaction(async (tx) => {
    const { count } = await tx.inscriptionListeAttente.deleteMany({ where: { id: inscription.id } })
    if (count === 0) return false

    await tx.auditLog.create({
      data: {
        action: 'DELETE',
        entityType: 'liste_attente',
        entityId: inscription.id,
        actorRoles: [],
        ipAddress,
        siteId: inscription.siteId,
        metadata: { origine: 'portail public', motifId: inscription.motifId, praticienId: inscription.praticienId },
      },
    })
    return true
  })
  if (!supprimee) return { etat: 'introuvable' }

  return { etat: 'desinscrit' }
}
