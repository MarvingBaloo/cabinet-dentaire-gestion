import 'server-only'

import { CanalNotification, type NiveauUrgence, Prisma, StatutRendezVous, TypeNotification } from '@prisma/client'

import type { AuthContext } from '@/server/auth/context'
import { PermissionDeniedError, requirePermission } from '@/server/auth/permissions'
import { exigerAccesSite, filtrePraticien, filtreSite } from '@/server/auth/portee'
import { recordAudit, recordSystemAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import { avecRepriseSurInterblocage, estChevauchementBase, estInterblocage } from '@/server/db/conflits'
import {
  type AuteurStatut,
  type Violation,
  calculerFin,
  compteUnManquement,
  expliquer,
  reservationFermee,
  verifierCreneau,
} from '@/server/domaine/agenda'
import { cleIdempotence, emettre } from '@/server/notifications/file'
import { rendreMessage } from '@/server/notifications/messages'
import { creneauLibere } from '@/server/services/liste-attente'
import type {
  AnnulerRendezVousInput,
  ChangerStatutInput,
  CreerPatientInput,
  CreerRendezVousInput,
  DeplacerRendezVousInput,
  DupliquerRendezVousInput,
  RefuserAnnulationInput,
  ValiderAnnulationInput,
} from '@/server/validation/agenda'

// Mutations de l'agenda.
//
// Chaque fonction suit le même enchaînement : permission (ce qu'on a le droit de
// faire), portée (où), règles du domaine (ce qui est vrai du cabinet), puis
// écriture et trace dans la MÊME transaction — il n'existe pas d'écriture sans
// sa trace, même si le processus meurt entre les deux (D9).
//
// La base reste le dernier arbitre : ses contraintes d'exclusion rattrapent la
// réservation concurrente que nulle vérification préalable ne peut prévenir
// (D12). Le domaine, lui, sert à refuser AVANT d'écrire, avec un motif lisible.

export class CreneauRefuseError extends Error {
  constructor(readonly violations: Violation[]) {
    super(expliquer(violations))
    this.name = 'CreneauRefuseError'
  }
}

export class ActeNonPratiqueError extends Error {
  constructor() {
    super('Ce praticien ne pratique pas cet acte.')
    this.name = 'ActeNonPratiqueError'
  }
}

export class ReserveAuPraticienError extends Error {
  constructor(readonly quoi: 'surbooking' | 'horsHoraire') {
    super(
      quoi === 'surbooking'
        ? 'Seul le praticien de cet agenda peut ajouter une urgence sur un planning complet.'
        : 'Seul le praticien de cet agenda peut poser un rendez-vous hors des horaires d’ouverture.',
    )
    this.name = 'ReserveAuPraticienError'
  }
}

/** Réservation concurrente : deux saisies valides séparément, incompatibles ensemble. */
export class CreneauPrisEntretempsError extends Error {
  constructor() {
    super('Ce créneau vient d’être pris. Rafraîchissez l’agenda.')
    this.name = 'CreneauPrisEntretempsError'
  }
}

/**
 * Une demande d'annulation est déjà en attente sur ce rendez-vous.
 *
 * Levée qu'on tente de la redemander ou de faire avancer le rendez-vous par le
 * menu de statut ordinaire : tant qu'elle est en attente, seules `validerAnnulation`
 * et `refuserAnnulation` peuvent en sortir (D17, retournée le 2026-09-23).
 */
export class AnnulationDejaDemandeeError extends Error {
  constructor() {
    super("Une demande d'annulation est déjà en attente sur ce rendez-vous.")
    this.name = 'AnnulationDejaDemandeeError'
  }
}

/** Le rendez-vous visé n'a pas de demande d'annulation en attente. */
export class AucuneAnnulationEnAttenteError extends Error {
  constructor() {
    super("Ce rendez-vous n'a pas de demande d'annulation en attente.")
    this.name = 'AucuneAnnulationEnAttenteError'
  }
}

/**
 * Valider ou refuser une demande est réservé au praticien DU rendez-vous, ou à
 * un administrateur (D17, retournée le 2026-09-23) — même pour un autre
 * praticien, qui porte pourtant la permission `agenda:valider`. La restriction est une règle métier, pas une permission :
 * elle se juge instance par instance, ici, pas dans la matrice des rôles.
 */
export class AnnulationReserveeAuPraticienError extends Error {
  constructor() {
    super('Seul le praticien du rendez-vous, ou un administrateur, peut trancher cette demande.')
    this.name = 'AnnulationReserveeAuPraticienError'
  }
}

/**
 * Statuts qui occupent réellement un créneau. Annulé et absent le libèrent.
 *
 * `ANNULATION_DEMANDEE` y figure : tant qu'elle est en attente, le créneau
 * n'est ni libéré ni proposé à personne (D17, retournée le 2026-09-23) — le
 * rendez-vous peut encore être confirmé, la demande refusée.
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

/**
 * L'urgence sur planning plein (Q19) et le hors-horaires (Q23) reviennent au praticien DE CET AGENDA, pas à
 * n'importe quel praticien : le Dr Martin ne glisse pas une urgence dans le planning plein du Dr Bastien
 * (Marving, 21/10). L'administration n'y donne aucun droit non plus.
 */
async function estPraticienDe(ctx: AuthContext, praticienId: string): Promise<boolean> {
  if (!ctx.roles.includes('PRATICIEN')) return false
  return (await praticienDuCompte(ctx))?.id === praticienId
}

/**
 * Le `Praticien` lié à ce compte, s'il y en a un.
 *
 * Un compte SECRETAIRE ou ASSISTANTE n'en a pas (`null`). Un compte PRATICIEN
 * peut aussi ne pas en avoir dans les fixtures de test — la relation est
 * facultative dans les deux sens (D16) — d'où le retour `null` plutôt qu'une
 * exception : l'appelant décide de ce que « pas de praticien » signifie pour lui.
 */
async function praticienDuCompte(ctx: AuthContext): Promise<{ id: string } | null> {
  return prisma.praticien.findUnique({ where: { userId: ctx.userId }, select: { id: true } })
}

/** Charge ce que le domaine doit connaître pour juger un créneau.
 *  Exporté : la réservation publique juge le même créneau avec les mêmes
 *  éléments, et deux chargements distincts finiraient par diverger. */
export async function chargerContexteCreneau(siteId: string, debut: Date, fin: Date) {
  // Fenêtre élargie d'une journée de part et d'autre : une plage de présence ou
  // un congé peut commencer la veille et couvrir le créneau demandé.
  const large = { debut: new Date(debut.getTime() - 86_400_000), fin: new Date(fin.getTime() + 86_400_000) }

  const [presences, indisponibilites, rendezVous] = await Promise.all([
    prisma.plageDePresence.findMany({
      // Un cabinet décoché (D74) n'a plus de présence : tout créneau y est refusé, réservation en ligne comprise.
      where: { siteId, site: { actif: true }, debut: { lt: large.fin }, fin: { gt: large.debut } },
      select: { praticienId: true, siteId: true, fauteuilId: true, debut: true, fin: true },
    }),
    prisma.indisponibilite.findMany({
      where: {
        OR: [{ siteId }, { siteId: null }],
        debut: { lt: large.fin },
        fin: { gt: large.debut },
      },
      select: { type: true, praticienId: true, siteId: true, debut: true, fin: true },
    }),
    prisma.rendezVous.findMany({
      where: { siteId, debut: { lt: fin }, fin: { gt: debut } },
      select: { id: true, praticienId: true, fauteuilId: true, debut: true, fin: true, statut: true, surbooking: true },
    }),
  ])

  return {
    presences,
    indisponibilites,
    rendezVous: rendezVous.map((r) => ({
      id: r.id,
      praticienId: r.praticienId,
      fauteuilId: r.fauteuilId,
      debut: r.debut,
      fin: r.fin,
      // Un rendez-vous en surbooking n'occupe pas le créneau au sens des règles :
      // il y a été ajouté en connaissance de cause et ne doit pas bloquer autrui.
      compteDansLOccupation: OCCUPE.includes(r.statut) && !r.surbooking,
    })),
  }
}

export type ApercuCreneau =
  | { ok: true; debut: Date; fin: Date; duree: number; fauteuil: string }
  | { ok: false; duree: number | null; raison: string; planningPlein: boolean }

/**
 * Le verdict qu'aurait la création, sans rien créer : le récapitulatif de
 * l'écran « Nouveau rendez-vous » l'affiche pendant la saisie (maquettes du
 * 13/10). Mêmes étapes que `creerRendezVous` — durée du couple praticien ×
 * motif, présences, congés, chevauchements, fauteuil déduit (D11) — pour que
 * l'aperçu ne puisse jamais promettre ce que l'enregistrement refuserait.
 * L'enregistrement revérifie tout : l'aperçu n'autorise rien.
 */
export async function apercuCreneau(
  ctx: AuthContext,
  input: Omit<CreerRendezVousInput, 'patientId' | 'note'>,
): Promise<ApercuCreneau> {
  await requirePermission(ctx, 'agenda', 'read')
  await exigerAccesSite(ctx, input.siteId)

  if (input.surbooking && !(await estPraticienDe(ctx, input.praticienId))) {
    return { ok: false, duree: null, raison: new ReserveAuPraticienError('surbooking').message, planningPlein: true }
  }

  const motif = await prisma.motifConsultation.findUniqueOrThrow({
    where: { id: input.motifId },
    select: { estUrgence: true, actif: true },
  })
  const lien = await prisma.praticienMotif.findUnique({
    where: { praticienId_motifId: { praticienId: input.praticienId, motifId: input.motifId } },
    select: { dureeMinutes: true },
  })
  const duree = input.dureeMinutes ?? lien?.dureeMinutes
  if (!motif.actif) return { ok: false, duree: null, raison: 'Ce motif de consultation est désactivé.', planningPlein: false }
  if (duree === undefined) return { ok: false, duree: null, raison: new ActeNonPratiqueError().message, planningPlein: false }

  const debut = input.debut
  const fin = calculerFin(debut, duree)
  const verdict = verifierCreneau(
    {
      praticienId: input.praticienId,
      siteId: input.siteId,
      debut,
      fin,
      motifEstUrgence: motif.estUrgence,
      surbooking: input.surbooking,
      horsHoraire: input.horsHoraire,
    },
    await chargerContexteCreneau(input.siteId, debut, fin),
  )
  if (!verdict.ok) {
    return {
      ok: false,
      duree,
      raison: expliquer(verdict.violations),
      planningPlein: verdict.violations.some(
        (v) => v.code === 'CHEVAUCHEMENT_FAUTEUIL' || v.code === 'CHEVAUCHEMENT_PRATICIEN',
      ),
    }
  }

  const fauteuil = await prisma.fauteuil.findUniqueOrThrow({ where: { id: verdict.fauteuilId }, select: { nom: true } })
  return { ok: true, debut, fin, duree, fauteuil: fauteuil.nom }
}

export async function creerRendezVous(
  ctx: AuthContext,
  input: CreerRendezVousInput,
  // Métadonnée d'audit ajoutée par un appelant interne (`dupliquerRendezVous`,
  // ci-dessous) — jamais renseignée depuis un formulaire. Ni permission, ni
  // portée, ni règle du domaine n'en dépendent : c'est un simple complément de
  // trace, pour ne PAS dupliquer la logique de création (D11) rien que pour
  // savoir d'où vient une copie.
  metadataSupplementaire?: Record<string, Prisma.InputJsonValue>,
) {
  await requirePermission(ctx, 'agenda', 'create')
  await exigerAccesSite(ctx, input.siteId)

  // Deux privilèges qui ne sont pas des permissions mais des règles métier : le
  // cabinet les a réservés au praticien, et un droit `agenda:create` ne doit pas
  // les emporter avec lui.
  if (input.surbooking && !(await estPraticienDe(ctx, input.praticienId))) {
    throw new ReserveAuPraticienError('surbooking')
  }
  if (input.horsHoraire && !(await estPraticienDe(ctx, input.praticienId))) {
    throw new ReserveAuPraticienError('horsHoraire')
  }

  const motif = await prisma.motifConsultation.findUniqueOrThrow({
    where: { id: input.motifId },
    select: { id: true, estUrgence: true, actif: true },
  })
  if (!motif.actif) throw new Error('Ce motif de consultation est désactivé.')

  // La durée vient du couple praticien × motif (D14). Son absence signifie que
  // le praticien ne pratique pas cet acte — une réponse, pas une panne.
  const lien = await prisma.praticienMotif.findUnique({
    where: { praticienId_motifId: { praticienId: input.praticienId, motifId: input.motifId } },
    select: { dureeMinutes: true },
  })
  const duree = input.dureeMinutes ?? lien?.dureeMinutes
  if (duree === undefined) throw new ActeNonPratiqueError()

  const debut = input.debut
  const fin = calculerFin(debut, duree)

  const connu = await chargerContexteCreneau(input.siteId, debut, fin)
  const verdict = verifierCreneau(
    {
      praticienId: input.praticienId,
      siteId: input.siteId,
      debut,
      fin,
      motifEstUrgence: motif.estUrgence,
      surbooking: input.surbooking,
      horsHoraire: input.horsHoraire,
    },
    connu,
  )
  if (!verdict.ok) throw new CreneauRefuseError(verdict.violations)

  try {
    return await avecRepriseSurInterblocage(() => prisma.$transaction(async (tx) => {
      const rdv = await tx.rendezVous.create({
        data: {
          patientId: input.patientId,
          praticienId: input.praticienId,
          siteId: input.siteId,
          fauteuilId: verdict.fauteuilId,
          motifId: input.motifId,
          debut,
          fin,
          note: input.note ?? null,
          surbooking: input.surbooking,
          horsHoraire: input.horsHoraire,
        },
        select: { id: true, debut: true, fin: true, statut: true },
      })

      await recordAudit(tx, ctx, {
        action: 'CREATE',
        entityType: 'agenda',
        entityId: rdv.id,
        // ⚠ Aucune donnée de santé : ni nom de patient, ni motif en clair. Le
        // journal peut être exporté ou consulté plus largement que sa source.
        metadata: {
          siteId: input.siteId,
          praticienId: input.praticienId,
          surbooking: input.surbooking,
          horsHoraire: input.horsHoraire,
          ...metadataSupplementaire,
        },
      })

      return rdv
    }))
  } catch (e) {
    if (estChevauchementBase(e) || estInterblocage(e)) throw new CreneauPrisEntretempsError()
    throw e
  }
}

/**
 * Duplique un rendez-vous (lot 5) : même patient, motif et praticien que la
 * source — non modifiables ici, pour changer l'un des trois on crée un
 * rendez-vous normal —, nouvelle date/heure à choisir.
 *
 * Délègue ENTIÈREMENT à `creerRendezVous` une fois la source relue : c'est elle
 * qui porte toutes les règles (D11), l'atomicité (D12), le blocage patient, et
 * qui refuse `surbooking`/`horsHoraire` à qui n'est pas praticien — aucune n'est
 * redite ici. Ni l'un ni l'autre ne s'appliquent à une copie : reprendre un
 * rendez-vous n'est ni une urgence glissée sur un planning plein, ni un geste
 * hors des horaires d'ouverture, ce sont deux décisions distinctes que la
 * personne qui duplique n'a pas prises.
 *
 * Le site suit la source, il ne se choisit pas dans ce formulaire — le fauteuil
 * en découlera comme pour toute création (présence du praticien ce jour-là,
 * Q9). Les horaires de bateau interdisent à un praticien de tenir les deux
 * sites le même jour : si la nouvelle date tombe un jour où il n'est pas sur ce
 * site-là, `creerRendezVous` refuse déjà (`PRATICIEN_ABSENT`) — exactement le
 * refus qu'une saisie manuelle recevrait, rien de plus à écrire ici.
 *
 * La durée n'est pas reprise de la source : en ne la passant pas, `creerRendezVous`
 * la relit sur le couple praticien × motif au moment de la copie (D14), comme
 * pour une création ordinaire — la source a pu dater d'avant un changement de
 * durée.
 *
 * La note n'est PAS héritée : un mot pris pour la venue précédente (« patient en
 * retard », « a annulé une fois ») ne dit rien de la prochaine, et le reporter
 * par défaut la ferait mentir plus souvent qu'il n'aiderait — choix délibéré,
 * pas un oubli.
 *
 * Source acceptée dans N'IMPORTE QUEL statut, y compris `TERMINE`, `ABSENT` ou
 * `ANNULE` : c'est précisément l'usage voulu, reprendre un rendez-vous honoré
 * ou manqué, pas seulement un rendez-vous encore à venir. Aucune raison
 * métier de le restreindre : la nouvelle copie repart de zéro, `A_CONFIRMER`
 * (Q26), indépendamment de ce qu'est devenue la source.
 *
 * Portée (D5) vérifiée deux fois, et c'est voulu : une première fois ici sur le
 * site de la SOURCE (`filtreSite` dans la lecture — sans lui, un compte hors
 * périmètre apprendrait qu'un identifiant existe), une seconde fois par
 * `creerRendezVous` sur le site D'ARRIVÉE (qui est le même ici, le site n'étant
 * pas un choix de ce formulaire) : la seconde n'est pas redondante en soi, elle
 * deviendrait la seule pertinente si ce formulaire proposait un jour un site
 * différent de celui de la source.
 */
export async function dupliquerRendezVous(ctx: AuthContext, input: DupliquerRendezVousInput) {
  // Même permission que la création : dupliquer EN EST une.
  await requirePermission(ctx, 'agenda', 'create')

  const source = await prisma.rendezVous.findFirst({
    where: { id: input.id, ...filtreSite(ctx) },
    select: { id: true, patientId: true, praticienId: true, motifId: true, siteId: true },
  })
  if (!source) throw new Error('Rendez-vous introuvable.')

  return creerRendezVous(
    ctx,
    {
      patientId: source.patientId,
      praticienId: source.praticienId,
      motifId: source.motifId,
      siteId: source.siteId,
      debut: input.debut,
      surbooking: false,
      horsHoraire: false,
    },
    { dupliqueDe: source.id },
  )
}

/** Rien à défaire : le « Annuler » du bandeau ne correspond plus au dernier déplacement de ce rendez-vous. */
export class RetourImpossibleError extends Error {
  constructor() {
    super('Ce déplacement ne peut plus être annulé : déplacez le rendez-vous à la main.')
    this.name = 'RetourImpossibleError'
  }
}

/**
 * Le SMS « votre rendez-vous a changé » part cinq minutes après le déplacement (23/10) : le temps d'annuler une
 * fausse manœuvre sans que le patient en sache rien. Plusieurs déplacements d'affilée n'envoient que le dernier :
 * à l'envoi, la file abandonne un message dont l'horaire n'est plus celui du rendez-vous (`rendezVousToujoursValide`).
 */
export const DELAI_AVANT_SMS_DE_DEPLACEMENT_MS = 5 * 60_000
/** Le bandeau « Annuler » d'un glisser-déposer dure quelques secondes ; au-delà, on déplace à la main. */
const DELAI_RETOUR_ARRIERE_MS = 2 * 60_000

/**
 * Déplace un rendez-vous (formulaire « Décaler à », glisser-déposer). Le patient est prévenu par SMS quand l'heure
 * change d'un rendez-vous qu'il attend encore (Marving, 23/10 — comme l'annulation par le cabinet, D70).
 *
 * `retourArriere` : le « Annuler » du bandeau qui suit un glisser-déposer. Il remet le rendez-vous à la place qu'il
 * occupait juste avant le dernier déplacement fait par CET utilisateur, sans SMS — le patient n'a pas encore été
 * prévenu du premier, et ne doit pas l'être d'un aller-retour. Refusé s'il ne s'agit pas de ce retour-là : sans
 * cette garde, l'option servirait à déplacer n'importe quel rendez-vous en silence.
 */
export async function deplacerRendezVous(
  ctx: AuthContext,
  input: DeplacerRendezVousInput,
  options: { retourArriere?: boolean } = {},
) {
  await requirePermission(ctx, 'agenda', 'update')

  const actuel = await prisma.rendezVous.findFirst({
    where: { id: input.id, ...filtreSite(ctx), ...filtrePraticien(ctx) },
    select: {
      id: true, siteId: true, praticienId: true, motifId: true, debut: true, fin: true, fauteuilId: true, note: true,
      updatedAt: true, surbooking: true, horsHoraire: true, statut: true, motif: { select: { estUrgence: true } },
      patient: { select: { telephone: true, prenom: true } },
      site: { select: { nom: true, adresse: true } },
    },
  })
  if (!actuel) throw new Error('Rendez-vous introuvable.')

  if (options.retourArriere) {
    const dernier = await prisma.auditLog.findFirst({
      where: { action: 'UPDATE', entityType: 'agenda', entityId: actuel.id },
      orderBy: { occurredAt: 'desc' },
      select: { actorId: true, occurredAt: true, metadata: true },
    })
    const avant = (dernier?.metadata as { avant?: { debut?: string } } | null)?.avant
    if (
      !dernier ||
      dernier.actorId !== ctx.userId ||
      Date.now() - dernier.occurredAt.getTime() > DELAI_RETOUR_ARRIERE_MS ||
      avant?.debut !== input.debut.toISOString()
    ) {
      throw new RetourImpossibleError()
    }
  }

  // « Modifier » (27/10) : un autre praticien ou un autre acte reprend la durée du couple praticien × acte (D14).
  const praticienId = input.praticienId ?? actuel.praticienId
  const motifId = input.motifId ?? actuel.motifId
  if (ctx.praticienRestreint && praticienId !== ctx.praticienRestreint) {
    throw new PermissionDeniedError('agenda', 'update')
  }
  const changeActe = praticienId !== actuel.praticienId || motifId !== actuel.motifId
  let motifEstUrgence = actuel.motif.estUrgence
  let duree = input.dureeMinutes ?? Math.round((actuel.fin.getTime() - actuel.debut.getTime()) / 60_000)
  if (changeActe) {
    const [motif, lien] = await Promise.all([
      prisma.motifConsultation.findUniqueOrThrow({ where: { id: motifId }, select: { estUrgence: true, actif: true } }),
      prisma.praticienMotif.findUnique({
        where: { praticienId_motifId: { praticienId, motifId } },
        select: { dureeMinutes: true },
      }),
    ])
    if (!motif.actif) throw new Error('Ce motif de consultation est désactivé.')
    if (!lien) throw new ActeNonPratiqueError()
    motifEstUrgence = motif.estUrgence
    duree = input.dureeMinutes ?? lien.dureeMinutes
  }
  // Urgence sur planning plein et hors-horaires restent au praticien qui les a posés : passés à un confrère, ils
  // tombent, et le créneau est jugé comme un rendez-vous ordinaire.
  const memePraticien = praticienId === actuel.praticienId
  const surbooking = memePraticien && actuel.surbooking
  const horsHoraire = memePraticien && actuel.horsHoraire
  const note = input.note === undefined ? actuel.note : input.note || null
  const debut = input.debut
  const fin = calculerFin(debut, duree)

  const connu = await chargerContexteCreneau(actuel.siteId, debut, fin)
  const verdict = verifierCreneau(
    {
      praticienId,
      siteId: actuel.siteId,
      debut,
      fin,
      motifEstUrgence,
      surbooking,
      // Un rendez-vous posé hors horaires le reste quand on le décale de quelques minutes.
      horsHoraire,
      // Sans quoi le rendez-vous se chevaucherait lui-même et tout déplacement
      // de quelques minutes serait refusé.
      rendezVousId: actuel.id,
      // Lot 6 (glisser-déposer) : une colonne explicitement visée. Absente pour
      // le formulaire « Décaler à » ordinaire, qui ne choisit pas de fauteuil —
      // dans ce cas `verifierCreneau` déduit comme avant, sans contrainte de
      // plus. `fauteuilId` n'est jamais choisi (D11) : ce champ sert seulement
      // à refuser un dépôt dans une colonne où le praticien n'est pas, plutôt
      // que d'y écrire silencieusement le fauteuil déduit. `exactOptionalPropertyTypes`
      // interdit une valeur `undefined` explicite : on n'ajoute la clé QUE
      // quand elle est renseignée.
      ...(input.fauteuilId ? { fauteuilSouhaite: input.fauteuilId } : {}),
    },
    connu,
  )
  if (!verdict.ok) throw new CreneauRefuseError(verdict.violations)

  try {
    return await avecRepriseSurInterblocage(() => prisma.$transaction(async (tx) => {
      const rdv = await tx.rendezVous.update({
        where: { id: actuel.id },
        data: { debut, fin, fauteuilId: verdict.fauteuilId, praticienId, motifId, note, surbooking, horsHoraire },
        select: { id: true, debut: true, fin: true, fauteuilId: true },
      })

      await recordAudit(tx, ctx, {
        action: 'UPDATE',
        entityType: 'agenda',
        entityId: rdv.id,
        // Ni la note ni le motif en clair (D9) : des identifiants, et le fait que la note a changé.
        metadata: {
          avant: {
            debut: actuel.debut.toISOString(),
            fin: actuel.fin.toISOString(),
            fauteuilId: actuel.fauteuilId,
            ...(changeActe ? { praticienId: actuel.praticienId, motifId: actuel.motifId } : {}),
          },
          apres: {
            debut: rdv.debut.toISOString(),
            fin: rdv.fin.toISOString(),
            fauteuilId: rdv.fauteuilId,
            ...(changeActe ? { praticienId, motifId } : {}),
          },
          ...(note !== actuel.note ? { noteModifiee: true } : {}),
          ...(options.retourArriere ? { retourArriere: true } : {}),
        },
      })

      // Le patient attend ce rendez-vous et son heure a changé : il est prévenu (pas pour une simple durée ou un
      // changement de fauteuil, ni quand il est déjà au cabinet).
      const attendu = ([StatutRendezVous.A_CONFIRMER, StatutRendezVous.CONFIRME] as StatutRendezVous[]).includes(actuel.statut)
      if (!options.retourArriere && attendu && rdv.debut.getTime() !== actuel.debut.getTime() && rdv.debut > new Date()) {
        await emettre(tx, {
          type: TypeNotification.MODIFICATION_RENDEZ_VOUS,
          canal: CanalNotification.SMS,
          destinataire: actuel.patient.telephone,
          texte: (
            await rendreMessage(tx, TypeNotification.MODIFICATION_RENDEZ_VOUS, CanalNotification.SMS, {
              debut: rdv.debut,
              siteNom: actuel.site.nom,
              prenom: actuel.patient.prenom,
              adresse: actuel.site.adresse,
            })
          ).texte,
          rendezVousId: rdv.id,
          rendezVousDebut: rdv.debut,
          siteId: actuel.siteId,
          planifiePour: new Date(Date.now() + DELAI_AVANT_SMS_DE_DEPLACEMENT_MS),
          // `updatedAt` d'avant : chaque déplacement a sa clé, et un rejeu de la même transaction garde la sienne.
          cle: cleIdempotence([
            TypeNotification.MODIFICATION_RENDEZ_VOUS,
            rdv.id,
            actuel.updatedAt,
            rdv.debut,
            actuel.patient.telephone,
            CanalNotification.SMS,
          ]),
        })
      }

      return rdv
    }))
  } catch (e) {
    if (estChevauchementBase(e) || estInterblocage(e)) throw new CreneauPrisEntretempsError()
    throw e
  }
}

/**
 * Met le compteur de manquements du patient d'accord avec ce rendez-vous (Q27).
 *
 * Le drapeau `manquementCompte` porté par le rendez-vous est ce qui rend le
 * décompte sûr : on ne compare pas des statuts, on compare « ce rendez-vous
 * avait-il déjà coûté un point » à « doit-il en coûter un ». Recliquer le même
 * statut ne fait donc rien, et corriger une ligne rend le point au patient.
 *
 * Rend le nouveau compteur, ou `null` si rien n'a bougé.
 */
export async function ajusterManquement(
  tx: Prisma.TransactionClient,
  rdv: { id: string; patientId: string; manquementCompte: boolean },
  doitCompter: boolean,
): Promise<number | null> {
  if (doitCompter === rdv.manquementCompte) return null

  await tx.rendezVous.update({
    where: { id: rdv.id },
    data: { manquementCompte: doitCompter },
  })

  const { manquements } = await tx.patient.update({
    where: { id: rdv.patientId },
    data: { manquements: { increment: doitCompter ? 1 : -1 } },
    select: { manquements: true },
  })

  // Le blocage se recalcule au lieu de s'accumuler : il retombe tout seul quand
  // la secrétaire corrige une ligne, sans passer par un administrateur.
  await tx.patient.update({
    where: { id: rdv.patientId },
    data: { reservationBloquee: reservationFermee(manquements) },
  })

  return manquements
}

type RendezVousPourChangementStatut = {
  id: string
  statut: StatutRendezVous
  patientId: string
  manquementCompte: boolean
}

/** Qui applique le changement : un compte humain (audit ordinaire, D9) ou le
 *  worker (audit "système", `recordSystemAudit`). */
type ActeurChangementStatut =
  | { type: 'humain'; ctx: AuthContext }
  | { type: 'systeme'; siteId: string | null; metadata?: Record<string, Prisma.InputJsonValue> }

/**
 * Cœur partagé du changement de statut d'un rendez-vous : mise à jour du
 * statut, ajustement du manquement (D21, `ajusterManquement`), trace d'audit —
 * toujours dans la MÊME transaction (D9).
 *
 * Partagé entre le geste manuel (`changerStatut`, acteur humain) et l'absence
 * automatique du worker (`marquerAbsentsAutomatiques`, acteur système, Q27) :
 * les deux DOIVENT appliquer exactement la même règle de manquement — la
 * dupliquer serait le risque que l'une diverge de l'autre sans qu'on s'en
 * aperçoive.
 *
 * Ne vérifie AUCUNE permission : c'est aux deux appelants de s'être assurés
 * du droit d'agir avant d'appeler cette fonction (permission humaine, ou
 * garde du worker — site vivant, statut encore éligible).
 *
 * `statutsAttendus`, s'il est fourni, rend la mise à jour CONDITIONNELLE
 * (`updateMany` filtré sur le statut actuel plutôt qu'un `update` par id) :
 * le worker s'en sert pour ne jamais écraser un geste humain survenu entre sa
 * lecture et son écriture (ex. passage en salle d'attente). Rend `null` si la
 * condition n'a pas tenu — rien à faire, ce n'est pas une erreur.
 */
async function appliquerChangementStatut(
  tx: Prisma.TransactionClient,
  rdv: RendezVousPourChangementStatut,
  nouveauStatut: StatutRendezVous,
  auteur: AuteurStatut,
  acteur: ActeurChangementStatut,
  statutsAttendus?: StatutRendezVous[],
): Promise<{ id: string; statut: StatutRendezVous; manquements: number | null } | null> {
  if (statutsAttendus) {
    const { count } = await tx.rendezVous.updateMany({
      where: { id: rdv.id, statut: { in: statutsAttendus } },
      data: { statut: nouveauStatut },
    })
    if (count === 0) return null
  } else {
    await tx.rendezVous.update({ where: { id: rdv.id }, data: { statut: nouveauStatut } })
  }

  const manquements = await ajusterManquement(tx, rdv, compteUnManquement(nouveauStatut, auteur))

  const metadata: Prisma.InputJsonValue = {
    statutAvant: rdv.statut,
    statutApres: nouveauStatut,
    ...(manquements === null ? {} : { manquements }),
    ...(acteur.type === 'systeme' ? acteur.metadata : {}),
  }

  if (acteur.type === 'humain') {
    await recordAudit(tx, acteur.ctx, { action: 'UPDATE', entityType: 'agenda', entityId: rdv.id, metadata })
  } else {
    await recordSystemAudit(tx, {
      action: 'UPDATE',
      entityType: 'agenda',
      entityId: rdv.id,
      siteId: acteur.siteId,
      metadata,
    })
  }

  return { id: rdv.id, statut: nouveauStatut, manquements }
}

/**
 * Le cabinet corrige le niveau d'urgence donné par l'assistant (D77). Celui de l'assistant reste : l'écart entre
 * les deux mesure sa justesse. Revenir au niveau de l'assistant efface la correction.
 */
export async function corrigerNiveauUrgence(ctx: AuthContext, id: string, niveau: NiveauUrgence) {
  await requirePermission(ctx, 'agenda', 'update')
  const rdv = await prisma.rendezVous.findFirst({
    where: { id, ...filtreSite(ctx) },
    select: { id: true, conversationAssistant: { select: { id: true, niveau: true, niveauCabinet: true } } },
  })
  if (!rdv?.conversationAssistant) throw new Error('Rendez-vous introuvable.')
  const conversation = rdv.conversationAssistant
  await prisma.$transaction(async (tx) => {
    await tx.conversationAssistant.update({
      where: { id: conversation.id },
      data: { niveauCabinet: niveau === conversation.niveau ? null : niveau },
    })
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'agenda',
      entityId: rdv.id,
      metadata: { niveauUrgence: { avant: conversation.niveauCabinet ?? conversation.niveau, apres: niveau } },
    })
  })
}

