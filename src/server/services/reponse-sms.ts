import 'server-only'

import { CanalNotification, StatutNotification, StatutRendezVous, TypeNotification } from '@prisma/client'

import { masquerNumero } from '@/server/auth/code-sms'
import { prisma } from '@/server/db/client'
import { annulationOuverte } from '@/server/domaine/agenda'
import { cleIdempotence, emettre } from '@/server/notifications/file'
import { type RaisonReponseSms, rendreMessage } from '@/server/notifications/messages'
import { executerAnnulationPatient } from '@/server/services/acces-patient'

// Réponse OUI/NON par SMS au rappel de rendez-vous (phase 4, lot 4).
//
// Appelée par le webhook entrant (`src/app/api/webhooks/brevo/sms/route.ts`),
// qui ne fait qu'authentifier la requête, dédupliquer l'événement et parser le
// corps — tout ce qui est MÉTIER vit ici, comme le reste du dépôt (DAL stricte,
// CLAUDE.md).
//
// Rapprochement (D-lot4-E) : par numéro normalisé, vers la notification
// RAPPEL_J2/RAPPEL_H3 la plus récente ENVOYEE à ce numéro avec
// `attendReponse=true`, envoyée dans les 72 dernières heures, dont le
// rendez-vous n'a pas commencé. Aucune correspondance → réponse ignorée. Pas
// de code court dans le message (choix assumé : plus lisible pour le patient) ;
// l'ambiguïté résiduelle de deux rappels le même jour se résout par « le plus
// récent », ce que `orderBy: { envoyeeLe: 'desc' }` fait tenir.

/** « OUI »/« O »/« YES » → OUI ; « NON »/« N »/« NO » → NON ; le reste →
 *  incompris (D-lot4-F). Accents retirés avant comparaison : un patient qui
 *  répond avec une majuscule accentuée par erreur de clavier ne doit pas
 *  tomber dans « incompris ». */
export function interpreterReponse(texteBrut: string): 'OUI' | 'NON' | null {
  const normalise = texteBrut
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()

  if (normalise === 'OUI' || normalise === 'O' || normalise === 'YES') return 'OUI'
  if (normalise === 'NON' || normalise === 'N' || normalise === 'NO') return 'NON'
  return null
}

/** Brevo rend le numéro sans `+` (comme il le reçoit en émission, voir
 *  `destinataireBrevo()` de `src/server/sms/brevo.ts`) — inverse exact pour
 *  retrouver le format E.164 sous lequel `Notification.destinataire` est
 *  enregistré. */
export function normaliserTelephoneEntrant(numero: string): string {
  const nettoye = numero.trim()
  return nettoye.startsWith('+') ? nettoye : `+${nettoye}`
}

// ─── Limitation de débit (D-lot4-C) ────────────────────────────────────────
//
// Compteur EN MÉMOIRE DU PROCESS, pas de table dédiée : au plus 10 réponses
// traitées par numéro et par heure. Choisi plutôt qu'une table parce que
// `tropDeTentatives` (src/server/auth/limitation.ts) compte par ADRESSE IP —
// inadapté ici, Brevo appelle depuis SES propres serveurs, pas depuis celle du
// patient : toutes les réponses de tous les patients partageraient la même IP,
// et un seuil par IP bloquerait tout le monde à la fois plutôt qu'un numéro
// isolé.
//
// ⚠ Un compteur par process ne totalise plus rien si le déploiement devient
// multi-instance (l'hébergement HDS ciblé, D2, n'en est pas encore là) : à
// revoir alors, vers une table ou un magasin partagé.

const LIMITE_PAR_NUMERO_PAR_HEURE = 10
const FENETRE_LIMITE_MS = 3_600_000

const compteurParNumero = new Map<string, { fenetreDebut: number; count: number }>()

/** `true` si CE numéro a déjà atteint la limite pour l'heure en cours — auquel
 *  cas cet appel n'est PAS compté en plus. Incrémente sinon. */
export function limiteReponseSmsAtteinte(telephone: string, maintenant: Date): boolean {
  const maintenantMs = maintenant.getTime()
  const entree = compteurParNumero.get(telephone)

  if (!entree || maintenantMs - entree.fenetreDebut >= FENETRE_LIMITE_MS) {
    compteurParNumero.set(telephone, { fenetreDebut: maintenantMs, count: 1 })
    return false
  }

  if (entree.count >= LIMITE_PAR_NUMERO_PAR_HEURE) return true

  entree.count += 1
  return false
}

