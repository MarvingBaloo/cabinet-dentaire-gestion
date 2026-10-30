import 'server-only'

import type { Prisma } from '@prisma/client'

import type { AuthContext } from '@/server/auth/context'
import { hasPermission, requirePermission } from '@/server/auth/permissions'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import {
  PERIODES,
  calculerAbsences,
  calculerActivite,
  calculerMotifs,
  calculerPatients,
  calculerPrise,
  calculerRemplissage,
  fenetreDe,
  type Fenetre,
  type Periode,
  type RdvStat,
} from '@/server/domaine/statistiques'

// Statistiques du cabinet (D73). Deux gardes, comme partout :
//   - `statistiques:read` : les praticiens et l'administrateur. Un praticien ne lit que SES chiffres ;
//   - `statistiques:cabinet` : l'administrateur (donc le titulaire) choisit un confrère ou tout le cabinet.
//     Demander les chiffres d'un autre sans ce droit est un refus tracé, pas un repli silencieux.
// Et la portée par cabinet (D5) : on ne compte que les cabinets où l'appelant est rattaché.

export type Demande = { periode?: string; praticien?: string; cabinet?: string }

export type Portee = {
  fenetre: Fenetre
  /** Les choix proposés dans les filtres. `praticiens` est vide pour qui ne voit que lui-même. */
  options: { praticiens: { id: string; nom: string }[]; cabinets: { id: string; nom: string }[] }
  choix: { periode: Periode; praticien: string; cabinet: string }
  /** `null` : tout le cabinet. */
  praticienIds: string[] | null
  siteIds: string[]
  noms: { praticiens: Map<string, string>; sites: Map<string, string> }
}

export const TOUS = 'tous'

export class SansFichePraticienError extends Error {
  constructor() {
    super('Aucune fiche praticien rattachée à ce compte : rien à compter.')
    this.name = 'SansFichePraticienError'
  }
}

const nomPraticien = (p: { titre: string; prenom: string; nom: string }) =>
  `${p.titre.startsWith('Chirurgien') ? 'Dr ' : ''}${p.prenom} ${p.nom}`

export async function resoudrePortee(ctx: AuthContext, demande: Demande, maintenant = new Date()): Promise<Portee> {
  await requirePermission(ctx, 'statistiques', 'read')
  const toutLeCabinet = hasPermission(ctx, 'statistiques', 'cabinet')

  const [praticiens, sites, moi] = await Promise.all([
    prisma.praticien.findMany({ select: { id: true, nom: true, prenom: true, titre: true, actif: true }, orderBy: { nom: 'asc' } }),
    prisma.site.findMany({
      where: { id: { in: [...ctx.sitesAutorises] } },
      select: { id: true, nom: true },
      orderBy: { nom: 'desc' },
    }),
    prisma.praticien.findUnique({ where: { userId: ctx.userId }, select: { id: true } }),
  ])

  const demandeAutre = demande.praticien && demande.praticien !== moi?.id
  if (demandeAutre && !toutLeCabinet) await requirePermission(ctx, 'statistiques', 'cabinet')

  let praticien: string
  if (toutLeCabinet) {
    praticien = praticiens.some((p) => p.id === demande.praticien) ? demande.praticien! : TOUS
  } else {
    if (!moi) throw new SansFichePraticienError()
    praticien = moi.id
  }

  const cabinet = sites.some((s) => s.id === demande.cabinet) ? demande.cabinet! : TOUS
  const periode = (PERIODES as readonly string[]).includes(demande.periode ?? '') ? (demande.periode as Periode) : '12m'

  return {
    fenetre: fenetreDe(periode, maintenant),
    options: {
      // Un praticien parti reste dans la liste : ses rendez-vous passés comptent toujours.
      praticiens: toutLeCabinet ? praticiens.map((p) => ({ id: p.id, nom: nomPraticien(p) })) : [],
      cabinets: sites,
    },
    choix: { periode, praticien, cabinet },
    praticienIds: praticien === TOUS ? null : [praticien],
    siteIds: cabinet === TOUS ? sites.map((s) => s.id) : [cabinet],
    noms: {
      praticiens: new Map(praticiens.map((p) => [p.id, nomPraticien(p)])),
      sites: new Map(sites.map((s) => [s.id, s.nom])),
    },
  }
}

function filtre(p: Portee): Prisma.RendezVousWhereInput {
  return { siteId: { in: p.siteIds }, ...(p.praticienIds ? { praticienId: { in: p.praticienIds } } : {}) }
}

async function lireRendezVous(p: Portee, par: 'debut' | 'createdAt' = 'debut'): Promise<RdvStat[]> {
  const f = p.fenetre
  const lignes = await prisma.rendezVous.findMany({
    where: {
      ...filtre(p),
      OR: [
        { [par]: { gte: f.debut, lt: f.fin } },
        { [par]: { gte: f.comparaison.debut, lt: f.comparaison.fin } },
      ],
    },
    select: {
      debut: true,
      fin: true,
      createdAt: true,
      statut: true,
      praticienId: true,
      siteId: true,
      fauteuilId: true,
      motifId: true,
      patientId: true,
      manquementCompte: true,
      reservationPublique: { select: { id: true } },
    },
  })
  return lignes.map((r) => ({
    debut: r.debut,
    fin: r.fin,
    creeLe: r.createdAt,
    statut: r.statut,
    praticienId: r.praticienId,
    siteId: r.siteId,
    fauteuilId: r.fauteuilId,
    motifId: r.motifId,
    patientId: r.patientId,
    manquement: r.manquementCompte,
    enLigne: r.reservationPublique !== null,
  }))
}

async function lireMotifs() {
  const motifs = await prisma.motifConsultation.findMany({ select: { id: true, libelle: true, estUrgence: true } })
  return new Map(motifs.map((m) => [m.id, m]))
}