/** Le patient d'une demande d'urgence transmise par l'assistant a été rappelé (D79) : elle quitte l'accueil. */
export async function marquerDemandeUrgenceTraitee(ctx: AuthContext, id: string) {
  await requirePermission(ctx, 'agenda', 'update')
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.conversationAssistant.updateMany({
      where: { id, demandeLe: { not: null }, demandeTraiteeLe: null },
      data: { demandeTraiteeLe: new Date() },
    })
    if (count === 0) throw new Error('Cette demande est déjà traitée.')
    await recordAudit(tx, ctx, { action: 'UPDATE', entityType: 'assistant', entityId: id, metadata: { demandeUrgence: 'rappelée' } })
  })
}

export async function changerStatut(ctx: AuthContext, input: ChangerStatutInput) {
  await requirePermission(ctx, 'agenda', 'update')

  if (input.statut === StatutRendezVous.ANNULATION_DEMANDEE) {
    // Jamais un choix du menu : ce statut découle d'une demande d'annulation,
    // posée par `annulerRendezVous` (D17, retournée le 2026-09-23).
    throw new Error("Ce statut ne se choisit pas dans le menu : il découle d'une demande d'annulation.")
  }

  if (input.statut === StatutRendezVous.ANNULE) {
    // L'annulation reste un droit distinct de la modification, même depuis que
    // Q36 est tranchée et que le secrétariat l'a : la permission séparée est ce
    // qui permettra de la retirer à un rôle sans lui retirer l'agenda.
    //
    // Depuis le 23/09 (D17, retournée), choisir « Annulé » ici ne prononce plus
    // toujours l'annulation : selon qui l'actionne, cela peut n'être qu'une
    // DEMANDE. Toute la décision vit dans un seul endroit, `annulerRendezVous`,
    // qu'elle soit prise depuis ce menu ou un jour depuis un écran dédié.
    return annulerRendezVous(ctx, { id: input.id })
  }

  const actuel = await prisma.rendezVous.findFirst({
    where: { id: input.id, ...filtreSite(ctx) },
    select: {
      id: true,
      statut: true,
      patientId: true,
      manquementCompte: true,
      motif: { select: { prixCentimes: true } },
    },
  })
  if (!actuel) throw new Error('Rendez-vous introuvable.')

  if (actuel.statut === StatutRendezVous.ANNULATION_DEMANDEE) {
    // Une demande est en attente : seules `validerAnnulation` et
    // `refuserAnnulation` en sortent, jamais le menu de statut ordinaire.
    throw new AnnulationDejaDemandeeError()
  }

  return prisma.$transaction(async (tx) => {
    // `cabinet` : c'est une personne du cabinet qui manipule cet écran. Une
    // annulation posée ici ne coûte donc rien au patient — seul le passage à
    // « absent » compte, parce qu'il constate que le patient n'est pas venu.
    //
    // Appel non conditionnel (pas de `statutsAttendus`) : `actuel` vient
    // d'être lu dans cette même fonction, `appliquerChangementStatut` rend
    // donc toujours un résultat ici, jamais `null`.
    const resultat = (await appliquerChangementStatut(
      tx,
      actuel,
      input.statut,
      'cabinet',
      { type: 'humain', ctx },
    ))!

    // Le passage en caisse porte le montant du soin (D81) : celui que la secrétaire a validé, sinon le prix de la
    // grille. En sortir (une étape cliquée par erreur) l'efface : il ne compterait plus dans la rétrocession.
    if (input.statut === StatutRendezVous.EN_CAISSE && actuel.statut !== StatutRendezVous.EN_CAISSE) {
      await tx.rendezVous.update({
        where: { id: actuel.id },
        data: { montantCentimes: input.montantCentimes ?? actuel.motif.prixCentimes, encaisseLe: new Date() },
      })
    } else if (input.statut !== StatutRendezVous.EN_CAISSE && actuel.statut === StatutRendezVous.EN_CAISSE) {
      await tx.rendezVous.update({ where: { id: actuel.id }, data: { montantCentimes: null, encaisseLe: null } })
    }

    return { id: resultat.id, statut: resultat.statut }
  })
}

