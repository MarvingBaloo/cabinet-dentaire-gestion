import 'server-only'

import { StatutRendezVous } from '@prisma/client'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { filtrePraticien, filtreSite } from '@/server/auth/portee'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import { SEUIL_MANQUEMENTS } from '@/server/domaine/agenda'

// Lectures du fichier patients.
//
// ⚠ Aucun `filtreSite` ici, et l'absence est délibérée : un patient n'appartient
// pas à un site. Il consulte à Marie-Galante en novembre et en Guadeloupe en
// décembre, et la secrétaire qui le cherche doit le trouver dans les deux cas.
// Ce qui reste cloisonné, ce sont ses rendez-vous — voir queries/agenda.ts (D5).
//
// Savoir qu'une personne est patiente d'un cabinet dentaire est déjà une donnée
// de santé : toute lecture est donc tracée, y compris celle qui ne rend rien.

const CHAMPS_FICHE = {
  id: true,
  nom: true,
  prenom: true,
  dateNaissance: true,
  telephone: true,
  // Un rendez-vous peut se prendre avec un nom et un téléphone (Q33) ; l'écran
  // doit pouvoir signaler la fiche qui reste à compléter.
  profilComplet: true,
  reservationBloquee: true,
} as const

/**
 * Un praticien qui n'administre pas ne voit que les patients qui ont eu, ou ont, rendez-vous avec lui
 * (Marving, 27/10) : la fiche d'un patient de son confrère lui est introuvable.
 */
export function sesPatients(ctx: AuthContext) {
  return ctx.praticienRestreint ? { rendezVous: { some: { praticienId: ctx.praticienRestreint } } } : {}
}

/** En deçà, la recherche rendrait un échantillon arbitraire du fichier entier. */
const LONGUEUR_MINIMALE = 2

/** Plafond volontaire : au-delà, c'est la recherche qu'il faut préciser. */
const MAX_RESULTATS = 25

/**
 * Patients correspondant à une recherche par nom, prénom ou téléphone.
 *
 * Chaque mot saisi doit correspondre à l'un des trois champs — « dupont marie »
 * trouve Marie Dupont, là qu'un simple `contains` sur la chaîne entière ne
 * trouverait rien, aucun champ ne contenant les deux mots.
 */
export async function rechercherPatients(ctx: AuthContext, terme: string) {
  await requirePermission(ctx, 'patient', 'read')

  const mots = terme.trim().split(/\s+/).filter(Boolean)
  const assezLong = mots.some((m) => m.length >= LONGUEUR_MINIMALE)

  // Une recherche qu'on n'exécute pas n'est pas une lecture : rien n'a été
  // consulté, il n'y a rien à journaliser.
  if (mots.length === 0 || !assezLong) return []

  const patients = await prisma.patient.findMany({
    where: {
      actif: true,
      ...sesPatients(ctx),
      AND: mots.map((mot) => ({
        OR: [
          { nom: { contains: mot, mode: 'insensitive' as const } },
          { prenom: { contains: mot, mode: 'insensitive' as const } },
          { telephone: { contains: mot } },
        ],
      })),
    },
    select: CHAMPS_FICHE,
    orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    take: MAX_RESULTATS,
  })

  // Dernière visite honorée : aide à distinguer deux homonymes au téléphone
  // (« celle qui est venue la semaine dernière ? »).
  const visites = patients.length
    ? await prisma.rendezVous.groupBy({
        by: ['patientId'],
        where: {
          patientId: { in: patients.map((p) => p.id) },
          ...filtrePraticien(ctx),
          debut: { lt: new Date() },
          statut: { in: [StatutRendezVous.TERMINE, StatutRendezVous.EN_CAISSE] },
        },
        _max: { debut: true },
      })
    : []
  const derniere = new Map(visites.map((v) => [v.patientId, v._max.debut]))

  // Tracé même quand la recherche ne rend rien : une série de recherches
  // infructueuses est un motif de balayage du fichier.
  await recordRead(ctx, 'patient', patients.length)
  return patients.map((p) => ({ ...p, derniereVisite: derniere.get(p.id) ?? null }))
}

/**
 * La recherche de la barre du haut (tour du 20/10) : huit patients au plus, chacun
 * avec son prochain rendez-vous — pris, lui, dans les seuls cabinets de l'appelant
 * (D5). Au téléphone, c'est ce rendez-vous que l'on vient chercher.
 */
export async function rechercheRapide(ctx: AuthContext, terme: string) {
  const patients = (await rechercherPatients(ctx, terme)).slice(0, 8)
  if (patients.length === 0) return []
  const prochains = await prisma.rendezVous.findMany({
    where: {
      ...filtreSite(ctx),
      ...filtrePraticien(ctx),
      patientId: { in: patients.map((p) => p.id) },
      debut: { gte: new Date() },
      statut: { notIn: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT] },
    },
    select: { id: true, patientId: true, debut: true },
    orderBy: { debut: 'asc' },
  })
  return patients.map((p) => ({ ...p, prochain: prochains.find((r) => r.patientId === p.id) ?? null }))
}