/** Test uniquement : repart d'un compteur vide entre deux suites. */
export function _reinitialiserLimiteReponseSms(): void {
  compteurParNumero.clear()
}

// ─── Rapprochement et traitement ───────────────────────────────────────────

type RappelCorrespondant = { rendezVousId: string; siteId: string | null }

async function trouverRappelPourReponse(telephone: string, maintenant: Date): Promise<RappelCorrespondant | null> {
  const depuis = new Date(maintenant.getTime() - 72 * 3_600_000)

  const notif = await prisma.notification.findFirst({
    where: {
      destinataire: telephone,
      type: { in: [TypeNotification.RAPPEL_J2, TypeNotification.RAPPEL_H3] },
      statut: StatutNotification.ENVOYEE,
      attendReponse: true,
      envoyeeLe: { gte: depuis },
      rendezVousId: { not: null },
      rendezVous: { is: { debut: { gt: maintenant } } },
    },
    orderBy: { envoyeeLe: 'desc' },
    select: { rendezVousId: true, siteId: true },
  })

  if (!notif?.rendezVousId) return null
  return { rendezVousId: notif.rendezVousId, siteId: notif.siteId }
}

async function auditReponseSms(params: {
  rendezVousId: string | null
  telephone: string
  ipAddress: string
  succeeded: boolean
  raison: string
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: 'REPONSE_SMS_TRAITEE',
      entityType: 'reponse_sms',
      entityId: params.rendezVousId,
      actorRoles: [],
      ipAddress: params.ipAddress,
      succeeded: params.succeeded,
      deniedReason: params.succeeded ? null : params.raison,
      // Jamais le texte reçu ni le numéro complet (D-lot4-D) : seuls les
      // derniers chiffres, comme `masquerNumero()` le fait déjà pour le second
      // facteur (D7).
      metadata: { telephoneMasque: masquerNumero(params.telephone), raison: params.raison },
    },
  })
}

async function emettreReponseSms(params: {
  telephone: string
  rendezVousId: string
  siteId: string | null
  raison: RaisonReponseSms
  cleSuffixe: string
}): Promise<void> {
  const { texte } = await rendreMessage(prisma, TypeNotification.REPONSE_SMS, CanalNotification.SMS, {
    raison: params.raison,
  })
  await emettre(prisma, {
    type: TypeNotification.REPONSE_SMS,
    canal: CanalNotification.SMS,
    destinataire: params.telephone,
    texte,
    rendezVousId: params.rendezVousId,
    ...(params.siteId ? { siteId: params.siteId } : {}),
    cle: cleIdempotence([TypeNotification.REPONSE_SMS, params.cleSuffixe]),
  })
}

export type ResultatReponseSms =
  | 'annule'
  | 'trop_tard'
  | 'confirme'
  | 'sans_effet'
  | 'sans_rendez_vous'
  | 'non_compris'

/**
 * Traite une réponse SMS déjà authentifiée, dédupliquée et parsée par le
 * webhook. `telephone` est déjà normalisé E.164 (voir
 * `normaliserTelephoneEntrant`, appelée par l'appelant).
 *
 * Ne lève jamais : chaque branche journalise et rend un résultat, à charge du
 * webhook de toujours répondre 200 à Brevo une fois l'authentification et le
 * corps validés (D-lot4-E) — un événement sans rendez-vous associé n'est pas
 * une erreur du point de vue de Brevo.
 */