/** Corrige le montant d'un rendez-vous déjà passé en caisse (D81) : une erreur de saisie, un soin de plus. */
export async function corrigerMontant(ctx: AuthContext, input: { id: string; montantCentimes: number }) {
  await requirePermission(ctx, 'agenda', 'update')
  const rdv = await prisma.rendezVous.findFirst({
    where: { id: input.id, ...filtreSite(ctx), ...filtrePraticien(ctx) },
    select: { id: true, statut: true, montantCentimes: true },
  })
  if (!rdv) throw new Error('Rendez-vous introuvable.')
  if (rdv.statut !== StatutRendezVous.EN_CAISSE) throw new Error('Ce rendez-vous n’est pas encore passé en caisse.')
  await prisma.$transaction(async (tx) => {
    await tx.rendezVous.update({ where: { id: rdv.id }, data: { montantCentimes: input.montantCentimes } })
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'agenda',
      entityId: rdv.id,
      metadata: { montantCentimes: { avant: rdv.montantCentimes, apres: input.montantCentimes } },
    })
  })
}

/**
 * Annule un rendez-vous — ou, si l'appelant n'est pas le praticien concerné,
 * DEMANDE son annulation (D17, retournée le 2026-09-23).
 *
 * Direct pour le praticien sur SON rendez-vous : rien ne change pour lui, il
 * tranchait déjà seul. Pour tous les autres — accueil, administrateur non
 * praticien, ou praticien sur le rendez-vous d'un confrère — ce n'est plus une
 * annulation mais une demande, en attente du praticien concerné ou d'un
 * administrateur (`validerAnnulation` / `refuserAnnulation`).
 *
 * Le rendez-vous n'est jamais effacé : il passe au statut ANNULE (ou, en
 * attente, ANNULATION_DEMANDEE), reste lisible, et une fois ANNULE son créneau
 * redevient libre. Effacer ferait disparaître du journal ce qui avait été
 * promis au patient.
 */
