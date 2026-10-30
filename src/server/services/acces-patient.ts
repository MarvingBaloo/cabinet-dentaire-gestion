import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { CanalNotification, StatutRendezVous, TypeNotification } from '@prisma/client'

import { condenserCode, genererCode, masquerNumero } from '@/server/auth/code-sms'
import { prisma } from '@/server/db/client'
import { avecRepriseSurInterblocage, estChevauchementBase, estInterblocage } from '@/server/db/conflits'
import { annulationOuverte, calculerFin, compteUnManquement, verifierCreneau } from '@/server/domaine/agenda'
import { cleIdempotence, emettre } from '@/server/notifications/file'
import { rendreMessage } from '@/server/notifications/messages'
import { type CreneauPropose, HORIZON_JOURS, creneauxDisponibles } from '@/server/queries/public/creneaux'
import { ajusterManquement, chargerContexteCreneau } from '@/server/services/agenda'
import { creneauLibere } from '@/server/services/liste-attente'
import { envoyerSms } from '@/server/sms/envoi'

// Accès d'un patient à ses propres rendez-vous, sans compte au sens classique.
//
// C'est le « compte patient » de D8 : pas de mot de passe, pas de second
// facteur — le numéro vérifié par code à usage unique EST l'identité. Le même
// numéro reconnaît le patient d'une réservation sur l'autre, ce qui est déjà ce
// qui fait tenir le blocage après trois manquements (Q27).
//
// CE QUI NE DOIT JAMAIS FUIR D'ICI. Qu'un numéro soit — ou non — celui d'un
// patient du cabinet. Toutes les réponses de `demanderCode` sont donc
// identiques : savoir que le 0690… est suivi dans un cabinet dentaire est déjà
// une information de santé sur son porteur.

/**
 * Nom du cookie portant le jeton de fenêtre.
 *
 * ⚠ Il vit ICI et non dans le fichier des Server Actions : dans un module
 * `'use server'`, TOUTE export qui n'est pas une fonction asynchrone invalide
 * l'ensemble des exports du module — « The module has no exports at all ». Le
 * type-check n'en dit rien ; la page rend une erreur 500 au premier affichage.
 */
export const NOM_COOKIE_ACCES = 'cabinet_acces_patient'

const VALIDITE_CODE_MINUTES = 10
const TENTATIVES_MAX = 3

/** Fenêtre ouverte après vérification du code. Courte : elle donne sur des
 *  rendez-vous, donc sur une donnée de santé. Comptée depuis le dernier geste
 *  du patient (19/10), comme pour le personnel : celui qui hésite entre deux
 *  créneaux n'est pas mis dehors en pleine action. */
const FENETRE_MINUTES = 15

/** Demandes par adresse en une heure. Au-delà, c'est un balayage de numéros —
 *  et chaque tentative coûte un SMS au cabinet. */
const MAX_PAR_IP_PAR_HEURE = 5

const MAX_PAR_NUMERO_PAR_HEURE = 5

const condenser = (valeur: string) => createHash('sha256').update(valeur).digest('hex')

export type DemandeAcces =
  | { etat: 'code_envoye'; masque: string }
  | { etat: 'trop_de_tentatives' }

export type VerificationAcces =
  | { etat: 'ouvert'; jeton: string }
  | { etat: 'code_invalide'; restantes: number }
  | { etat: 'code_expire' }

export type AnnulationPatient =
  | { etat: 'annule' }
  | { etat: 'fenetre_expiree' }
  | { etat: 'introuvable' }
  | { etat: 'trop_tard' }

/**
 * Premier temps : le patient donne son numéro, un code part par SMS.
 *
 * Rend TOUJOURS `code_envoye` quand le débit le permet, que le numéro soit connu
 * ou non — et le masque est alors calculé sur le numéro saisi. Répondre « ce
 * numéro n'est pas chez nous » livrerait la patientèle du cabinet à qui prendrait
 * la peine d'essayer.
 */