export async function traiterReponseSms(
  telephone: string,
  texteBrut: string,
  identifiantMessageBrevo: string | undefined,
  ipAddress: string,
  maintenant: Date,
): Promise<ResultatReponseSms> {
  const interpretation = interpreterReponse(texteBrut)
  const cleSuffixe = identifiantMessageBrevo ?? `${telephone}:${maintenant.toISOString()}`

  const rappel = await trouverRappelPourReponse(telephone, maintenant)
  if (!rappel) {
    await auditReponseSms({
      rendezVousId: null,
      telephone,
      ipAddress,
      succeeded: false,
      raison: 'sans rendez-vous associé',
    })
    return 'sans_rendez_vous'
  }

  if (interpretation === null) {
    await emettreReponseSms({
      telephone,
      rendezVousId: rappel.rendezVousId,
      siteId: rappel.siteId,
      raison: 'non_compris',
      cleSuffixe,
    })
    await auditReponseSms({
      rendezVousId: rappel.rendezVousId,
      telephone,
      ipAddress,
      succeeded: false,
      raison: 'réponse non comprise',
    })
    return 'non_compris'
  }

  if (interpretation === 'NON') {
    const rdv = await prisma.rendezVous.findFirst({
      where: {
        id: rappel.rendezVousId,
        patient: { telephone, actif: true },
        statut: {
          notIn: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT, StatutRendezVous.ANNULATION_DEMANDEE],
        },
      },
      select: {
        id: true,
        debut: true,
        fin: true,
        siteId: true,
        praticienId: true,
        motifId: true,
        patientId: true,
        manquementCompte: true,
        site: { select: { nom: true, adresse: true } },
        patient: { select: { prenom: true } },
      },
    })
    if (!rdv) {
      await auditReponseSms({
        rendezVousId: rappel.rendezVousId,
        telephone,
        ipAddress,
        succeeded: false,
        raison: 'rendez-vous introuvable ou déjà résolu',
      })
      return 'sans_rendez_vous'
    }

    if (!annulationOuverte(rdv.debut, maintenant)) {
      await emettreReponseSms({
        telephone,
        rendezVousId: rdv.id,
        siteId: rdv.siteId,
        raison: 'trop_tard',
        cleSuffixe,
      })
      await auditReponseSms({
        rendezVousId: rdv.id,
        telephone,
        ipAddress,
        succeeded: false,
        raison: 'trop tard pour annuler par SMS (moins de 24h)',
      })
      return 'trop_tard'
    }

    await executerAnnulationPatient(
      {
        id: rdv.id,
        debut: rdv.debut,
        fin: rdv.fin,
        siteId: rdv.siteId,
        praticienId: rdv.praticienId,
        motifId: rdv.motifId,
        patientId: rdv.patientId,
        manquementCompte: rdv.manquementCompte,
        siteNom: rdv.site.nom,
        adresse: rdv.site.adresse,
        prenom: rdv.patient.prenom,
      },
      telephone,
      ipAddress,
      maintenant,
      'reponse sms',
    )
    await auditReponseSms({
      rendezVousId: rdv.id,
      telephone,
      ipAddress,
      succeeded: true,
      raison: 'annulation appliquée (NON)',
    })
    return 'annule'
  }

  // OUI
  const rdv = await prisma.rendezVous.findFirst({
    where: { id: rappel.rendezVousId, patient: { telephone, actif: true } },
    select: { id: true, statut: true, siteId: true },
  })
  if (!rdv) {
    await auditReponseSms({
      rendezVousId: rappel.rendezVousId,
      telephone,
      ipAddress,
      succeeded: false,
      raison: 'rendez-vous introuvable',
    })
    return 'sans_rendez_vous'
  }

  if (rdv.statut === StatutRendezVous.A_CONFIRMER) {
    await prisma.rendezVous.update({ where: { id: rdv.id }, data: { statut: StatutRendezVous.CONFIRME } })
    await emettreReponseSms({
      telephone,
      rendezVousId: rdv.id,
      siteId: rdv.siteId,
      raison: 'confirme',
      cleSuffixe,
    })
    await auditReponseSms({
      rendezVousId: rdv.id,
      telephone,
      ipAddress,
      succeeded: true,
      raison: 'confirmation appliquée (OUI)',
    })
    return 'confirme'
  }

  // Q26 : seul A_CONFIRMER passe CONFIRME. Un OUI sur un statut déjà avancé
  // (CONFIRME, ou tout autre) ne change rien — ce n'est pas une erreur, juste
  // sans effet.
  await auditReponseSms({
    rendezVousId: rdv.id,
    telephone,
    ipAddress,
    succeeded: true,
    raison: `OUI sans effet, statut déjà ${rdv.statut}`,
  })
  return 'sans_effet'
}