export async function annulerRendezVous(ctx: AuthContext, input: AnnulerRendezVousInput) {
  await requirePermission(ctx, 'agenda', 'delete')

  const actuel = await prisma.rendezVous.findFirst({
    where: { id: input.id, ...filtreSite(ctx) },
    select: { id: true, statut: true, patientId: true, manquementCompte: true, praticienId: true },
  })
  if (!actuel) throw new Error('Rendez-vous introuvable.')

  if (actuel.statut === StatutRendezVous.ANNULATION_DEMANDEE) {
    throw new AnnulationDejaDemandeeError()
  }

  const monPraticien = await praticienDuCompte(ctx)
  if (monPraticien && monPraticien.id === actuel.praticienId) {
    return annulerDirectement(ctx, actuel, input.raison)
  }
  return demanderAnnulation(ctx, actuel)
}

type RendezVousActuel = {
  id: string
  statut: StatutRendezVous
  patientId: string
  manquementCompte: boolean
}

/** Annulation directe : statut ANNULE, aucun manquement (D21 inchangé). */
async function annulerDirectement(
  ctx: AuthContext,
  actuel: RendezVousActuel,
  raison: string | undefined,
) {
  const detail = await prisma.rendezVous.findUniqueOrThrow({
    where: { id: actuel.id },
    select: {
      debut: true,
      fin: true,
      siteId: true,
      motifId: true,
      praticienId: true,
      patient: { select: { telephone: true, prenom: true } },
      site: { select: { nom: true, adresse: true } },
    },
  })
  // Le patient est prévenu comme à la validation d'une demande (Q5 ; Marving, 21/10 — D27 l'avait laissé de
  // côté) : un rendez-vous qu'il attendait encore. Pas quand le praticien corrige un « absent » en « annulé »
  // pour lui rendre son point, ni pour un rendez-vous déjà passé.
  const attendu =
    detail.debut > new Date() &&
    ([StatutRendezVous.A_CONFIRMER, StatutRendezVous.CONFIRME] as StatutRendezVous[]).includes(actuel.statut)

  const rdv = await prisma.$transaction(async (tx) => {
    const rdv = await tx.rendezVous.update({
      where: { id: actuel.id },
      data: { statut: StatutRendezVous.ANNULE },
      select: { id: true, statut: true },
    })

    // Annulation par le cabinet : aucun manquement. L'appel sert malgré tout,
    // et dans un cas précis — le rendez-vous était marqué « absent », il avait
    // donc coûté un point, et l'annuler le rend au patient.
    const manquements = await ajusterManquement(
      tx,
      actuel,
      compteUnManquement(StatutRendezVous.ANNULE, 'cabinet'),
    )

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'agenda',
      entityId: rdv.id,
      // La raison est saisie par le personnel : elle peut contenir une donnée de
      // santé sans qu'on le veuille. Seule sa présence est tracée, pas son texte.
      metadata: {
        statutAvant: actuel.statut,
        statutApres: rdv.statut,
        raisonFournie: Boolean(raison),
        ...(manquements === null ? {} : { manquements }),
      },
    })

    if (attendu) {
      await emettre(tx, {
        type: TypeNotification.ANNULATION_CABINET,
        canal: CanalNotification.SMS,
        destinataire: detail.patient.telephone,
        texte: (
          await rendreMessage(tx, TypeNotification.ANNULATION_CABINET, CanalNotification.SMS, {
            debut: detail.debut,
            siteNom: detail.site.nom,
            prenom: detail.patient.prenom,
            adresse: detail.site.adresse,
          })
        ).texte,
        rendezVousId: rdv.id,
        rendezVousDebut: detail.debut,
        siteId: detail.siteId,
        cle: cleIdempotence([TypeNotification.ANNULATION_CABINET, rdv.id, detail.debut, detail.patient.telephone, CanalNotification.SMS]),
      })
    }

    return rdv
  })

  // Liste d'attente (D29) : le créneau se libère, comme à la validation d'une demande.
  if (attendu) {
    await creneauLibere({
      siteId: detail.siteId,
      praticienId: detail.praticienId,
      motifId: detail.motifId,
      debut: detail.debut,
      fin: detail.fin,
      ipAddress: ctx.ipAddress,
    })
  }

  return rdv
}

