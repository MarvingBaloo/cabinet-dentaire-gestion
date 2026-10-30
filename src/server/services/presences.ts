import 'server-only'

import { Prisma, TypeExceptionPresence } from '@prisma/client'

import { bornesDuJour, decalerJour, heureMinutesDepuisHHMM, jourLocal } from '@/lib/dates'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { exigerAccesSite } from '@/server/auth/portee'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import {
  STATUTS_ACTIFS_POUR_PRESENCE,
  type ExceptionConnue,
  type LigneSemaineTypeConnue,
  jourSemaineISO,
  plagesVouluesAvecFeries,
  rendezVousOrphelins,
} from '@/server/domaine/presences'
import { HORIZON_JOURS } from '@/server/queries/public/creneaux'
import type {
  EnregistrerExceptionInput,
  EnregistrerJourSemaineTypeInput,
  SupprimerExceptionInput,
} from '@/server/validation/presences'

// Écriture de la semaine type et de ses exceptions (compléments d'agenda,
// lot 1). `PlageDePresence` n'est plus saisie directement : elle est
// RÉCONCILIÉE ici à partir de ces deux sources, sur le même horizon de deux
// mois que le portail public (`HORIZON_JOURS`, Q3).
//
// Même enchaînement que le reste de l'agenda (D4, D5, D9, D11) : permission,
// portée, règle du domaine (Q5 — jamais de rendez-vous orphelin), puis
// écriture et trace dans la MÊME transaction.

export class RendezVousOrphelinsError extends Error {
  constructor(readonly rendezVous: RendezVousConcerne[]) {
    super(
      `Ce changement laisserait ${rendezVous.length} rendez-vous sans présence couvrante. ` +
        'Déplacez-les ou annulez-les avant d’enregistrer.',
    )
    this.name = 'RendezVousOrphelinsError'
  }
}

export type RendezVousConcerne = {
  id: string
  debut: Date
  fin: Date
  patientNom: string
  patientPrenom: string
  motifLibelle: string
}

export class FauteuilHorsSiteError extends Error {
  constructor() {
    super('Ce fauteuil n’appartient pas au cabinet choisi.')
    this.name = 'FauteuilHorsSiteError'
  }
}

/** Le praticien n'a pas encore de fauteuil dans ce cabinet : il se choisit une fois, en tête de sa carte. */
export class FauteuilNonChoisiError extends Error {
  constructor() {
    super('Choisissez d’abord le fauteuil de ce praticien dans ce cabinet.')
    this.name = 'FauteuilNonChoisiError'
  }
}

/** Réservation concurrente sur le moteur de plages : deux enregistrements de
 *  présence, valides séparément, incompatibles ensemble (même principe que
 *  `CreneauPrisEntretempsError` dans services/agenda.ts). */
export class PresenceEnConflitError extends Error {
  constructor() {
    super('Une autre présence occupe déjà ce fauteuil sur ce créneau. Réessayez.')
    this.name = 'PresenceEnConflitError'
  }
}

/** 23P01 = exclusion_violation. `plage_fauteuil_sans_chevauchement` l'émet. */
function estChevauchementPresence(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = e.meta as { code?: string; constraint?: string } | undefined
    if (meta?.code === '23P01') return true
    if (typeof meta?.constraint === 'string' && meta.constraint.includes('sans_chevauchement')) return true
  }
  return e instanceof Error && e.message.includes('sans_chevauchement')
}

function calculerHorizon(maintenant: Date): { debut: string; fin: string } {
  const debut = jourLocal(maintenant)
  return { debut, fin: decalerJour(debut, HORIZON_JOURS) }
}

async function chargerSemaineType(
  db: Prisma.TransactionClient | typeof prisma,
  praticienId: string,
): Promise<LigneSemaineTypeConnue[]> {
  return db.presenceHebdomadaire.findMany({
    where: { praticienId },
    select: {
      jourSemaine: true,
      siteId: true,
      fauteuilId: true,
      heureDebut: true,
      heureFin: true,
      pauseDebut: true,
      pauseFin: true,
    },
  })
}

async function chargerExceptions(
  db: Prisma.TransactionClient | typeof prisma,
  praticienId: string,
): Promise<ExceptionConnue[]> {
  const lignes = await db.exceptionPresence.findMany({
    where: { praticienId },
    select: { date: true, type: true, siteId: true, fauteuilId: true, heureDebut: true, heureFin: true },
  })
  return lignes.map((e) => ({
    date: e.date.toISOString().slice(0, 10),
    type: e.type,
    siteId: e.siteId,
    fauteuilId: e.fauteuilId,
    heureDebut: e.heureDebut,
    heureFin: e.heureFin,
  }))
}