export async function demanderAcces(telephone: string, ipAddress: string): Promise<DemandeAcces> {
  const depuis = new Date(Date.now() - 3_600_000)
  const recentes = await prisma.accesPatient.count({
    where: { ipAddress, createdAt: { gte: depuis } },
  })
  if (recentes >= MAX_PAR_IP_PAR_HEURE) return { etat: 'trop_de_tentatives' }
  // Une seconde limite, par NUMÉRO (21/10) : l'adresse se déclare dans un en-tête que le visiteur peut écrire
  // lui-même, selon l'hébergeur ; le numéro, non. Un robot qui vise un patient n'a plus que cinq codes par heure,
  // et le patient n'est plus harcelé de SMS. Comptée aussi pour un numéro inconnu : rien ne trahit qui est patient.
  const pourCeNumero = await prisma.accesPatient.count({
    where: { telephone, createdAt: { gte: depuis } },
  })
  if (pourCeNumero >= MAX_PAR_NUMERO_PAR_HEURE) return { etat: 'trop_de_tentatives' }

  const patient = await prisma.patient.findFirst({
    where: { telephone, actif: true },
    select: { id: true },
  })

  const code = genererCode()
  const expiresAt = new Date(Date.now() + VALIDITE_CODE_MINUTES * 60_000)

  // La ligne est créée même pour un numéro inconnu : sans elle, un attaquant
  // distinguerait les numéros connus au temps de réponse.
  await prisma.accesPatient.create({
    data: { telephone, codeHash: condenserCode(code), expiresAt, ipAddress },
  })

  if (patient) {
    await envoyerSms({
      destinataire: telephone,
      texte: `Votre code d'accès : ${code}. Valable ${VALIDITE_CODE_MINUTES} minutes.`,
    })
  }

  return { etat: 'code_envoye', masque: masquerNumero(telephone) }
}

/**
 * Deuxième temps : le code saisi ouvre une fenêtre de quinze minutes.
 *
 * Le jeton rendu est le secret ; seul son condensat est gardé. Il part dans un
 * cookie et ne transite jamais par une URL, où il finirait dans les journaux du
 * serveur et dans l'historique du navigateur.
 */
export async function verifierAcces(
  telephone: string,
  saisi: string,
): Promise<VerificationAcces> {
  const acces = await prisma.accesPatient.findFirst({
    where: { telephone, jetonHash: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, codeHash: true, expiresAt: true, tentatives: true },
  })

  if (!acces) return { etat: 'code_expire' }
  if (acces.expiresAt < new Date()) return { etat: 'code_expire' }

  // L'essai est compté AVANT d'être examiné, et sous condition dans la même requête : vingt codes envoyés à
  // la fois n'obtiennent que trois examens (21/10, batterie du patient — ils en obtenaient vingt).
  const { count: essai } = await prisma.accesPatient.updateMany({
    where: { id: acces.id, jetonHash: null, tentatives: { lt: TENTATIVES_MAX } },
    data: { tentatives: { increment: 1 } },
  })
  if (essai === 0) return { etat: 'code_expire' }

  if (condenserCode(saisi) !== acces.codeHash) {
    const { tentatives } = await prisma.accesPatient.findUniqueOrThrow({
      where: { id: acces.id },
      select: { tentatives: true },
    })
    return { etat: 'code_invalide', restantes: Math.max(TENTATIVES_MAX - tentatives, 0) }
  }

  const jeton = randomBytes(32).toString('base64url')
  // Sous condition aussi : un code n'ouvre qu'une fenêtre, même saisi deux fois à la même seconde.
  const { count: ouvert } = await prisma.accesPatient.updateMany({
    where: { id: acces.id, jetonHash: null },
    data: {
      jetonHash: condenser(jeton),
      fenetreExpire: new Date(Date.now() + FENETRE_MINUTES * 60_000),
    },
  })
  if (ouvert === 0) return { etat: 'code_expire' }

  return { etat: 'ouvert', jeton }
}

/**
 * La fenêtre ouverte par ce jeton, ou `null` si elle a expiré ou n'existe pas.
 * Chaque usage la prolonge de quinze minutes : elle se ferme après quinze
 * minutes SANS activité, pas quinze minutes après le code.
 *
 * Exportée : la liste d'attente (`src/server/services/inscription-liste-attente.ts`,
 * D29) réutilise EXACTEMENT ce mécanisme d'identification — celui de D23 — au
 * lieu d'un second système de code à usage unique.
 */