/**
 * Demande d'annulation : le rendez-vous passe en ANNULATION_DEMANDEE, son
 * statut d'avant est mémorisé — c'est ce qui permettra un refus intact — et
 * rien ne coûte encore au patient : ni manquement, ni SMS (D17, retournée le
 * 2026-09-23). Le SMS n'part qu'à la validation, jamais à la demande.
 */
async function demanderAnnulation(ctx: AuthContext, actuel: RendezVousActuel) {
  return prisma.$transaction(async (tx) => {
    const rdv = await tx.rendezVous.update({
      where: { id: actuel.id },
      data: {
        statut: StatutRendezVous.ANNULATION_DEMANDEE,
        statutAvantAnnulation: actuel.statut,
        annulationDemandeeParId: ctx.userId,
        annulationDemandeeLe: new Date(),
      },
      select: { id: true, statut: true },
    })

    await recordAudit(tx, ctx, {
      action: 'ANNULATION_DEMANDEE',
      entityType: 'agenda',
      entityId: rdv.id,
      metadata: { statutAvant: actuel.statut },
    })

    return rdv
  })
}

/**
 * Valide une demande d'annulation : le rendez-vous devient ANNULE, sans
 * manquement (D21 inchangé), et le patient est prévenu par SMS — jamais avant
 * (D17, retournée le 2026-09-23).
 *
 * Réservé au praticien DU rendez-vous, ou à un administrateur : un autre
 * praticien porte la permission `agenda:valider` mais pas cette
 * autorisation-ci, tranchée instance par instance.
 */
