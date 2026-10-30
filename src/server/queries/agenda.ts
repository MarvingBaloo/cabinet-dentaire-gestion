import 'server-only'

import { StatutRendezVous } from '@prisma/client'

import { jourLocal } from '@/lib/dates'
import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { exigerAccesSite, exigerPorteeGlobale, filtrePraticien, filtreSite } from '@/server/auth/portee'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// Lectures de l'agenda. Chaque fonction enchaîne trois choses, dans cet ordre :
// le garde de permission (ce qu'on a le droit de faire), le filtre de portée
// (où on a le droit de le voir), puis la trace d'audit. Les deux gardes sont
// distincts et cumulatifs — voir src/server/auth/portee.ts.
//
// ⚠ Toute requête ajoutée ici DOIT passer par `filtreSite` dès qu'elle touche
// une entité portant un `siteId`. Une lecture non filtrée est un défaut de
// sécurité, pas un oubli d'affichage (D5).

const RDV_CHAMPS = {
  id: true,
  debut: true,
  fin: true,
  statut: true,
  horsHoraire: true,
  surbooking: true,
  note: true,
  site: { select: { id: true, code: true, nom: true } },
  fauteuil: { select: { id: true, nom: true } },
  praticien: { select: { id: true, nom: true, prenom: true, couleur: true } },
  motif: { select: { id: true, libelle: true, couleur: true, estUrgence: true } },
  patient: { select: { id: true, nom: true, prenom: true, telephone: true } },
  // Posé par l'assistant des urgences (D77) : son niveau, ou celui du cabinet qui l'a corrigé.
  conversationAssistant: { select: { niveau: true, niveauCabinet: true } },
} as const

export type Intervalle = { debut: Date; fin: Date }

/**
 * Exclusions d'affichage demandées par la vue semaine (D58). Elles RESTREIGNENT
 * le résultat, n'élargissent jamais : toujours ajoutées sous `AND`, à côté de
 * `filtreSite` et du `siteId` vérifié, jamais à leur place.
 */
export type FiltresAffichage = {
  praticiensExclus?: string[] | undefined
  motifsExclus?: string[] | undefined
  statutsExclus?: StatutRendezVous[] | undefined
}

function clausesFiltres(filtres: FiltresAffichage | undefined) {
  const AND: Record<string, unknown>[] = []
  if (filtres?.praticiensExclus?.length) AND.push({ praticienId: { notIn: filtres.praticiensExclus } })
  if (filtres?.motifsExclus?.length) AND.push({ motifId: { notIn: filtres.motifsExclus } })
  if (filtres?.statutsExclus?.length) AND.push({ statut: { notIn: filtres.statutsExclus } })
  return AND.length ? { AND } : {}
}

/**
 * Rendez-vous d'une période, cantonnés aux sites de l'appelant.
 *
 * Le chevauchement est calculé par `debut < fin` ET `fin > debut` : un
 * rendez-vous qui déborde de la fenêtre demandée doit apparaître, sinon la vue
 * du jour perdrait celui commencé la veille à 23h. Comparer seulement `debut`
 * suffirait pour une semaine complète, et raterait exactement ce cas-là.
 */
export async function listerRendezVous(
  ctx: AuthContext,
  periode: Intervalle,
  options: { siteId?: string; praticienId?: string; filtres?: FiltresAffichage } = {},
) {
  await requirePermission(ctx, 'agenda', 'read')

  // Un site explicitement demandé est vérifié : sans ça, passer un siteId hors
  // portée contournerait le filtre, `where` n'étant qu'une conjonction.
  if (options.siteId) await exigerAccesSite(ctx, options.siteId)

  const rendezVous = await prisma.rendezVous.findMany({
    where: {
      ...filtreSite(ctx),
      ...(options.siteId ? { siteId: options.siteId } : {}),
      ...(options.praticienId ? { praticienId: options.praticienId } : {}),
      ...filtrePraticien(ctx),
      ...clausesFiltres(options.filtres),
      debut: { lt: periode.fin },
      fin: { gt: periode.debut },
    },
    select: RDV_CHAMPS,
    orderBy: [{ debut: 'asc' }, { fauteuilId: 'asc' }],
  })

  await recordRead(ctx, 'agenda', rendezVous.length)
  return rendezVous
}

