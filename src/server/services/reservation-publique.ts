import 'server-only'

import { CanalNotification, StatutRendezVous, TypeNotification } from '@prisma/client'

import { condenserCode, genererCode, masquerNumero } from '@/server/auth/code-sms'
import { prisma } from '@/server/db/client'
import { avecRepriseSurInterblocage, estChevauchementBase, estInterblocage } from '@/server/db/conflits'
import { calculerFin, expliquer, verifierCreneau } from '@/server/domaine/agenda'
import { cleIdempotence, emettre } from '@/server/notifications/file'
import { rendreMessage } from '@/server/notifications/messages'
import { chargerContexteCreneau } from '@/server/services/agenda'
import { envoyerSms } from '@/server/sms/envoi'

// Réservation depuis le portail public : le second chemin d'écriture de
// l'agenda, à côté de celui du personnel.
//
// CE QUI CHANGE PAR RAPPORT À L'AUTRE. Aucun contrôle de droits — le patient
// n'a pas de compte (D4 ne s'applique pas ici). À la place : une limitation par
// adresse IP, un code à usage unique vérifié AVANT d'écrire quoi que ce soit, et
// une trace au journal sans acteur nommé.
//
// CE QUI NE CHANGE PAS. Les règles d'agenda. Le créneau est jugé par le même
// domaine et avec le même chargement que la secrétaire : deux jugements
// différents finiraient par diverger, et le portail promettrait ce que le
// cabinet ne peut pas tenir.

const VALIDITE_MINUTES = 10
const TENTATIVES_MAX = 3

/** Réservations entamées par une même adresse en une heure. Une famille partage
 *  une connexion, d'où un seuil qui n'est pas de un ou deux ; au-delà, c'est un
 *  robot, et chaque tentative coûte un SMS au cabinet. */
const MAX_PAR_IP_PAR_HEURE = 5

const MAX_PAR_NUMERO_PAR_HEURE = 5

export type DebutReservation =
  | { etat: 'code_envoye'; id: string; masque: string }
  | { etat: 'trop_de_tentatives' }
  | { etat: 'creneau_indisponible'; raison: string }
  | { etat: 'acte_non_pratique' }
  | { etat: 'envoi_impossible' }

export type FinReservation =
  | { etat: 'confirme'; rendezVousId: string; debut: Date; fin: Date }
  | { etat: 'code_invalide'; restantes: number }
  | { etat: 'code_expire' }
  | { etat: 'creneau_pris' }
  | { etat: 'reservation_bloquee' }

/**
 * Premier temps : le patient a choisi son créneau et laissé ses coordonnées.
 *
 * Rien n'est réservé à ce stade — c'est délibéré. Bloquer le créneau dès la
 * saisie permettrait à n'importe qui de geler un agenda entier sans jamais
 * confirmer. Le créneau est donc revérifié au second temps.
 */