export async function validerAnnulation(ctx: AuthContext, input: ValiderAnnulationInput) {
  await requirePermission(ctx, 'agenda', 'valider')

  const actuel = await prisma.rendezVous.findFirst({
    where: { id: input.id, ...filtreSite(ctx) },
    select: {
      id: true,
      statut: true,
      patientId: true,
      manquementCompte: true,
      praticienId: true,
      siteId: true,
      motifId: true,
      debut: true,
      fin: true,
      patient: { select: { telephone: true, prenom: true } },
      site: { select: { nom: true, adresse: true } },
    },
  })
  if (!actuel) throw new Error('Rendez-vous introuvable.')
  if (actuel.statut !== StatutRendezVous.ANNULATION_DEMANDEE) {
    throw new AucuneAnnulationEnAttenteError()
  }

  const monPraticien = await praticienDuCompte(ctx)
  const autorise = ctx.porteeGlobale || monPraticien?.id === actuel.praticienId
  if (!autorise) throw new AnnulationReserveeAuPraticienError()

  const rdv = await prisma.$transaction(async (tx) => {
    const rdv = await tx.rendezVous.update({
      where: { id: actuel.id },
      data: {
        statut: StatutRendezVous.ANNULE,
        statutAvantAnnulation: null,
        annulationDemandeeParId: null,
        annulationDemandeeLe: null,
      },
      select: { id: true, statut: true },
    })

    const manquements = await ajusterManquement(
      tx,
      actuel,
      compteUnManquement(StatutRendezVous.ANNULE, 'cabinet'),
    )

    await recordAudit(tx, ctx, {
      action: 'ANNULATION_VALIDEE',
      entityType: 'agenda',
      entityId: rdv.id,
      metadata: { ...(manquements === null ? {} : { manquements }) },
    })

    // Émise DANS la même transaction que l'écriture métier (phase 4, lot 3,
    // D37) : la ligne de notification apparaît ou disparaît avec le reste. Ce
    // n'est plus un envoi synchrone qui pourrait échouer et devait donc rester
    // hors transaction — c'est une simple écriture en base, que le worker
    // séparé (scripts/worker-notifications.ts) traitera à son rythme.
    await emettre(tx, {
      type: TypeNotification.ANNULATION_CABINET,
      canal: CanalNotification.SMS,
      destinataire: actuel.patient.telephone,
      texte: (
        await rendreMessage(tx, TypeNotification.ANNULATION_CABINET, CanalNotification.SMS, {
          debut: actuel.debut,
          siteNom: actuel.site.nom,
          prenom: actuel.patient.prenom,
          adresse: actuel.site.adresse,
        })
      ).texte,
      rendezVousId: rdv.id,
      rendezVousDebut: actuel.debut,
      siteId: actuel.siteId,
      cle: cleIdempotence([TypeNotification.ANNULATION_CABINET, rdv.id, actuel.debut, actuel.patient.telephone, CanalNotification.SMS]),
    })

    return rdv
  })

  // Liste d'attente (lot D, D29) : ce créneau vient de se libérer.
  await creneauLibere({
    siteId: actuel.siteId,
    praticienId: actuel.praticienId,
    motifId: actuel.motifId,
    debut: actuel.debut,
    fin: actuel.fin,
    ipAddress: ctx.ipAddress,
  })

  return rdv
}