/**
 * L'agenda d'un praticien sur une période, quel que soit le site où il
 * consulte — mais toujours restreint aux sites de l'appelant (D5).
 *
 * Ne fait que nommer l'usage : `listerRendezVous` applique déjà `filtreSite`
 * indépendamment du `praticienId` demandé, donc un compte mono-site qui
 * demande l'agenda d'un praticien présent sur les deux cabinets ne reçoit que
 * ses rendez-vous sur son propre site — jamais ceux de l'autre.
 */
export async function listerRendezVousPraticien(
  ctx: AuthContext,
  praticienId: string,
  periode: Intervalle,
  filtres?: FiltresAffichage,
) {
  return listerRendezVous(ctx, periode, { praticienId, ...(filtres ? { filtres } : {}) })
}

/**
 * Vue consolidée des deux cabinets : les rendez-vous de TOUS les sites sur la
 * période, sans filtre de portée. Réservée à qui voit déjà les deux sites
 * (`exigerPorteeGlobale`) — un compte mono-site qui la demande est refusé,
 * jamais silencieusement ramené à son propre site (lot 4).
 */
export async function listerRendezVousConsolide(ctx: AuthContext, periode: Intervalle, filtres?: FiltresAffichage) {
  await requirePermission(ctx, 'agenda', 'read')
  await exigerPorteeGlobale(ctx)

  const rendezVous = await prisma.rendezVous.findMany({
    where: {
      ...clausesFiltres(filtres),
      debut: { lt: periode.fin },
      fin: { gt: periode.debut },
    },
    select: RDV_CHAMPS,
    orderBy: [{ debut: 'asc' }, { siteId: 'asc' }, { fauteuilId: 'asc' }],
  })

  await recordRead(ctx, 'agenda', rendezVous.length)
  return rendezVous
}

/**
 * Nombre de rendez-vous actifs par jour sur une période — pour le calendrier
 * mensuel. Compte plutôt que charge : seul `debut` est sélectionné, aucune
 * donnée patient ni motif (minimisation RGPD) — la vue mensuelle n'a besoin
 * que d'un chiffre par jour, pas du détail.
 *
 * `ANNULE` ET `ABSENT` sont exclus tous les deux : comme le documente `OCCUPE`
 * dans `services/agenda.ts` (« Annulé et absent le libèrent »), aucun des deux
 * n'occupe plus le créneau — ce compte reflète l'activité tenue ou à venir,
 * pas ce qui s'est délié. Décision prise ici, à confirmer par le cabinet si
 * elle surprend à l'usage : un rendez-vous marqué absent a quand même occupé
 * un fauteuil jusqu'au constat, l'inverse serait tout aussi défendable.
 */
export async function compterRendezVousParJour(
  ctx: AuthContext,
  periode: Intervalle,
  options: { siteId?: string } = {},
): Promise<Map<string, number>> {
  await requirePermission(ctx, 'agenda', 'read')
  if (options.siteId) await exigerAccesSite(ctx, options.siteId)

  const rendezVous = await prisma.rendezVous.findMany({
    where: {
      ...filtreSite(ctx),
      ...(options.siteId ? { siteId: options.siteId } : {}),
      ...filtrePraticien(ctx),
      statut: { notIn: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT] },
      debut: { lt: periode.fin },
      fin: { gt: periode.debut },
    },
    select: { debut: true },
  })

  await recordRead(ctx, 'agenda', rendezVous.length)

  const comptes = new Map<string, number>()
  for (const { debut } of rendezVous) {
    const jour = jourLocal(debut)
    comptes.set(jour, (comptes.get(jour) ?? 0) + 1)
  }
  return comptes
}

export async function lireRendezVous(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'agenda', 'read')

  const rdv = await prisma.rendezVous.findFirst({
    // Le filtre de portée est DANS la requête, et non appliqué au résultat : un
    // rendez-vous hors portée doit être introuvable, pas trouvé puis masqué.
    where: { id, ...filtreSite(ctx), ...filtrePraticien(ctx) },
    select: RDV_CHAMPS,
  })

  // Tracé même quand rien n'est trouvé : une série de lectures sur des
  // identifiants inexistants est un motif de balayage.
  await recordRead(ctx, 'agenda', rdv ? 1 : 0, id)
  return rdv
}