export async function fenetreValide(jeton: string) {
  const maintenant = new Date()
  const jetonHash = condenser(jeton)
  // Prolongée seulement si elle est encore ouverte : une fenêtre expirée ne se
  // rouvre jamais, il faut un nouveau code.
  const { count } = await prisma.accesPatient.updateMany({
    where: { jetonHash, fenetreExpire: { gte: maintenant } },
    data: { fenetreExpire: new Date(maintenant.getTime() + FENETRE_MINUTES * 60_000) },
  })
  if (count === 0) return null
  return prisma.accesPatient.findUnique({
    where: { jetonHash },
    select: { id: true, telephone: true, fenetreExpire: true },
  })
}

/**
 * Les rendez-vous à venir du patient, avec ce qu'il faut pour les reconnaître.
 * Les passés sont lus à part (`historiqueDuPatient`) : ils ne s'annulent ni ne
 * se déplacent.
 */
/**
 * Le patient referme lui-même son espace (« Fermer mon espace », 21/10) : la fenêtre est close en base, pas
 * seulement le cookie effacé — sur la tablette familiale, le jeton ne doit plus rien ouvrir, même recopié.
 */
export async function fermerFenetre(jeton: string): Promise<void> {
  await prisma.accesPatient.updateMany({
    where: { jetonHash: condenser(jeton) },
    data: { fenetreExpire: new Date(Date.now() - 1000) },
  })
}

export async function rendezVousDuPatient(jeton: string, maintenant: Date) {
  const acces = await fenetreValide(jeton)
  if (!acces) return null

  const rdvs = await prisma.rendezVous.findMany({
    where: {
      patient: { telephone: acces.telephone, actif: true },
      site: { actif: true },
      debut: { gte: maintenant },
      statut: { notIn: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT] },
    },
    select: {
      id: true,
      debut: true,
      fin: true,
      statut: true,
      site: { select: { nom: true, adresse: true } },
      motif: { select: { libelle: true } },
      praticien: { select: { nom: true, prenom: true } },
    },
    orderBy: { debut: 'asc' },
  })

  return rdvs.map(({ statut, ...r }) => ({
    ...r,
    // Une demande d'annulation en attente (D17, retournée le 2026-09-23) gèle
    // les deux gestes : ni annulable — `annulerParPatient` la refuse déjà —,
    // ni déplaçable — un déplacement écraserait `statutAvantAnnulation` avant
    // qu'un refus ait pu s'en servir (même motif que `annulerParPatient`
    // ci-dessous, D28). Le rendez-vous reste visible : rien ne disparaît sans
    // explication, il n'offre simplement plus ces deux boutons.
    annulable: annulationOuverte(r.debut, maintenant) && statut !== StatutRendezVous.ANNULATION_DEMANDEE,
    deplacable: statut !== StatutRendezVous.ANNULATION_DEMANDEE,
  }))
}

/**
 * Les rendez-vous passés du patient (19/10, demande de Marving) : date, acte,
 * praticien, cabinet et ce qu'il en est advenu. Seulement l'agenda — ni soins
 * détaillés, ni devis, ni radios, qui vivent dans le logiciel de gestion du
 * cabinet et demanderaient une protection plus forte qu'un code par SMS.
 */
export async function historiqueDuPatient(jeton: string, maintenant: Date) {
  const acces = await fenetreValide(jeton)
  if (!acces) return null

  return prisma.rendezVous.findMany({
    where: { patient: { telephone: acces.telephone, actif: true }, site: { actif: true }, debut: { lt: maintenant } },
    select: {
      id: true,
      debut: true,
      statut: true,
      site: { select: { nom: true } },
      motif: { select: { libelle: true } },
      praticien: { select: { nom: true, prenom: true } },
    },
    orderBy: { debut: 'desc' },
    take: 50,
  })
}

export type RendezVousAnnulable = {
  id: string
  debut: Date
  fin: Date
  siteId: string
  praticienId: string
  motifId: string
  patientId: string
  manquementCompte: boolean
  /** Nom du site et prénom du patient — champs de fusion {cabinet}/{prenom}
   *  du SMS de confirmation (lot 5a). `adresse` suit `Site.adresse` : `null`
   *  tant que le cabinet ne l'a pas donnée (D24). */
  siteNom: string
  prenom: string
  adresse: string | null
}