/**
 * Refuse une demande d'annulation : le rendez-vous revient à son statut
 * d'avant la demande, intact. Rien n'avait encore coûté au patient à la
 * demande, il n'y a donc rien à défaire (D17, retournée le 2026-09-23).
 */
export async function refuserAnnulation(ctx: AuthContext, input: RefuserAnnulationInput) {
  await requirePermission(ctx, 'agenda', 'valider')

  const actuel = await prisma.rendezVous.findFirst({
    where: { id: input.id, ...filtreSite(ctx) },
    select: { id: true, statut: true, praticienId: true, statutAvantAnnulation: true },
  })
  if (!actuel) throw new Error('Rendez-vous introuvable.')
  if (actuel.statut !== StatutRendezVous.ANNULATION_DEMANDEE || !actuel.statutAvantAnnulation) {
    throw new AucuneAnnulationEnAttenteError()
  }
  const statutPrecedent = actuel.statutAvantAnnulation

  const monPraticien = await praticienDuCompte(ctx)
  const autorise = ctx.porteeGlobale || monPraticien?.id === actuel.praticienId
  if (!autorise) throw new AnnulationReserveeAuPraticienError()

  return prisma.$transaction(async (tx) => {
    const rdv = await tx.rendezVous.update({
      where: { id: actuel.id },
      data: {
        statut: statutPrecedent,
        statutAvantAnnulation: null,
        annulationDemandeeParId: null,
        annulationDemandeeLe: null,
      },
      select: { id: true, statut: true },
    })

    await recordAudit(tx, ctx, {
      action: 'ANNULATION_REFUSEE',
      entityType: 'agenda',
      entityId: rdv.id,
      // La raison est saisie par le personnel : seule sa présence est tracée,
      // pas son texte (même motif que `raisonFournie` ailleurs dans ce fichier).
      metadata: { raisonFournie: Boolean(input.raison), statutRestaure: rdv.statut },
    })

    return rdv
  })
}

export async function creerPatient(ctx: AuthContext, input: CreerPatientInput) {
  await requirePermission(ctx, 'patient', 'create')

  // Un profil est complet quand la date de naissance est là : c'est elle qui
  // distingue deux homonymes, et son absence justifie la notification prévue.
  const profilComplet = Boolean(input.dateNaissance)

  return prisma.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        nom: input.nom,
        prenom: input.prenom,
        telephone: input.telephone,
        dateNaissance: input.dateNaissance ?? null,
        email: input.email ?? null,
        representantLegal: input.representantLegal ?? null,
        telephoneRepresentant: input.telephoneRepresentant ?? null,
        profilComplet,
      },
      select: { id: true, nom: true, prenom: true, profilComplet: true },
    })

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'patient',
      entityId: patient.id,
      // ⚠ Pas de nom ni de téléphone dans le journal : identité d'un patient et
      // donnée de santé se rejoignent dès qu'on sait qu'il a consulté.
      metadata: { profilComplet },
    })

    return patient
  })
}

// ─── Absence automatique 20 minutes après le début (Q27) ───────────────────
//
// « 20 minutes de retard → patient noté absent, rendez-vous annulé
// automatiquement. » Le statut final posé ici est ABSENT, pas ANNULE : c'est
// ABSENT qui libère déjà le créneau (`OCCUPE` plus haut l'exclut) et qui
// compte un manquement (D21) — c'est une absence qui est constatée, pas une
// annulation choisie. Appelée UNIQUEMENT par le worker
// (`scripts/worker-notifications.ts`), jamais par un écran : aucun geste
// humain ne correspond à « le temps a passé ».

/**
 * Ne rattrape pas l'historique ancien. Un rendez-vous plus vieux que ça,
 * encore `A_CONFIRMER` ou `CONFIRME`, est une anomalie (secrétaire absente,
 * worker resté arrêté plusieurs jours) qui mérite un regard humain — pas un
 * automatisme qui le classe absent sans témoin en remontant arbitrairement
 * loin dans le passé. 48h couvre « débuté aujourd'hui ou hier », quelle que
 * soit l'heure du passage du worker dans la journée.
 */
const HORIZON_RATTRAPAGE_ABSENCE_MS = 48 * 3_600_000

/** Retard au-delà duquel un rendez-vous non confirmé sur place est considéré
 *  absent (Q27). */
const RETARD_ABSENCE_MS = 20 * 60_000