/**
 * Tout ce que la fiche d'un rendez-vous affiche, ouverte d'un clic dans
 * l'agenda : le patient (âge, téléphone, absences), l'origine du rendez-vous,
 * la demande d'annulation en cours, et ce que l'appelant a le droit d'en faire.
 * Même garde que `lireRendezVous` : hors portée, le rendez-vous est introuvable.
 */
export async function lireFicheRendezVous(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'agenda', 'read')

  const rdv = await prisma.rendezVous.findFirst({
    where: { id, ...filtreSite(ctx), ...filtrePraticien(ctx) },
    select: {
      ...RDV_CHAMPS,
      createdAt: true,
      annulationDemandeeLe: true,
      montantCentimes: true,
      motif: { select: { id: true, libelle: true, couleur: true, estUrgence: true, prixCentimes: true } },
      praticien: { select: { id: true, nom: true, prenom: true, couleur: true, userId: true } },
      patient: {
        select: { id: true, nom: true, prenom: true, telephone: true, dateNaissance: true, manquements: true },
      },
      reservationPublique: { select: { id: true } },
      annulationDemandeePar: { select: { prenom: true, nom: true } },
      conversationAssistant: {
        select: { niveau: true, niveauCabinet: true, resume: true, messages: true, raison: true, createdAt: true },
      },
    },
  })
  await recordRead(ctx, 'agenda', rdv ? 1 : 0, id)
  if (!rdv) return null

  const sonPraticien = rdv.praticien.userId === ctx.userId
  return {
    rdv,
    droits: {
      // Mêmes règles que les services, lues ici pour n'afficher que les gestes possibles :
      // le praticien du rendez-vous annule, les autres demandent (D17) ; le praticien
      // concerné ou un compte à portée globale tranche une demande.
      annuleDirectement: sonPraticien,
      tranche: ctx.permissions.has('agenda:valider') && (ctx.porteeGlobale || sonPraticien),
      modifie: ctx.permissions.has('agenda:update'),
      annule: ctx.permissions.has('agenda:delete'),
    },
  }
}

/** Présences des praticiens sur une période, cantonnées aux sites de l'appelant. */
export async function listerPresences(ctx: AuthContext, periode: Intervalle, options: { siteId?: string } = {}) {
  await requirePermission(ctx, 'presence', 'read')
  if (options.siteId) await exigerAccesSite(ctx, options.siteId)

  const presences = await prisma.plageDePresence.findMany({
    where: {
      ...filtreSite(ctx),
      ...(options.siteId ? { siteId: options.siteId } : {}),
      debut: { lt: periode.fin },
      fin: { gt: periode.debut },
    },
    select: {
      id: true,
      debut: true,
      fin: true,
      site: { select: { id: true, code: true, nom: true } },
      fauteuil: { select: { id: true, nom: true } },
      praticien: { select: { id: true, nom: true, prenom: true, couleur: true } },
    },
    orderBy: [{ debut: 'asc' }],
  })

  await recordRead(ctx, 'presence', presences.length)
  return presences
}

/** Congés, fériés, pauses et créneaux gardés pour les urgences. */
export async function listerIndisponibilites(ctx: AuthContext, periode: Intervalle) {
  await requirePermission(ctx, 'agenda', 'read')

  const indisponibilites = await prisma.indisponibilite.findMany({
    where: {
      // Une indisponibilité visant un praticien n'a pas de site : elle le suit
      // partout. La restreindre par site la ferait disparaître de la vue, et un
      // congé invisible est pire qu'un congé mal placé.
      OR: [{ siteId: null }, filtreSite(ctx)],
      debut: { lt: periode.fin },
      fin: { gt: periode.debut },
    },
    select: {
      id: true,
      type: true,
      debut: true,
      fin: true,
      motif: true,
      site: { select: { id: true, code: true } },
      praticien: { select: { id: true, nom: true, prenom: true } },
    },
    orderBy: [{ debut: 'asc' }],
  })

  await recordRead(ctx, 'agenda', indisponibilites.length)
  return indisponibilites
}