/**
 * Recalcule les plages voulues pour CE praticien sur l'horizon courant, refuse
 * si un rendez-vous actif en sortirait orphelin (Q5), et réconcilie
 * `PlageDePresence` par différence sinon : crée ce qui manque, supprime ce qui
 * est superflu, laisse intact ce qui est déjà juste.
 *
 * Appelée DANS la transaction qui vient d'écrire la semaine type ou
 * l'exception : si elle lève, tout est annulé — y compris cette écriture. Rien
 * n'est jamais enregistré en cas de refus.
 */
async function verifierEtReconcilier(
  tx: Prisma.TransactionClient,
  praticienId: string,
  maintenant: Date,
): Promise<{ creees: number; supprimees: number }> {
  const horizon = calculerHorizon(maintenant)
  const bornesHorizon = bornesDuJour(horizon.debut).debut

  const [semaineType, exceptions] = await Promise.all([
    chargerSemaineType(tx, praticienId),
    chargerExceptions(tx, praticienId),
  ])

  const voulues = plagesVouluesAvecFeries(semaineType, exceptions, horizon)

  const rdvActifs = await tx.rendezVous.findMany({
    where: {
      praticienId,
      statut: { in: STATUTS_ACTIFS_POUR_PRESENCE },
      debut: { gte: bornesHorizon },
    },
    select: {
      id: true,
      fauteuilId: true,
      debut: true,
      fin: true,
      patient: { select: { nom: true, prenom: true } },
      motif: { select: { libelle: true } },
    },
  })

  const orphelins = rendezVousOrphelins(rdvActifs, voulues)
  if (orphelins.length > 0) {
    const parId = new Map(rdvActifs.map((r) => [r.id, r]))
    const detail: RendezVousConcerne[] = orphelins.map((o) => {
      const complet = parId.get(o.id)!
      return {
        id: o.id,
        debut: o.debut,
        fin: o.fin,
        patientNom: complet.patient.nom,
        patientPrenom: complet.patient.prenom,
        motifLibelle: complet.motif.libelle,
      }
    })
    throw new RendezVousOrphelinsError(detail)
  }

  // ── Réconciliation par différence ──
  const actuelles = await tx.plageDePresence.findMany({
    where: { praticienId, debut: { gte: bornesHorizon } },
    select: { id: true, siteId: true, fauteuilId: true, debut: true, fin: true },
  })

  const cle = (p: { siteId: string; fauteuilId: string; debut: Date; fin: Date }) =>
    `${p.siteId}|${p.fauteuilId}|${p.debut.getTime()}|${p.fin.getTime()}`

  const voulueParCle = new Set(voulues.map(cle))
  const actuelleParCle = new Set(actuelles.map(cle))

  const aCreer = voulues.filter((p) => !actuelleParCle.has(cle(p)))
  const aSupprimer = actuelles.filter((p) => !voulueParCle.has(cle(p)))

  if (aSupprimer.length > 0) {
    await tx.plageDePresence.deleteMany({ where: { id: { in: aSupprimer.map((p) => p.id) } } })
  }
  for (const p of aCreer) {
    await tx.plageDePresence.create({
      data: { praticienId, siteId: p.siteId, fauteuilId: p.fauteuilId, debut: p.debut, fin: p.fin },
    })
  }

  return { creees: aCreer.length, supprimees: aSupprimer.length }
}

/** Le fauteuil appartient-il bien au cabinet choisi ? Zod ne peut pas croiser
 *  deux identifiants contre la base — c'est une règle de cohérence, pas de forme. */
async function verifierFauteuilDuSite(fauteuilId: string, siteId: string): Promise<void> {
  const fauteuil = await prisma.fauteuil.findUnique({ where: { id: fauteuilId }, select: { siteId: true } })
  if (!fauteuil || fauteuil.siteId !== siteId) throw new FauteuilHorsSiteError()
}

/**
 * Le fauteuil fixe du praticien dans ce cabinet (Marving, 27/10). S'il n'en a pas encore, le fauteuil demandé
 * devient le sien ; sans demande, refus. Un fauteuil demandé alors qu'il en a déjà un est ignoré : c'est le sien
 * qui compte.
 */