/**
 * Cœur métier de l'annulation par un patient (D22/Q27) : reçoit un
 * rendez-vous DÉJÀ retrouvé et vérifié comme appartenant au bon numéro. Ne
 * revérifie que le délai de 24 h ICI, jamais sur la foi de l'appelant — la
 * correspondance patient/rendez-vous est la responsabilité de l'appelant, pas
 * la sienne.
 *
 * Extraite d'`annulerParPatient` (jeton, D23) pour être réutilisée par la
 * réponse SMS au rappel (`src/server/services/reponse-sms.ts`, lot 4), qui
 * identifie le patient autrement — par le numéro qui a répondu au rappel,
 * sans jeton de fenêtre. Un seul endroit décide ce qu'annuler veut dire pour
 * un patient : manquement (Q27), libération vers la liste d'attente (D29),
 * SMS de confirmation.
 *
 * `origine` ne change que la trace au journal, jamais la règle.
 */
/** Un rendez-vous déjà annulé, constaté absent ou en attente d'une décision du praticien ne s'annule plus. */
const STATUTS_NON_ANNULABLES: StatutRendezVous[] = [
  StatutRendezVous.ANNULE,
  StatutRendezVous.ABSENT,
  StatutRendezVous.ANNULATION_DEMANDEE,
]

export async function executerAnnulationPatient(
  rdv: RendezVousAnnulable,
  telephone: string,
  ipAddress: string,
  maintenant: Date,
  origine: 'portail public' | 'reponse sms',
): Promise<Extract<AnnulationPatient, { etat: 'annule' | 'trop_tard' | 'introuvable' }>> {
  if (!annulationOuverte(rdv.debut, maintenant)) return { etat: 'trop_tard' }

  const applique = await prisma.$transaction(async (tx) => {
    // Sous condition du statut : deux « Annuler » touchés coup sur coup n'annulent qu'une fois, et ne
    // comptent qu'une absence (21/10 — ils en comptaient deux).
    const { count } = await tx.rendezVous.updateMany({
      where: { id: rdv.id, statut: { notIn: STATUTS_NON_ANNULABLES } },
      data: { statut: StatutRendezVous.ANNULE },
    })
    if (count === 0) return false

    // `patient` et non `cabinet` : c'est ici, et seulement ici, qu'une annulation
    // coûte un manquement. Celle que pose la secrétaire n'en coûte aucun (Q5).
    await ajusterManquement(tx, rdv, compteUnManquement(StatutRendezVous.ANNULE, 'patient'))

    await tx.auditLog.create({
      data: {
        action: 'UPDATE',
        entityType: 'agenda',
        entityId: rdv.id,
        actorRoles: [],
        ipAddress,
        siteId: rdv.siteId,
        // Sans nom ni numéro : le journal se garde bien plus longtemps que ce
        // dont il porte la trace.
        metadata: { origine, annulePar: 'patient' },
      },
    })

    // Émise DANS la même transaction (phase 4, lot 3, D37) : confirme au
    // patient que son annulation a bien été prise en compte.
    await emettre(tx, {
      type: TypeNotification.ANNULATION_PATIENT,
      canal: CanalNotification.SMS,
      destinataire: telephone,
      texte: (
        await rendreMessage(tx, TypeNotification.ANNULATION_PATIENT, CanalNotification.SMS, {
          debut: rdv.debut,
          siteNom: rdv.siteNom,
          prenom: rdv.prenom,
          adresse: rdv.adresse,
        })
      ).texte,
      rendezVousId: rdv.id,
      rendezVousDebut: rdv.debut,
      siteId: rdv.siteId,
      cle: cleIdempotence([TypeNotification.ANNULATION_PATIENT, rdv.id, rdv.debut, telephone, CanalNotification.SMS]),
    })
    return true
  })
  if (!applique) return { etat: 'introuvable' }

  // Liste d'attente (lot D, D29) : ce créneau vient de se libérer.
  await creneauLibere({
    siteId: rdv.siteId,
    praticienId: rdv.praticienId,
    motifId: rdv.motifId,
    debut: rdv.debut,
    fin: rdv.fin,
    ipAddress,
  })

  return { etat: 'annule' }
}