export async function demarrerReservation(demande: {
  motifId: string
  praticienId: string
  siteId: string
  debut: Date
  nom: string
  prenom: string
  telephone: string
  ipAddress: string
}): Promise<DebutReservation> {
  const depuisUneHeure = new Date(Date.now() - 3_600_000)
  const recentes = await prisma.reservationPublique.count({
    where: { ipAddress: demande.ipAddress, createdAt: { gte: depuisUneHeure } },
  })
  if (recentes >= MAX_PAR_IP_PAR_HEURE) return { etat: 'trop_de_tentatives' }
  // Par numéro aussi (21/10) : l'adresse peut se falsifier selon l'hébergeur, pas le numéro qui reçoit le SMS.
  const pourCeNumero = await prisma.reservationPublique.count({
    where: { telephone: demande.telephone, createdAt: { gte: depuisUneHeure } },
  })
  if (pourCeNumero >= MAX_PAR_NUMERO_PAR_HEURE) return { etat: 'trop_de_tentatives' }

  const motif = await prisma.motifConsultation.findFirst({
    where: { id: demande.motifId, actif: true },
    select: { id: true, estUrgence: true },
  })
  if (!motif) return { etat: 'acte_non_pratique' }

  const lien = await prisma.praticienMotif.findUnique({
    where: { praticienId_motifId: { praticienId: demande.praticienId, motifId: motif.id } },
    select: { dureeMinutes: true },
  })
  if (!lien) return { etat: 'acte_non_pratique' }

  const fin = calculerFin(demande.debut, lien.dureeMinutes)

  const connu = await chargerContexteCreneau(demande.siteId, demande.debut, fin)
  const verdict = verifierCreneau(
    {
      praticienId: demande.praticienId,
      siteId: demande.siteId,
      debut: demande.debut,
      fin,
      motifEstUrgence: motif.estUrgence,
      // Jamais : le surbooking est une urgence que le praticien glisse
      // lui-même par-dessus un planning plein (Q19).
      surbooking: false,
    },
    connu,
  )
  if (!verdict.ok) return { etat: 'creneau_indisponible', raison: expliquer(verdict.violations) }

  const code = genererCode()
  const reservation = await prisma.reservationPublique.create({
    data: {
      motifId: motif.id,
      praticienId: demande.praticienId,
      siteId: demande.siteId,
      debut: demande.debut,
      fin,
      nom: demande.nom,
      prenom: demande.prenom,
      telephone: demande.telephone,
      codeHash: condenserCode(code),
      expiresAt: new Date(Date.now() + VALIDITE_MINUTES * 60_000),
      ipAddress: demande.ipAddress,
    },
    select: { id: true },
  })

  const envoi = await envoyerSms({
    destinataire: demande.telephone,
    texte: `Votre code de confirmation : ${code}. Valable ${VALIDITE_MINUTES} minutes.`,
  })

  if (!envoi.ok) {
    // La ligne est retirée : la garder ferait compter contre le patient une
    // tentative dont il n'est pas responsable.
    await prisma.reservationPublique.delete({ where: { id: reservation.id } })
    return { etat: 'envoi_impossible' }
  }

  return { etat: 'code_envoye', id: reservation.id, masque: masquerNumero(demande.telephone) }
}

/**
 * Second temps : le patient rend le code reçu.
 *
 * C'est seulement ici que le rendez-vous s'écrit — et que le créneau est jugé
 * une seconde fois. Entre le choix et la confirmation, quelqu'un a pu le
 * prendre : le dire clairement vaut mieux qu'une page d'erreur.
 */
