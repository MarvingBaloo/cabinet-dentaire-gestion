import 'server-only'

import { CanalNotification, StatutRendezVous, TypeNotification } from '@prisma/client'

import { env } from '@/config/env'
import { dansLaFenetreEnvoi, decalerJour, instantCabinet, jourLocal } from '@/lib/dates'
import { prisma } from '@/server/db/client'
import {
  type LigneNotificationPrise,
  type VerdictPertinence,
  cleIdempotence,
  emettre,
  verificateurs,
} from '@/server/notifications/file'
import { rendreMessage } from '@/server/notifications/messages'

// Rappels de rendez-vous (phase 4, lot 3, D4x — à consigner) : générés par le
// worker à partir de l'agenda à chaque passage, PAS par une tâche posée par
// rendez-vous. `planifierRappels` relit les rendez-vous à venir et émet ce qui
// manque encore dans la file — `emettre` est idempotente (D38), donc rejouable
// à chaque passage sans risque de doublon.
//
// Enregistre aussi, en bas de ce fichier, les vérificateurs de RAPPEL_J2,
// RAPPEL_H3, CONFIRMATION_RESERVATION et MODIFICATION_RENDEZ_VOUS : ces quatre
// événements portent tous sur UN rendez-vous précis, et la question posée au
// moment d'envoyer est la même pour les quatre — « ce rendez-vous existe-t-il
// encore, sous ce même début, et (pour les rappels) n'a-t-il pas déjà
// commencé ? ». Ils vivent ICI et pas dans reservation-publique.ts ou
// acces-patient.ts, qui les émettent : le worker
// (scripts/worker-notifications.ts) importe ce fichier pour `planifierRappels`,
// jamais ces deux services — un enregistrement posé là-bas ne s'exécuterait
// donc jamais dans le process qui traite réellement la file.

const HORIZON_RAPPELS_MS = 72 * 3_600_000
const DELAI_J2_MS = 48 * 3_600_000
const DELAI_H3_MS = 3 * 3_600_000

/** Statuts qui sortent un rendez-vous du champ des rappels : annulé (sous
 *  toutes ses formes) ou déjà honoré. `A_CONFIRMER`, `CONFIRME`,
 *  `SALLE_ATTENTE` et `AU_FAUTEUIL` restent éligibles — un rendez-vous encore
 *  à venir ne devrait normalement porter que les deux premiers, mais rien
 *  n'empêche structurellement les deux autres. */
const STATUTS_EXCLUS_RAPPEL: StatutRendezVous[] = [
  StatutRendezVous.ANNULE,
  StatutRendezVous.ANNULATION_DEMANDEE,
  StatutRendezVous.ABSENT,
  StatutRendezVous.TERMINE,
  StatutRendezVous.EN_CAISSE,
]

/**
 * L'instant où part le rappel H-3, pour un début de rendez-vous donné.
 *
 * Pure : ne lit pas l'horloge, ne consulte pas la base — `planifierRappels`
 * décide séparément si ce moment est déjà passé.
 *
 * Règle (D4x). Si début − 3 h tombe dans la fenêtre de silence 21h-8h (heure
 * du cabinet), le rappel est avancé à 20h la veille du rendez-vous — la
 * dernière heure autorisée avant la fenêtre (pour un rendez-vous à 8h,
 * H-3 = 5h → 20h la veille). Sinon, début − 3 h telle quelle. Aucune autre
 * règle : si ce moment avancé est lui-même déjà passé, `planifierRappels` ne
 * l'émet simplement pas — cette fonction ne le sait pas, elle reste pure.
 */
export function heureRappelH3(debut: Date): Date {
  const h3 = new Date(debut.getTime() - DELAI_H3_MS)
  if (dansLaFenetreEnvoi(h3)) return h3

  const veille = decalerJour(jourLocal(debut), -1)
  return instantCabinet(veille, '20:00') as Date
}

type EvenementRappel = typeof TypeNotification.RAPPEL_J2 | typeof TypeNotification.RAPPEL_H3

type RendezVousPourRappel = {
  id: string
  debut: Date
  siteId: string
  siteNom: string
  telephone: string
  prenom: string
}

async function emettreRappel(
  type: EvenementRappel,
  rdv: RendezVousPourRappel,
  planifiePour: Date,
  attendReponse: boolean,
): Promise<boolean> {
  const { texte } = await rendreMessage(prisma, type, CanalNotification.SMS, {
    debut: rdv.debut,
    siteNom: rdv.siteNom,
    prenom: rdv.prenom,
    attendReponse,
  })
  return emettre(prisma, {
    type,
    canal: CanalNotification.SMS,
    destinataire: rdv.telephone,
    texte,
    rendezVousId: rdv.id,
    rendezVousDebut: rdv.debut,
    siteId: rdv.siteId,
    planifiePour,
    attendReponse,
    cle: cleIdempotence([type, rdv.id, rdv.debut, rdv.telephone, CanalNotification.SMS]),
  })
}

export type ResultatPlanificationRappels = { j2: number; h3: number }