async function resoudreFauteuil(praticienId: string, siteId: string, demande: string | undefined): Promise<string> {
  const fixe = await prisma.fauteuilPraticien.findUnique({
    where: { praticienId_siteId: { praticienId, siteId } },
    select: { fauteuilId: true },
  })
  if (fixe) return fixe.fauteuilId
  if (!demande) throw new FauteuilNonChoisiError()
  await verifierFauteuilDuSite(demande, siteId)
  await prisma.fauteuilPraticien.create({ data: { praticienId, siteId, fauteuilId: demande } })
  return demande
}

/**
 * Change le fauteuil fixe d'un praticien dans un cabinet : sa semaine type, ses exceptions, ses présences et ses
 * rendez-vous à venir dans ce cabinet passent au nouveau fauteuil, dans une seule transaction. Si un confrère
 * occupe déjà ce fauteuil au même moment, rien n'est changé.
 */
export async function choisirFauteuil(
  ctx: AuthContext,
  input: { praticienId: string; siteId: string; fauteuilId: string },
): Promise<{ rendezVous: number }> {
  await requirePermission(ctx, 'presence', 'update')
  await exigerAccesSite(ctx, input.siteId)
  await verifierFauteuilDuSite(input.fauteuilId, input.siteId)
  const { praticienId, siteId, fauteuilId } = input

  try {
    return await prisma.$transaction(async (tx) => {
      const avant = await tx.fauteuilPraticien.findUnique({
        where: { praticienId_siteId: { praticienId, siteId } },
        select: { fauteuilId: true },
      })
      await tx.fauteuilPraticien.upsert({
        where: { praticienId_siteId: { praticienId, siteId } },
        create: { praticienId, siteId, fauteuilId },
        update: { fauteuilId },
      })
      await tx.presenceHebdomadaire.updateMany({ where: { praticienId, siteId }, data: { fauteuilId } })
      await tx.exceptionPresence.updateMany({ where: { praticienId, siteId }, data: { fauteuilId } })
      const debut = bornesDuJour(jourLocal(new Date())).debut
      await tx.plageDePresence.updateMany({ where: { praticienId, siteId, debut: { gte: debut } }, data: { fauteuilId } })
      const { count } = await tx.rendezVous.updateMany({
        where: { praticienId, siteId, debut: { gte: debut }, statut: { in: STATUTS_ACTIFS_POUR_PRESENCE } },
        data: { fauteuilId },
      })
      await verifierEtReconcilier(tx, praticienId, new Date())
      await recordAudit(tx, ctx, {
        action: 'UPDATE',
        entityType: 'fauteuil_praticien',
        entityId: praticienId,
        metadata: { siteId, avant: avant?.fauteuilId ?? null, apres: fauteuilId, rendezVous: count },
      })
      return { rendezVous: count }
    })
  } catch (e) {
    if (estChevauchementPresence(e)) throw new FauteuilOccupeError()
    throw e
  }
}

export class FauteuilOccupeError extends Error {
  constructor() {
    super('Un confrère occupe déjà ce fauteuil sur certains de ces horaires. Rien n’a été changé.')
    this.name = 'FauteuilOccupeError'
  }
}