/** « Hugo », « hugo », « Hugo  » et « Hûgo » désignent la même personne ; « Hugo » et « Marie » non. */
function memePrenom(a: string, b: string): boolean {
  const normaliser = (x: string) =>
    x
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[\s'’-]+/g, ' ')
      .trim()
  return normaliser(a) === normaliser(b)
}

export async function confirmerReservation(
  reservationId: string,
  codeSaisi: string,
  ipAddress: string,
): Promise<FinReservation> {
  const reservation = await prisma.reservationPublique.findUnique({
    where: { id: reservationId },
    select: {
      id: true, motifId: true, praticienId: true, siteId: true, debut: true, fin: true,
      nom: true, prenom: true, telephone: true, codeHash: true, expiresAt: true,
      tentatives: true, rendezVousId: true,
      motif: { select: { estUrgence: true } },
      site: { select: { nom: true, adresse: true } },
    },
  })

  if (!reservation || reservation.rendezVousId) return { etat: 'code_expire' }
  if (reservation.expiresAt < new Date()) return { etat: 'code_expire' }

  // L'essai est compté AVANT d'être examiné, sous condition dans la même requête : vingt codes envoyés à la
  // fois n'obtiennent que trois examens (21/10, batterie du patient).
  const { count: essai } = await prisma.reservationPublique.updateMany({
    where: { id: reservation.id, rendezVousId: null, tentatives: { lt: TENTATIVES_MAX } },
    data: { tentatives: { increment: 1 } },
  })
  if (essai === 0) return { etat: 'code_expire' }

  if (condenserCode(codeSaisi) !== reservation.codeHash) {
    const { tentatives } = await prisma.reservationPublique.findUniqueOrThrow({
      where: { id: reservation.id },
      select: { tentatives: true },
    })
    return { etat: 'code_invalide', restantes: Math.max(TENTATIVES_MAX - tentatives, 0) }
  }

  // Le numéro vérifié tient le blocage après trois manquements (Q27, D21) : une fiche bloquée sous ce numéro
  // ferme la réservation en ligne à tout le numéro — sans quoi une mère bloquée réserverait sous le prénom de son
  // enfant. Mais il ne suffit plus à reconnaître la personne (D68, 21/10) : une famille partage souvent un
  // numéro, et Hugo réservé avec le mobile de sa mère arrivait sur la fiche de Marie.
  const fiches = await prisma.patient.findMany({
    where: { telephone: reservation.telephone, actif: true },
    select: { id: true, prenom: true, reservationBloquee: true },
    orderBy: { createdAt: 'asc' },
  })
  if (fiches.some((f) => f.reservationBloquee)) return { etat: 'reservation_bloquee' }
  const existant = fiches.find((f) => memePrenom(f.prenom, reservation.prenom)) ?? null

  const connu = await chargerContexteCreneau(reservation.siteId, reservation.debut, reservation.fin)
  const verdict = verifierCreneau(
    {
      praticienId: reservation.praticienId,
      siteId: reservation.siteId,
      debut: reservation.debut,
      fin: reservation.fin,
      motifEstUrgence: reservation.motif.estUrgence,
      surbooking: false,
    },
    connu,
  )
  if (!verdict.ok) return { etat: 'creneau_pris' }

  try {
    return await avecRepriseSurInterblocage(() => prisma.$transaction(async (tx) => {
      const patientId =
        existant?.id ??
        (
          await tx.patient.create({
            data: {
              nom: reservation.nom,
              prenom: reservation.prenom,
              telephone: reservation.telephone,
              // La date de naissance manque : la fiche se complète à la venue
              // (Q33), et l'écran de l'accueil le signale.
              profilComplet: false,
            },
            select: { id: true },
          })
        ).id

      const rdv = await tx.rendezVous.create({
        data: {
          patientId,
          praticienId: reservation.praticienId,
          siteId: reservation.siteId,
          fauteuilId: verdict.fauteuilId,
          motifId: reservation.motifId,
          debut: reservation.debut,
          fin: reservation.fin,
          // Un rendez-vous pris en ligne passe par « à confirmer », comme un
          // rendez-vous pris au téléphone (Q26).
          statut: StatutRendezVous.A_CONFIRMER,
        },
        select: { id: true, debut: true, fin: true },
      })

      await tx.reservationPublique.update({
        where: { id: reservation.id },
        data: { rendezVousId: rdv.id },
      })

      // Trace sans acteur nommé : personne n'était connecté. L'origine est dans
      // les métadonnées, jamais le nom du patient ni le motif.
      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'agenda',
          entityId: rdv.id,
          actorRoles: [],
          ipAddress,
          siteId: reservation.siteId,
          metadata: {
            origine: 'portail public',
            siteId: reservation.siteId,
            praticienId: reservation.praticienId,
            patientCree: existant === null,
          },
        },
      })

      // Émise DANS la même transaction que la création du rendez-vous (phase
      // 4, lot 3, D37) : jusqu'ici, aucune confirmation ne partait après une
      // réservation en ligne — seul le code de vérification était envoyé. Le
      // worker séparé (scripts/worker-notifications.ts) l'enverra à son rythme.
      await emettre(tx, {
        type: TypeNotification.CONFIRMATION_RESERVATION,
        canal: CanalNotification.SMS,
        destinataire: reservation.telephone,
        texte: (
          await rendreMessage(tx, TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS, {
            debut: rdv.debut,
            siteNom: reservation.site.nom,
            prenom: reservation.prenom,
            adresse: reservation.site.adresse,
          })
        ).texte,
        rendezVousId: rdv.id,
        rendezVousDebut: rdv.debut,
        siteId: reservation.siteId,
        cle: cleIdempotence([
          TypeNotification.CONFIRMATION_RESERVATION,
          rdv.id,
          rdv.debut,
          reservation.telephone,
          CanalNotification.SMS,
        ]),
      })

      return { etat: 'confirme' as const, rendezVousId: rdv.id, debut: rdv.debut, fin: rdv.fin }
    }))
  } catch (e) {
    // Deux patients sur le même créneau à la même seconde : la base tranche, et
    // le perdant doit lire une phrase, pas une page d'erreur. Un interblocage
    // (D54) a déjà été rejoué par `avecRepriseSurInterblocage` ; s'il persiste
    // après trois tentatives, il est traité ici comme le chevauchement qu'il
    // recouvre presque toujours.
    if (estChevauchementBase(e) || estInterblocage(e)) return { etat: 'creneau_pris' }
    throw e
  }
}