export const ONGLETS = ['activite', 'motifs', 'absences', 'prise', 'remplissage', 'patients'] as const
export type Onglet = (typeof ONGLETS)[number]

// Chiffres agrégés, aucun nom de patient : une seule ligne de lecture au journal par onglet ouvert.
const tracer = (ctx: AuthContext, onglet: Onglet) => recordRead(ctx, 'statistiques', 1, onglet)

export async function lireActivite(ctx: AuthContext, demande: Demande, maintenant?: Date) {
  const portee = await resoudrePortee(ctx, demande, maintenant)
  const rdvs = await lireRendezVous(portee)
  await tracer(ctx, 'activite')
  return { portee, donnees: calculerActivite(portee.fenetre, rdvs, portee.noms) }
}

export async function lireStatistiquesMotifs(ctx: AuthContext, demande: Demande, maintenant?: Date) {
  const portee = await resoudrePortee(ctx, demande, maintenant)
  const [rdvs, motifs] = await Promise.all([lireRendezVous(portee), lireMotifs()])
  await tracer(ctx, 'motifs')
  return { portee, donnees: calculerMotifs(portee.fenetre, rdvs, motifs) }
}

export async function lireAbsences(ctx: AuthContext, demande: Demande, maintenant?: Date) {
  const portee = await resoudrePortee(ctx, demande, maintenant)
  const [rdvs, motifs, bloques] = await Promise.all([
    lireRendezVous(portee),
    lireMotifs(),
    // Patients dont la réservation en ligne est fermée, parmi ceux que l'appelant a déjà reçus.
    prisma.patient.count({ where: { reservationBloquee: true, rendezVous: { some: filtre(portee) } } }),
  ])
  await tracer(ctx, 'absences')
  return { portee, donnees: { ...calculerAbsences(portee.fenetre, rdvs, motifs), patientsBloques: bloques } }
}

export async function lirePrise(ctx: AuthContext, demande: Demande, maintenant?: Date) {
  const portee = await resoudrePortee(ctx, demande, maintenant)
  const f = portee.fenetre
  const [rdvs, motifs, proposes] = await Promise.all([
    lireRendezVous(portee, 'createdAt'),
    lireMotifs(),
    // Créneaux libérés envoyés aux inscrits de la liste d'attente pendant la période.
    prisma.envoiListeAttente.count({
      where: {
        statut: 'ENVOYE',
        envoyeLe: { gte: f.debut, lt: f.fin },
        siteId: { in: portee.siteIds },
        ...(portee.praticienIds ? { praticienId: { in: portee.praticienIds } } : {}),
      },
    }),
  ])
  await tracer(ctx, 'prise')
  return { portee, donnees: { ...calculerPrise(f, rdvs, motifs), proposesListeAttente: proposes } }
}

export async function lireRemplissage(ctx: AuthContext, demande: Demande, maintenant?: Date) {
  const portee = await resoudrePortee(ctx, demande, maintenant)
  const f = portee.fenetre
  const [plages, rdvs, fauteuils] = await Promise.all([
    prisma.plageDePresence.findMany({
      where: {
        siteId: { in: portee.siteIds },
        ...(portee.praticienIds ? { praticienId: { in: portee.praticienIds } } : {}),
        OR: [
          { debut: { gte: f.debut, lt: f.fin } },
          { debut: { gte: f.comparaison.debut, lt: f.comparaison.fin } },
        ],
      },
      select: { debut: true, fin: true, praticienId: true, siteId: true, fauteuilId: true },
    }),
    lireRendezVous(portee),
    prisma.fauteuil.findMany({ select: { id: true, nom: true } }),
  ])
  await tracer(ctx, 'remplissage')
  return {
    portee,
    donnees: calculerRemplissage(f, plages, rdvs, {
      sites: portee.noms.sites,
      fauteuils: new Map(fauteuils.map((x) => [x.id, x.nom])),
    }),
  }
}

export async function lirePatients(ctx: AuthContext, demande: Demande, maintenant = new Date()) {
  const portee = await resoudrePortee(ctx, demande, maintenant)
  const rdvs = await lireRendezVous(portee)

  // Dernière visite de chaque patient, dans la portée de l'appelant, toutes périodes confondues.
  const honores = { ...filtre(portee), debut: { lt: maintenant }, statut: { notIn: ['ABSENT', 'ANNULE', 'ANNULATION_DEMANDEE'] } } satisfies Prisma.RendezVousWhereInput
  const [visites, aVenir] = await Promise.all([
    prisma.rendezVous.groupBy({ by: ['patientId'], where: honores, _max: { debut: true } }),
    prisma.rendezVous.findMany({
      where: { ...filtre(portee), debut: { gte: maintenant }, statut: { notIn: ['ANNULE', 'ABSENT'] } },
      select: { patientId: true },
      distinct: ['patientId'],
    }),
  ])
  const ilYAUnAn = new Date(maintenant.getTime() - 365 * 86_400_000)
  const avecRendezVous = new Set(aVenir.map((r) => r.patientId))
  const perdusDeVue = visites.filter((v) => v._max.debut! < ilYAUnAn && !avecRendezVous.has(v.patientId)).length

  const fiches = await prisma.patient.findMany({
    where: { id: { in: visites.map((v) => v.patientId) } },
    select: { id: true, createdAt: true, dateNaissance: true },
  })

  await tracer(ctx, 'patients')
  return {
    portee,
    donnees: {
      ...calculerPatients(
        portee.fenetre,
        rdvs,
        new Map(fiches.map((p) => [p.id, p.createdAt])),
        new Map(fiches.map((p) => [p.id, p.dateNaissance])),
      ),
      perdusDeVue,
    },
  }
}