/**
 * Le patient annule lui-même.
 *
 * Deux gardes qui ne se remplacent pas : le rendez-vous doit appartenir au
 * numéro de la fenêtre — sinon un jeton volé annulerait ceux des autres — et le
 * délai de 24 h est revérifié dans `executerAnnulationPatient`, jamais sur la
 * foi de l'écran. Un bouton caché n'est pas une règle.
 */
export async function annulerParPatient(
  jeton: string,
  rendezVousId: string,
  ipAddress: string,
  maintenant: Date,
): Promise<AnnulationPatient> {
  const acces = await fenetreValide(jeton)
  if (!acces) return { etat: 'fenetre_expiree' }

  const rdv = await prisma.rendezVous.findFirst({
    where: {
      id: rendezVousId,
      patient: { telephone: acces.telephone, actif: true },
      // Un cabinet décoché n'existe plus pour le patient (D74) : ni à lire, ni à annuler, ni à déplacer.
      site: { actif: true },
      // Exclut aussi ANNULATION_DEMANDEE (D17, retournée le 2026-09-23) : une
      // demande de l'accueil est déjà en cours de décision par le praticien, le
      // patient ne doit pas pouvoir la court-circuiter en annulant lui-même par
      // dessus — ce qui écraserait le statut d'avant que le refus doit pouvoir
      // restaurer. Sans rapport avec D22, qui reste inchangée : ceci ne fait que
      // garder cette liste d'accord avec les deux autres du dépôt.
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
  if (!rdv) return { etat: 'introuvable' }

  const annulable: RendezVousAnnulable = {
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
  }

  return executerAnnulationPatient(annulable, acces.telephone, ipAddress, maintenant, 'portail public')
}

export type CreneauDeplacement = CreneauPropose

/**
 * Les créneaux où CE rendez-vous peut être replacé.
 *
 * Même moteur que la réservation (`creneauxDisponibles`, D12) : borné au
 * motif et au site déjà pris par le patient (Q28/D28), et à l'horizon
 * d'ouverture de deux mois — jamais un troisième calcul qui finirait par
 * diverger des deux autres.
 *
 * Le praticien n'est PAS imposé : comme à la réservation, « peu importe »
 * reste un choix légitime pour un déplacement (D28, lecture retenue faute de
 * règle du cabinet).
 *
 * Rend `null` sans distinguer « fenêtre expirée » de « rendez-vous
 * introuvable » : l'appelant (Server Action) n'a rien à faire de plus fin
 * que « recommencez ».
 */
export async function creneauxPourDeplacement(
  jeton: string,
  rendezVousId: string,
  maintenant: Date,
): Promise<CreneauDeplacement[] | null> {
  const acces = await fenetreValide(jeton)
  if (!acces) return null

  const rdv = await prisma.rendezVous.findFirst({
    where: {
      id: rendezVousId,
      patient: { telephone: acces.telephone, actif: true },
      // Un cabinet décoché n'existe plus pour le patient (D74) : ni à lire, ni à annuler, ni à déplacer.
      site: { actif: true },
      // Les mêmes trois statuts qu'`annulerParPatient` exclut : un rendez-vous
      // déjà annulé ou non honoré n'a plus de créneau à déplacer, et une
      // demande d'annulation en attente n'est pas déplaçable (D27, D28).
      statut: {
        notIn: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT, StatutRendezVous.ANNULATION_DEMANDEE],
      },
      debut: { gte: maintenant },
    },
    select: { motifId: true, siteId: true },
  })
  if (!rdv) return null

  return creneauxDisponibles({ motifId: rdv.motifId, siteId: rdv.siteId, debut: maintenant })
}

export type DeplacementPatient =
  | { etat: 'deplace'; rendezVousId: string; debut: Date; fin: Date }
  | { etat: 'fenetre_expiree' }
  | { etat: 'introuvable' }
  | { etat: 'creneau_indisponible' }
  | { etat: 'hors_perimetre' }

/**
 * Le patient déplace lui-même son rendez-vous vers un autre créneau libre
 * (Q28, lue comme « le patient peut se replacer lui-même » — D28).
 *
 * MODIFICATION EN PLACE, même id — pas d'annulation suivie d'une création.
 * Deux raisons : l'historique reste lisible (un déplacement se lit comme tel
 * au journal, pas comme une annulation suivie d'une réservation sans rapport
 * apparent), et surtout aucun manquement ne peut s'y glisser par erreur — il
 * n'y a même pas d'appel à `ajusterManquement` dans cette fonction. Un
 * déplacement ne coûte JAMAIS rien au patient, contrairement à l'annulation
 * (D22/Q27) : c'est le point central du brief.
 *
 * Contrairement à `annulerParPatient`, AUCUNE fenêtre de 24 h ici : Q28
 * réserve le délai à l'annulation, et sous 24 h le déplacement est ce qui
 * REMPLACE « appelez le cabinet ». Un patient bloqué (D21, trois
 * manquements) peut néanmoins déplacer — ça ne compte jamais comme
 * manquement et ça évite précisément l'absence qui aggraverait son
 * compteur — `Patient.reservationBloquee` n'est donc jamais lu ici.
 *
 * Le créneau est jugé deux fois, comme partout ailleurs dans ce dépôt (D12) :
 * une première fois pour proposer la liste (`creneauxPourDeplacement`), une
 * seconde ICI, juste avant d'écrire, parce qu'entre les deux quelqu'un a pu
 * le prendre. La contrainte d'exclusion de la base reste le dernier mot :
 * l'ancien créneau n'est libéré que si le nouveau est acquis, dans la MÊME
 * transaction — une seule ligne change de date, elle ne change jamais deux
 * fois.
 */
export async function deplacerParPatient(
  jeton: string,
  rendezVousId: string,
  nouveauDebut: Date,
  nouveauPraticienId: string,
  ipAddress: string,
  maintenant: Date,
): Promise<DeplacementPatient> {
  const acces = await fenetreValide(jeton)
  if (!acces) return { etat: 'fenetre_expiree' }

  const rdv = await prisma.rendezVous.findFirst({
    where: {
      id: rendezVousId,
      patient: { telephone: acces.telephone, actif: true },
      // Un cabinet décoché n'existe plus pour le patient (D74) : ni à lire, ni à annuler, ni à déplacer.
      site: { actif: true },
      statut: {
        notIn: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT, StatutRendezVous.ANNULATION_DEMANDEE],
      },
      debut: { gte: maintenant },
    },
    select: {
      id: true,
      siteId: true,
      motifId: true,
      praticienId: true,
      debut: true,
      fin: true,
      patientId: true,
      manquementCompte: true,
      motif: { select: { estUrgence: true } },
      site: { select: { nom: true, adresse: true } },
      patient: { select: { prenom: true } },
    },
  })
  if (!rdv) return { etat: 'introuvable' }

  // Même horizon que la lecture (`creneauxDisponibles`) : un lien gardé
  // ouvert ne doit pas permettre de viser plus loin que ce que le portail
  // proposerait lui-même ce jour-là.
  const horizon = new Date(maintenant.getTime() + HORIZON_JOURS * 86_400_000)
  if (nouveauDebut < maintenant || nouveauDebut > horizon) return { etat: 'hors_perimetre' }

  // Même motif, donc même durée indicative — mais avec CE praticien : sa
  // fiche peut différer de l'actuelle, à condition qu'il pratique l'acte
  // (D14), exactement comme à la réservation.
  const lien = await prisma.praticienMotif.findUnique({
    where: { praticienId_motifId: { praticienId: nouveauPraticienId, motifId: rdv.motifId } },
    select: { dureeMinutes: true },
  })
  if (!lien) return { etat: 'hors_perimetre' }

  const fin = calculerFin(nouveauDebut, lien.dureeMinutes)

  const connu = await chargerContexteCreneau(rdv.siteId, nouveauDebut, fin)
  const verdict = verifierCreneau(
    {
      praticienId: nouveauPraticienId,
      siteId: rdv.siteId,
      debut: nouveauDebut,
      fin,
      motifEstUrgence: rdv.motif.estUrgence,
      surbooking: false,
      // Sans quoi le rendez-vous se chevaucherait lui-même : un patient qui
      // garde son praticien et avance de dix minutes serait refusé.
      rendezVousId: rdv.id,
    },
    connu,
  )
  if (!verdict.ok) return { etat: 'creneau_indisponible' }

  try {
    const nouveau = await avecRepriseSurInterblocage(() => prisma.$transaction(async (tx) => {
      const maj = await tx.rendezVous.update({
        where: { id: rdv.id },
        data: {
          debut: nouveauDebut,
          fin,
          praticienId: nouveauPraticienId,
          fauteuilId: verdict.fauteuilId,
        },
        select: { id: true, debut: true, fin: true },
      })

      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entityType: 'agenda',
          entityId: maj.id,
          actorRoles: [],
          ipAddress,
          siteId: rdv.siteId,
          // Sans nom ni numéro, comme les autres traces du portail public.
          metadata: {
            origine: 'portail public',
            deplacePar: 'patient',
            avant: { debut: rdv.debut.toISOString(), fin: rdv.fin.toISOString() },
            apres: { debut: maj.debut.toISOString(), fin: maj.fin.toISOString() },
          },
        },
      })

      // Émise DANS la même transaction (phase 4, lot 3, D37) : ce n'est plus
      // un envoi synchrone qu'il fallait garder hors transaction pour ne pas
      // défaire un déplacement déjà acté si Brevo était en panne — `emettre`
      // n'est qu'une écriture en base, sans appel réseau. Le jeton a déjà
      // authentifié ce numéro (D23) : aucun code à revérifier ici, contrairement
      // au premier temps de la réservation (D28).
      await emettre(tx, {
        type: TypeNotification.MODIFICATION_RENDEZ_VOUS,
        canal: CanalNotification.SMS,
        destinataire: acces.telephone,
        texte: (
          await rendreMessage(tx, TypeNotification.MODIFICATION_RENDEZ_VOUS, CanalNotification.SMS, {
            debut: maj.debut,
            siteNom: rdv.site.nom,
            prenom: rdv.patient.prenom,
            adresse: rdv.site.adresse,
          })
        ).texte,
        rendezVousId: maj.id,
        rendezVousDebut: maj.debut,
        siteId: rdv.siteId,
        cle: cleIdempotence([
          TypeNotification.MODIFICATION_RENDEZ_VOUS,
          maj.id,
          maj.debut,
          acces.telephone,
          CanalNotification.SMS,
        ]),
      })

      return maj
    }))

    // Liste d'attente (lot D, D29) : l'ANCIEN créneau vient de se libérer.
    // Hors transaction, hors rejeu (D54) : si la transaction ci-dessus a
    // réussi, l'ancien créneau est libre, point final ; le rejeu ne rejoue
    // QUE l'écriture en base, jamais ce qui la suit.
    await creneauLibere({
      siteId: rdv.siteId,
      praticienId: rdv.praticienId,
      motifId: rdv.motifId,
      debut: rdv.debut,
      fin: rdv.fin,
      ipAddress,
    })

    return { etat: 'deplace', rendezVousId: nouveau.id, debut: nouveau.debut, fin: nouveau.fin }
  } catch (e) {
    // Deux patients qui déplacent — ou réservent — sur le même créneau à la
    // même seconde : la base tranche, le perdant lit une phrase, pas une
    // page d'erreur. Un interblocage (D54) a déjà été rejoué ; s'il persiste
    // après trois tentatives, même réponse qu'un chevauchement.
    if (estChevauchementBase(e) || estInterblocage(e)) return { etat: 'creneau_indisponible' }
    throw e
  }
}

/** Purge des accès périmés. Appelée par la tâche planifiée, comme les codes. */
export async function purgerAccesExpires(maintenant: Date): Promise<number> {
  const { count } = await prisma.accesPatient.deleteMany({
    where: {
      expiresAt: { lt: maintenant },
      OR: [{ fenetreExpire: null }, { fenetreExpire: { lt: maintenant } }],
    },
  })
  return count
}