/**
 * Fauteuils des sites de l'appelant.
 *
 * Pas de permission `fauteuil:*` : le fauteuil n'est pas une ressource qu'on
 * administre en phase 2, il se lit avec l'agenda auquel il appartient.
 */
export async function listerFauteuils(ctx: AuthContext) {
  await requirePermission(ctx, 'agenda', 'read')

  const fauteuils = await prisma.fauteuil.findMany({
    where: { actif: true, ...filtreSite(ctx) },
    select: { id: true, nom: true, site: { select: { id: true, code: true, nom: true } } },
    orderBy: [{ siteId: 'asc' }, { nom: 'asc' }],
  })

  await recordRead(ctx, 'agenda', fauteuils.length)
  return fauteuils
}

/**
 * Catalogue des motifs, avec la durée propre à chaque praticien.
 *
 * Aucun `siteId` : un motif n'appartient pas à un site, il n'y a donc rien à
 * cloisonner. `filtreSite` n'a pas sa place ici, et l'absence est délibérée.
 */
export async function listerMotifs(ctx: AuthContext, options: { inclureInactifs?: boolean } = {}) {
  await requirePermission(ctx, 'motif', 'read')

  const motifs = await prisma.motifConsultation.findMany({
    where: options.inclureInactifs ? {} : { actif: true },
    select: {
      id: true,
      libelle: true,
      couleur: true,
      estUrgence: true,
      dureeIndicative: true,
      actif: true,
      ordre: true,
      praticiens: { select: { praticienId: true, dureeMinutes: true } },
    },
    orderBy: [{ ordre: 'asc' }, { libelle: 'asc' }],
  })

  await recordRead(ctx, 'motif', motifs.length)
  return motifs
}

/**
 * Praticiens actifs.
 *
 * Sans cloisonnement : un praticien n'appartient pas à un site, il s'y rend. La
 * secrétaire de Marie-Galante doit pouvoir nommer le confrère qui consulte en
 * Guadeloupe, ne serait-ce que pour orienter un patient. Ce qu'elle ne verra
 * pas, ce sont ses rendez-vous.
 */
export async function listerPraticiens(ctx: AuthContext) {
  await requirePermission(ctx, 'praticien', 'read')

  const praticiens = await prisma.praticien.findMany({
    where: { actif: true },
    select: {
      id: true,
      nom: true,
      prenom: true,
      titre: true,
      couleur: true,
      motifs: { select: { motifId: true, dureeMinutes: true } },
    },
    orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
  })

  await recordRead(ctx, 'praticien', praticiens.length)
  return praticiens
}

/**
 * Durée d'un acte pour un praticien donné, en minutes.
 *
 * Renvoie `null` si le praticien ne pratique pas ce motif — ce n'est pas une
 * erreur mais une réponse : chacun a son périmètre, et l'appelant doit pouvoir
 * refuser le rendez-vous plutôt que se rabattre sur une durée par défaut.
 */
export async function dureePour(ctx: AuthContext, praticienId: string, motifId: string): Promise<number | null> {
  await requirePermission(ctx, 'agenda', 'read')

  const lien = await prisma.praticienMotif.findUnique({
    where: { praticienId_motifId: { praticienId, motifId } },
    select: { dureeMinutes: true },
  })

  return lien?.dureeMinutes ?? null
}

/**
 * Le menu patient TEL QU'IL EST, pour l'écran de paramétrage.
 *
 * Contrairement à la lecture publique, celle-ci ne cache rien : les entrées
 * désactivées et celles sans acte rattaché doivent se voir, sans quoi le cabinet
 * ne saurait pas pourquoi une entrée n'apparaît pas sur son site.
 *
 * Aucun `filtreSite` : le menu est le même pour les deux cabinets.
 */