/**
 * Les patients dont la réservation en ligne est fermée (Q27).
 *
 * Liste entière et non paginée, volontairement : trois manquements restent rares,
 * et un cabinet qui en compterait assez pour justifier une pagination aurait un
 * problème que la pagination ne réglerait pas.
 *
 * `patient:read` suffit à voir la liste — c'est du fichier patient. Lever le
 * blocage demande davantage, et cela se joue dans le service.
 */
export async function patientsBloques(ctx: AuthContext) {
  await requirePermission(ctx, 'patient', 'read')

  const patients = await prisma.patient.findMany({
    where: { actif: true, reservationBloquee: true, ...sesPatients(ctx) },
    select: {
      id: true,
      nom: true,
      prenom: true,
      telephone: true,
      manquements: true,
      debloqueLe: true,
    },
    orderBy: [{ manquements: 'desc' }, { nom: 'asc' }, { prenom: 'asc' }],
  })

  // Le détail des manquements comptés depuis le dernier déblocage (maquette du
  // 13/10) : absences et annulations, le dernier, et la date du manquement qui
  // a atteint le seuil — celle où la réservation s'est fermée.
  const comptes = patients.length
    ? await prisma.rendezVous.findMany({
        where: { patientId: { in: patients.map((p) => p.id) }, manquementCompte: true },
        select: { patientId: true, debut: true, statut: true },
        orderBy: { debut: 'asc' },
      })
    : []

  await recordRead(ctx, 'patient', patients.length)
  return patients.map((p) => {
    const siens = comptes.filter((c) => c.patientId === p.id && (!p.debloqueLe || c.debut > p.debloqueLe))
    return {
      ...p,
      absences: siens.filter((c) => c.statut === StatutRendezVous.ABSENT).length,
      annulations: siens.filter((c) => c.statut === StatutRendezVous.ANNULE).length,
      dernier: siens.at(-1) ?? null,
      bloqueDepuis: siens[SEUIL_MANQUEMENTS - 1]?.debut ?? null,
    }
  })
}

/**
 * Les patients attendus sur une période (par défaut : la journée), quand rien
 * n'est cherché — la liste utile au comptoir. Cantonnés aux rendez-vous des
 * cabinets de l'appelant (D5) : on ne découvre pas par là qui vient dans l'autre.
 */
export async function patientsAttendus(ctx: AuthContext, periode: { debut: Date; fin: Date }) {
  await requirePermission(ctx, 'patient', 'read')
  await requirePermission(ctx, 'agenda', 'read')

  const rdvs = await prisma.rendezVous.findMany({
    where: {
      ...filtreSite(ctx),
      ...filtrePraticien(ctx),
      debut: { gte: periode.debut, lt: periode.fin },
      statut: { notIn: [StatutRendezVous.ANNULE] },
      patient: { actif: true },
    },
    select: { debut: true, patient: { select: CHAMPS_FICHE } },
    orderBy: { debut: 'asc' },
  })
  const vus = new Map<string, (typeof rdvs)[number]['patient'] & { prochain: Date }>()
  for (const r of rdvs) if (!vus.has(r.patient.id)) vus.set(r.patient.id, { ...r.patient, prochain: r.debut })
  await recordRead(ctx, 'patient', vus.size)
  return [...vus.values()]
}

/**
 * La fiche d'un patient : coordonnées, rendez-vous (à venir et passés, dans les
 * seuls cabinets de l'appelant, D5), manquements et blocage, inscriptions en
 * liste d'attente. `null` si la fiche n'existe pas ou a été désactivée.
 */
export async function lireFichePatient(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'patient', 'read')

  const patient = await prisma.patient.findFirst({
    where: { id, actif: true, ...sesPatients(ctx) },
    select: {
      ...CHAMPS_FICHE,
      email: true,
      representantLegal: true,
      telephoneRepresentant: true,
      manquements: true,
      debloqueLe: true,
      createdAt: true,
    },
  })
  await recordRead(ctx, 'patient', patient ? 1 : 0, id)
  if (!patient) return null

  const peutVoirAgenda = ctx.permissions.has('agenda:read')
  const [rendezVous, inscriptions] = await Promise.all([
    peutVoirAgenda
      ? prisma.rendezVous.findMany({
          where: { patientId: id, ...filtreSite(ctx), ...filtrePraticien(ctx) },
          select: {
            id: true,
            debut: true,
            fin: true,
            statut: true,
            manquementCompte: true,
            motif: { select: { libelle: true, estUrgence: true } },
            praticien: { select: { nom: true, prenom: true, couleur: true } },
            site: { select: { nom: true } },
          },
          orderBy: { debut: 'desc' },
        })
      : Promise.resolve([]),
    prisma.inscriptionListeAttente.findMany({
      where: { telephone: patient.telephone, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        avantLe: true,
        motif: { select: { libelle: true } },
        site: { select: { nom: true } },
        praticien: { select: { nom: true, prenom: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  if (peutVoirAgenda) await recordRead(ctx, 'agenda', rendezVous.length)
  return { patient, rendezVous, inscriptions }
}