export async function enregistrerJourSemaineType(
  ctx: AuthContext,
  input: EnregistrerJourSemaineTypeInput,
): Promise<{ creees: number; supprimees: number }> {
  const existant = await prisma.presenceHebdomadaire.findUnique({
    where: { praticienId_jourSemaine: { praticienId: input.praticienId, jourSemaine: input.jourSemaine } },
    select: { id: true, siteId: true },
  })

  const action = input.actif ? (existant ? 'update' : 'create') : existant ? 'delete' : 'update'
  await requirePermission(ctx, 'presence', action)

  let fauteuilId = ''
  if (input.actif) {
    await exigerAccesSite(ctx, input.siteId!)
    fauteuilId = await resoudreFauteuil(input.praticienId, input.siteId!, input.fauteuilId)
  } else if (existant) {
    await exigerAccesSite(ctx, existant.siteId)
  } else {
    // Rien à faire : pas de ligne à retirer, et rien n'a été écrit.
    return { creees: 0, supprimees: 0 }
  }

  const heureDebut = input.heureDebut ? heureMinutesDepuisHHMM(input.heureDebut) : null
  const heureFin = input.heureFin ? heureMinutesDepuisHHMM(input.heureFin) : null
  const pauseDebut = input.pauseDebut ? heureMinutesDepuisHHMM(input.pauseDebut) : null
  const pauseFin = input.pauseFin ? heureMinutesDepuisHHMM(input.pauseFin) : null

  try {
    return await prisma.$transaction(async (tx) => {
      if (input.actif) {
        const horaires = { heureDebut: heureDebut!, heureFin: heureFin!, pauseDebut, pauseFin }
        await tx.presenceHebdomadaire.upsert({
          where: { praticienId_jourSemaine: { praticienId: input.praticienId, jourSemaine: input.jourSemaine } },
          create: {
            praticienId: input.praticienId,
            jourSemaine: input.jourSemaine,
            siteId: input.siteId!,
            fauteuilId,
            ...horaires,
          },
          update: { siteId: input.siteId!, fauteuilId, ...horaires },
        })
      } else if (existant) {
        await tx.presenceHebdomadaire.delete({ where: { id: existant.id } })
      }

      const resultat = await verifierEtReconcilier(tx, input.praticienId, new Date())

      await recordAudit(tx, ctx, {
        action: existant ? 'UPDATE' : 'CREATE',
        entityType: 'presence',
        entityId: input.praticienId,
        metadata: {
          jourSemaine: input.jourSemaine,
          actif: input.actif,
          pause: pauseDebut != null,
          plagesCreees: resultat.creees,
          plagesSupprimees: resultat.supprimees,
        },
      })

      return resultat
    })
  } catch (e) {
    if (estChevauchementPresence(e)) throw new PresenceEnConflitError()
    throw e
  }
}

/**
 * Le site « applicable » à une date pour un praticien, avant tout changement :
 * celui d'une exception AJOUT_OU_MODIFICATION déjà posée sur ce jour, sinon
 * celui de la semaine type pour ce jour de semaine, sinon aucun (rien à
 * protéger — le jour était déjà vide). Sert à poser `exigerAccesSite` même
 * pour un RETRAIT ou une suppression, qui ne portent pas de site propre.
 */
async function siteApplicable(praticienId: string, jour: string): Promise<string | null> {
  const existante = await prisma.exceptionPresence.findUnique({
    where: { praticienId_date: { praticienId, date: new Date(`${jour}T00:00:00.000Z`) } },
    select: { siteId: true, type: true },
  })
  if (existante) return existante.type === TypeExceptionPresence.AJOUT_OU_MODIFICATION ? existante.siteId : null

  const ligne = await prisma.presenceHebdomadaire.findUnique({
    where: { praticienId_jourSemaine: { praticienId, jourSemaine: jourSemaineISO(jour) } },
    select: { siteId: true },
  })
  return ligne?.siteId ?? null
}

export async function enregistrerException(
  ctx: AuthContext,
  input: EnregistrerExceptionInput,
): Promise<{ creees: number; supprimees: number }> {
  const existante = await prisma.exceptionPresence.findUnique({
    where: { praticienId_date: { praticienId: input.praticienId, date: new Date(`${input.date}T00:00:00.000Z`) } },
    select: { id: true },
  })
  await requirePermission(ctx, 'presence', existante ? 'update' : 'create')

  let fauteuilId: string | null = null
  if (input.type === TypeExceptionPresence.AJOUT_OU_MODIFICATION) {
    await exigerAccesSite(ctx, input.siteId!)
    fauteuilId = await resoudreFauteuil(input.praticienId, input.siteId!, input.fauteuilId)
  } else {
    const site = await siteApplicable(input.praticienId, input.date)
    if (site) await exigerAccesSite(ctx, site)
  }

  const heureDebut = input.heureDebut ? heureMinutesDepuisHHMM(input.heureDebut) : null
  const heureFin = input.heureFin ? heureMinutesDepuisHHMM(input.heureFin) : null

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.exceptionPresence.upsert({
        where: { praticienId_date: { praticienId: input.praticienId, date: new Date(`${input.date}T00:00:00.000Z`) } },
        create: {
          praticienId: input.praticienId,
          date: new Date(`${input.date}T00:00:00.000Z`),
          type: input.type,
          motif: input.motif ?? null,
          siteId: input.type === TypeExceptionPresence.AJOUT_OU_MODIFICATION ? input.siteId! : null,
          fauteuilId,
          heureDebut: input.type === TypeExceptionPresence.AJOUT_OU_MODIFICATION ? heureDebut : null,
          heureFin: input.type === TypeExceptionPresence.AJOUT_OU_MODIFICATION ? heureFin : null,
        },
        update: {
          type: input.type,
          motif: input.motif ?? null,
          siteId: input.type === TypeExceptionPresence.AJOUT_OU_MODIFICATION ? input.siteId! : null,
          fauteuilId,
          heureDebut: input.type === TypeExceptionPresence.AJOUT_OU_MODIFICATION ? heureDebut : null,
          heureFin: input.type === TypeExceptionPresence.AJOUT_OU_MODIFICATION ? heureFin : null,
        },
      })

      const resultat = await verifierEtReconcilier(tx, input.praticienId, new Date())

      await recordAudit(tx, ctx, {
        action: existante ? 'UPDATE' : 'CREATE',
        entityType: 'presence_exception',
        entityId: input.praticienId,
        metadata: {
          date: input.date,
          type: input.type,
          plagesCreees: resultat.creees,
          plagesSupprimees: resultat.supprimees,
        },
      })

      return resultat
    })
  } catch (e) {
    if (estChevauchementPresence(e)) throw new PresenceEnConflitError()
    throw e
  }
}