export async function listerMotifsPatientAdmin(ctx: AuthContext) {
  await requirePermission(ctx, 'motif', 'read')

  const entrees = await prisma.motifPatient.findMany({
    where: { parentId: null },
    orderBy: { ordre: 'asc' },
    select: {
      id: true,
      libelle: true,
      aide: true,
      ordre: true,
      actif: true,
      motif: { select: { id: true, libelle: true } },
      enfants: {
        orderBy: { ordre: 'asc' },
        select: {
          id: true,
          libelle: true,
          aide: true,
          ordre: true,
          actif: true,
          motif: { select: { id: true, libelle: true } },
        },
      },
    },
  })

  await recordRead(ctx, 'motif', entrees.length)
  return entrees
}

/**
 * Demandes d'annulation en attente, pour l'encart du tableau de bord (D17,
 * retournée le 2026-09-23).
 *
 * Réservée à qui peut trancher — `agenda:valider` — donc au rôle global et aux
 * praticiens : un compte sans `Praticien` associé et sans portée globale ne
 * pourrait rien y faire, la liste serait vide, autant ne pas l'afficher.
 *
 * Un praticien ne voit QUE ses propres demandes : c'est lui qui décide, pas le
 * confrère qui partage le même droit `agenda:valider`. La portée globale (ADMIN) voit tout, dans la limite de `filtreSite`.
 */
export async function lireDemandesAnnulationEnAttente(ctx: AuthContext) {
  await requirePermission(ctx, 'agenda', 'valider')

  const monPraticien = await prisma.praticien.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })

  // Ni portée globale, ni praticien : rien à décider, rien à montrer — plutôt
  // qu'une liste vide silencieuse, l'appelant (le tableau de bord) choisit de
  // ne pas afficher l'encart du tout.
  if (!ctx.porteeGlobale && !monPraticien) return []

  const demandes = await prisma.rendezVous.findMany({
    where: {
      statut: StatutRendezVous.ANNULATION_DEMANDEE,
      ...filtreSite(ctx),
      ...(monPraticien ? { praticienId: monPraticien.id } : {}),
    },
    select: {
      id: true,
      debut: true,
      fin: true,
      site: { select: { id: true, nom: true } },
      praticien: { select: { id: true, nom: true, prenom: true } },
      patient: { select: { id: true, nom: true, prenom: true } },
      annulationDemandeeLe: true,
      annulationDemandeePar: { select: { nom: true, prenom: true, email: true } },
    },
    orderBy: { annulationDemandeeLe: 'asc' },
  })

  await recordRead(ctx, 'agenda', demandes.length)
  return demandes
}

/**
 * La liste d'attente, en lecture seule, pour le personnel (lot D, D29).
 *
 * Filtrée par site (D5) : une secrétaire de la Guadeloupe ne voit pas les
 * inscrits de Marie-Galante. Aucun numéro de téléphone dans la sélection — ce
 * qui suit le numéro reste le jeton de l'accès patient, pas cet écran.
 */
export async function lireListeAttente(ctx: AuthContext) {
  await requirePermission(ctx, 'agenda', 'read')

  const inscriptions = await prisma.inscriptionListeAttente.findMany({
    where: { expiresAt: { gt: new Date() }, ...filtreSite(ctx) },
    select: {
      id: true,
      createdAt: true,
      avantLe: true,
      telephone: true,
      site: { select: { id: true, code: true, nom: true } },
      motif: { select: { libelle: true } },
      praticien: { select: { nom: true, prenom: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Le nom se retrouve par le numéro vérifié à l'inscription (D23) ; le numéro,
  // lui, ne quitte pas le serveur. Deux fiches peuvent partager un numéro (une
  // famille) : les deux noms sont rendus.
  const fiches = inscriptions.length
    ? await prisma.patient.findMany({
        where: { actif: true, telephone: { in: [...new Set(inscriptions.map((i) => i.telephone))] } },
        select: { telephone: true, nom: true, prenom: true },
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      })
    : []

  await recordRead(ctx, 'liste_attente', inscriptions.length)
  return inscriptions.map(({ telephone, ...i }) => ({
    ...i,
    patients: fiches.filter((f) => f.telephone === telephone).map((f) => `${f.prenom} ${f.nom}`),
  }))
}