/**
 * Émet dans la file les rappels J-2 et H-3 dus pour les rendez-vous à venir
 * dans les 72 heures — appelée à chaque passage du worker, AVANT `traiterLot`.
 *
 * J-2 : début − 48 h ; si déjà passé au moment de planifier (rendez-vous pris
 * moins de 48 h avant), pas de J-2. S'il tombe dans la fenêtre 21h-8h, la file
 * elle-même le reporte à 8h (comportement déjà en place, D29) — acceptable
 * pour un rappel à deux jours.
 *
 * H-3 : voir `heureRappelH3`.
 *
 * Idempotente par construction (`emettre`, D38) : un rendez-vous déjà couvert
 * ne réémet rien ; un rendez-vous déplacé, dont le début a changé, reçoit de
 * nouveaux rappels calés sur le nouveau début — la clé d'idempotence inclut le
 * début, donc l'ancienne ligne (ancien couple type/rendez-vous/ancien début)
 * reste distincte, et c'est le vérificateur qui l'abandonnera à son tour
 * (`rendez_vous_deplace`) plutôt qu'un nettoyage ici.
 */
export async function planifierRappels(maintenant: Date): Promise<ResultatPlanificationRappels> {
  const horizon = new Date(maintenant.getTime() + HORIZON_RAPPELS_MS)

  // Lot 4 (D-lot4-J) : répondre OUI/NON par SMS suppose que quelqu'un lise la
  // réponse — le webhook `src/app/api/webhooks/brevo/sms/route.ts`, lui-même
  // désactivé sans `BREVO_WEBHOOK_SECRET`. Lu à chaque passage (pas mis en
  // cache) : un secret ajouté ou retiré doit se refléter dès le prochain appel,
  // sans redémarrage particulier au-delà de celui déjà requis après migration.
  const attendReponse = Boolean(env.BREVO_WEBHOOK_SECRET)

  const rdvs = await prisma.rendezVous.findMany({
    where: {
      debut: { gt: maintenant, lt: horizon },
      statut: { notIn: STATUTS_EXCLUS_RAPPEL },
      patient: { actif: true, telephone: { not: '' } },
    },
    select: {
      id: true,
      debut: true,
      siteId: true,
      site: { select: { nom: true } },
      patient: { select: { telephone: true, prenom: true } },
    },
  })

  let j2 = 0
  let h3 = 0

  for (const rdv of rdvs) {
    const base: RendezVousPourRappel = {
      prenom: rdv.patient.prenom,
      id: rdv.id,
      debut: rdv.debut,
      siteId: rdv.siteId,
      siteNom: rdv.site.nom,
      telephone: rdv.patient.telephone,
    }

    const planifieJ2 = new Date(rdv.debut.getTime() - DELAI_J2_MS)
    if (planifieJ2.getTime() > maintenant.getTime()) {
      if (await emettreRappel(TypeNotification.RAPPEL_J2, base, planifieJ2, attendReponse)) j2 += 1
    }

    const planifieH3 = heureRappelH3(rdv.debut)
    if (planifieH3.getTime() > maintenant.getTime()) {
      if (await emettreRappel(TypeNotification.RAPPEL_H3, base, planifieH3, attendReponse)) h3 += 1
    }
  }

  return { j2, h3 }
}

type RaisonAbandonRappel =
  | 'rendez_vous_introuvable'
  | 'sans_rendez_vous'
  | 'rendez_vous_annule'
  | 'rendez_vous_deplace'
  | 'rendez_vous_passe'

function abandon(raison: RaisonAbandonRappel): VerdictPertinence {
  return { abandon: raison }
}

/**
 * Vérificateur commun à RAPPEL_J2, RAPPEL_H3, CONFIRMATION_RESERVATION et
 * MODIFICATION_RENDEZ_VOUS : le rendez-vous existe-t-il encore, sous le même
 * début que celui enregistré à l'émission (`rendezVousDebut`), et actif — pas
 * annulé, pas en attente d'annulation (D17/D27 : une demande en cours rend le
 * message caduc, il ne faut pas prévenir de ce qui va peut-être disparaître),
 * pas absent. Pour les rappels seulement, en plus : pas déjà commencé.
 */
async function rendezVousToujoursValide(
  n: LigneNotificationPrise,
  maintenant: Date,
  options: { exigerNonCommence: boolean },
): Promise<VerdictPertinence> {
  if (!n.rendezVousId) return abandon('sans_rendez_vous')

  const rdv = await prisma.rendezVous.findUnique({
    where: { id: n.rendezVousId },
    select: { debut: true, statut: true },
  })
  if (!rdv) return abandon('rendez_vous_introuvable')

  if (
    rdv.statut === StatutRendezVous.ANNULE ||
    rdv.statut === StatutRendezVous.ANNULATION_DEMANDEE ||
    rdv.statut === StatutRendezVous.ABSENT
  ) {
    return abandon('rendez_vous_annule')
  }

  if (n.rendezVousDebut && rdv.debut.getTime() !== n.rendezVousDebut.getTime()) {
    return abandon('rendez_vous_deplace')
  }

  if (options.exigerNonCommence && rdv.debut.getTime() <= maintenant.getTime()) {
    return abandon('rendez_vous_passe')
  }

  return 'envoyer'
}

verificateurs[TypeNotification.RAPPEL_J2] = (n, maintenant) =>
  rendezVousToujoursValide(n, maintenant, { exigerNonCommence: true })
verificateurs[TypeNotification.RAPPEL_H3] = (n, maintenant) =>
  rendezVousToujoursValide(n, maintenant, { exigerNonCommence: true })
verificateurs[TypeNotification.CONFIRMATION_RESERVATION] = (n, maintenant) =>
  rendezVousToujoursValide(n, maintenant, { exigerNonCommence: false })
verificateurs[TypeNotification.MODIFICATION_RENDEZ_VOUS] = (n, maintenant) =>
  rendezVousToujoursValide(n, maintenant, { exigerNonCommence: false })