export async function supprimerException(
  ctx: AuthContext,
  input: SupprimerExceptionInput,
): Promise<{ creees: number; supprimees: number }> {
  const existante = await prisma.exceptionPresence.findUnique({
    where: { id: input.id },
    select: { id: true, praticienId: true, date: true, type: true, siteId: true },
  })
  if (!existante) throw new Error('Exception introuvable.')

  await requirePermission(ctx, 'presence', 'delete')

  const jour = existante.date.toISOString().slice(0, 10)
  const site =
    existante.type === TypeExceptionPresence.AJOUT_OU_MODIFICATION
      ? existante.siteId
      : await siteApplicable(existante.praticienId, jour)
  if (site) await exigerAccesSite(ctx, site)

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.exceptionPresence.delete({ where: { id: existante.id } })

      const resultat = await verifierEtReconcilier(tx, existante.praticienId, new Date())

      await recordAudit(tx, ctx, {
        action: 'DELETE',
        entityType: 'presence_exception',
        entityId: existante.praticienId,
        metadata: { date: jour, type: existante.type, plagesCreees: resultat.creees, plagesSupprimees: resultat.supprimees },
      })

      return resultat
    })
  } catch (e) {
    if (estChevauchementPresence(e)) throw new PresenceEnConflitError()
    throw e
  }
}

/**
 * Glissement quotidien de l'horizon (worker, `scripts/worker-notifications.ts`) :
 * refait, pour CHAQUE praticien ayant une semaine type, le même calcul que
 * `verifierEtReconcilier` — un jour de plus apparaît en bout d'horizon, un
 * jour passé sort de la fenêtre surveillée. Ne devrait normalement rien
 * supprimer : les plages déjà en base pour les jours restants ne changent pas
 * quand seule la fenêtre avance (voir le commentaire de `verifierEtReconcilier`
 * sur la borne `gte: bornesHorizon`).
 *
 * Un praticien à la fois, chacun dans sa propre transaction : un conflit sur
 * l'un (ne devrait pas arriver en glissement pur, D12 mis à part) ne doit pas
 * empêcher les autres, et surtout ne doit RIEN effacer pour celui en défaut —
 * la transaction qui lève est intégralement annulée.
 */
export async function genererPlagesPourTousLesPraticiens(
  maintenant: Date,
): Promise<{ praticiens: number; creees: number; supprimees: number; conflits: number }> {
  const praticiens = await prisma.presenceHebdomadaire.findMany({
    distinct: ['praticienId'],
    select: { praticienId: true },
  })

  let creees = 0
  let supprimees = 0
  let conflits = 0

  for (const { praticienId } of praticiens) {
    try {
      const resultat = await prisma.$transaction((tx) => verifierEtReconcilier(tx, praticienId, maintenant))
      creees += resultat.creees
      supprimees += resultat.supprimees
    } catch (e) {
      conflits += 1
      // Pas de donnée de santé dans ce journal (même règle que le reste du
      // worker) : uniquement l'identifiant technique du praticien.
      console.error(`presences : glissement quotidien en échec pour le praticien ${praticienId}`, e)
    }
  }

  return { praticiens: praticiens.length, creees, supprimees, conflits }
}