/**
 * Un poste est vivant s'il a donné signe de vie il y a moins de N minutes.
 * `identifierPoste` (`src/server/auth/poste.ts`) rafraîchit `lastSeenAt` à
 * CHAQUE requête authentifiée depuis ce poste (via `lireOrigine`, appelée par
 * `exigerContexte` sur toute page protégée) — pas seulement à la connexion :
 * la fraîcheur du signal est donc bien celle d'un usage en cours, pas d'un
 * login d'il y a huit heures.
 */
const SEUIL_POSTE_VIVANT_MINUTES = 10

/**
 * Sites éligibles à l'automatisme : ceux dont au moins un poste ACTIF a été
 * vu il y a moins de `SEUIL_POSTE_VIVANT_MINUTES` minutes.
 *
 * Parade au risque du hors ligne : à Marie-Galante sans internet, l'accueil a
 * pu mettre un patient en salle d'attente sur un poste qui vient de perdre sa
 * connexion ; si le serveur, lui, reste joignable, il ne doit pas déclarer ce
 * patient absent alors que personne n'a pu le faire avancer à l'écran.
 * **Dans le doute, ne pas déclarer absent** : un site SANS AUCUN poste
 * enregistré (jamais connecté) tombe dans le même cas qu'un site dont tous
 * les postes sont muets depuis plus de N minutes — aucun des deux n'apparaît
 * dans l'ensemble rendu, faute de ligne `Workstation` récente à trouver.
 *
 * ⚠ Limite assumée, à signaler : la parade est **par site**, pas par poste.
 * Un site à plusieurs postes où un seul est vivant reste entièrement
 * éligible — un rendez-vous saisi sur le poste coupé d'un site par ailleurs
 * vivant peut donc être marqué absent à tort. Rien dans le modèle ne dit sur
 * quel poste un rendez-vous a été vu pour la dernière fois ; un raffinement
 * par poste exigerait cette donnée, qui n'existe pas aujourd'hui.
 */
async function sitesVivants(maintenant: Date, siteIds: string[]): Promise<Set<string>> {
  if (siteIds.length === 0) return new Set()

  const seuil = new Date(maintenant.getTime() - SEUIL_POSTE_VIVANT_MINUTES * 60_000)
  const postes = await prisma.workstation.findMany({
    // Borne haute `lte: maintenant` en plus de la borne basse : « vivant » se
    // juge AU MOMENT du passage, jamais par rapport à l'horloge réelle — sans
    // quoi un test (ou un worker relancé après une horloge système décalée)
    // qui fixe `maintenant` dans le passé verrait un poste réellement vu
    // depuis compter comme vivant pour un passage qui, lui, se place avant.
    where: { siteId: { in: siteIds }, actif: true, lastSeenAt: { gte: seuil, lte: maintenant } },
    select: { siteId: true },
  })
  return new Set(postes.map((p) => p.siteId).filter((id): id is string => id !== null))
}

export type ResultatAbsencesAutomatiques = {
  /** Rendez-vous effectivement passés à ABSENT. */
  marques: number
  /** Sites dont au moins un rendez-vous éligible a été laissé intact, faute
   *  de poste vivant — journalisé par l'appelant (le worker). */
  sitesIgnores: string[]
}

/**
 * Passe en ABSENT, avec manquement (D21) et audit "système", tout rendez-vous
 * `A_CONFIRMER` ou `CONFIRME` dont le début remonte à plus de 20 minutes
 * (Q27), sur un site dont un poste est vivant (`sitesVivants`).
 *
 * JAMAIS `SALLE_ATTENTE` ni `AU_FAUTEUIL` — le patient est arrivé, quel que
 * soit son retard, l'automatisme n'a rien à y faire. JAMAIS
 * `ANNULATION_DEMANDEE` — une demande en cours d'examen par le praticien
 * (D17, retournée le 2026-09-23) n'a pas à être court-circuitée : c'est au
 * praticien de trancher, pas au worker. Ces trois statuts sont exclus par
 * construction : ils ne figurent pas dans le filtre de sélection ci-dessous.
 *
 * PAS de créneau remis à la liste d'attente (D29) : `creneauLibere` n'est
 * PAS appelée, à la différence de `validerAnnulation` — le créneau est déjà
 * passé, le proposer à quelqu'un d'autre ne servirait à rien.
 *
 * PAS de SMS au patient : Q27 ne prévoit aucun message pour ce cas (à la
 * différence de l'annulation par le cabinet qui, elle, en envoie un à la
 * validation — D17). Ne pas en inventer un que le cadrage n'a pas demandé.
 *
 * Idempotente : une fois `ABSENT`, un rendez-vous sort du filtre de sélection
 * (`A_CONFIRMER`/`CONFIRME`) et n'est plus jamais repris par un passage
 * suivant. La mise à jour est en plus CONDITIONNELLE
 * (`appliquerChangementStatut` avec `statutsAttendus`) : si l'accueil a fait
 * passer le rendez-vous en salle d'attente entre la lecture et l'écriture, la
 * condition échoue et rien n'est modifié — pas d'écrasement d'un geste humain
 * plus récent par le passage suivant du worker.
 *
 * Réversible par le geste de correction existant (`changerStatut`) : changer
 * le statut d'un rendez-vous `ABSENT` — posé par le système ou par un humain,
 * la ligne ne distingue pas les deux — rend le manquement via
 * `ajusterManquement`, qui ne compare que des booléens (`manquementCompte`),
 * jamais qui a posé le statut. Rien à ajouter ici pour que la correction
 * fonctionne.
 *
 * `maintenant` est un paramètre, jamais `new Date()` : le worker le fixe une
 * fois par passage, et les tests l'éprouvent sans attendre l'horloge réelle.
 */
export async function marquerAbsentsAutomatiques(
  maintenant: Date,
): Promise<ResultatAbsencesAutomatiques> {
  const auPlusTard = new Date(maintenant.getTime() - RETARD_ABSENCE_MS)
  const auPlusTot = new Date(maintenant.getTime() - HORIZON_RATTRAPAGE_ABSENCE_MS)

  const candidats = await prisma.rendezVous.findMany({
    where: {
      statut: { in: [StatutRendezVous.A_CONFIRMER, StatutRendezVous.CONFIRME] },
      debut: { lte: auPlusTard, gte: auPlusTot },
    },
    select: { id: true, statut: true, patientId: true, manquementCompte: true, siteId: true },
  })
  if (candidats.length === 0) return { marques: 0, sitesIgnores: [] }

  const siteIds = [...new Set(candidats.map((c) => c.siteId))]
  const vivants = await sitesVivants(maintenant, siteIds)
  const sitesIgnores = siteIds.filter((id) => !vivants.has(id))
  if (sitesIgnores.length > 0) {
    console.log(
      `marquerAbsentsAutomatiques : site(s) ignoré(s), aucun poste vivant depuis ${SEUIL_POSTE_VIVANT_MINUTES} min — ${sitesIgnores.join(', ')}`,
    )
  }

  let marques = 0
  for (const rdv of candidats) {
    if (!vivants.has(rdv.siteId)) continue

    await prisma.$transaction(async (tx) => {
      const resultat = await appliquerChangementStatut(
        tx,
        rdv,
        StatutRendezVous.ABSENT,
        // Sans effet sur ABSENT (`compteUnManquement` l'ignore pour ce
        // statut, D21) : choisi pour la validité du type, pas pour son sens.
        'cabinet',
        {
          type: 'systeme',
          siteId: rdv.siteId,
          metadata: { raisonAutomatique: 'retard_20_min' },
        },
        [StatutRendezVous.A_CONFIRMER, StatutRendezVous.CONFIRME],
      )
      if (resultat) marques += 1
    })
  }

  return { marques, sitesIgnores }
}
