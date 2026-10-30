'use server'

import { NiveauUrgence, StatutRendezVous } from '@prisma/client'
import { revalidatePath } from 'next/cache'

import { bornesDuJour, heureCabinet, instantCabinet, jourLocal } from '@/lib/dates'
import { niveauRetenu } from '@/lib/niveaux-urgence'
import { centimesDepuisSaisie } from '@/lib/euros'
import { afficherTelephone } from '@/lib/telephone'

import { PermissionDeniedError, requirePermission } from '@/server/auth/permissions'
import { PorteeSiteError, exigerAccesSite } from '@/server/auth/portee'
import { exigerContexte } from '@/server/auth/session-courante'
import {
  ActeNonPratiqueError,
  AnnulationDejaDemandeeError,
  AnnulationReserveeAuPraticienError,
  AucuneAnnulationEnAttenteError,
  CreneauPrisEntretempsError,
  CreneauRefuseError,
  ReserveAuPraticienError,
  annulerRendezVous,
  apercuCreneau,
  changerStatut,
  corrigerMontant,
  corrigerNiveauUrgence,
  marquerDemandeUrgenceTraitee,
  creerPatient,
  creerRendezVous,
  deplacerRendezVous,
  dupliquerRendezVous,
  refuserAnnulation,
  validerAnnulation,
  RetourImpossibleError,
} from '@/server/services/agenda'
import {
  annulerRendezVousSchema,
  changerStatutSchema,
  corrigerMontantSchema,
  creerPatientSchema,
  creerRendezVousSchema,
  deplacerRendezVousSchema,
  dupliquerRendezVousSchema,
  refuserAnnulationSchema,
  validerAnnulationSchema,
} from '@/server/validation/agenda'
import { lireFicheRendezVous, listerMotifs, listerPraticiens } from '@/server/queries/agenda'
import { creneauxDisponibles } from '@/server/queries/public/creneaux'

// Server Actions et non routes API : c'est d'elles que vient la protection CSRF
// (D6). Chacune commence par `exigerContexte`, qui redirige si la session n'est
// pas pleinement valide — les gardes de permission et de portée, eux, sont dans
// la DAL et le service (D4, D5).

export type EtatAgenda = {
  erreur?: string
  succes?: string
  id?: string
  /** De quoi nommer à l'écran ce qui vient d'être créé, sans le relire. */
  libelle?: string
  /**
   * La saisie telle qu'elle est arrivée, renvoyée en cas de refus.
   *
   * React remet le formulaire à zéro après chaque Server Action. Sans ce
   * renvoi, un créneau refusé effacerait tout — patient, praticien, motif,
   * heure — et il faudrait tout retaper pour décaler le rendez-vous d'un
   * quart d'heure. C'est aussi ce qui repeuple l'écran quand le navigateur
   * n'exécute pas de JavaScript.
   */
  valeurs?: Record<string, string>
  /** Change à chaque refus : c'est lui qui fait remonter le formulaire. */
  jeton?: string
}

/**
 * Traduit les erreurs métier en message affichable, et laisse remonter le reste.
 *
 * Ce qui n'est pas traduit remonte tel quel et devient une erreur serveur : une
 * panne doit rester bruyante. Un `catch` fourre-tout transformerait un bug en
 * « une erreur est survenue » et le rendrait introuvable.
 */
function messageErreur(e: unknown): string {
  // Le domaine a déjà rédigé le refus en français, violation par violation.
  if (e instanceof CreneauRefuseError) return e.message
  if (e instanceof CreneauPrisEntretempsError) return e.message
  if (e instanceof ActeNonPratiqueError) return e.message
  if (e instanceof ReserveAuPraticienError) return e.message
  if (e instanceof AnnulationDejaDemandeeError) return e.message
  if (e instanceof AucuneAnnulationEnAttenteError) return e.message
  if (e instanceof AnnulationReserveeAuPraticienError) return e.message
  if (e instanceof RetourImpossibleError) return e.message
  if (e instanceof PorteeSiteError) return "Ce cabinet n'est pas dans votre périmètre."
  if (e instanceof PermissionDeniedError) return "Vous n'avez pas le droit d'effectuer cette action."
  throw e
}

/** Premier message de validation, préfixé du champ fautif. */
function premierProbleme(erreur: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const premier = erreur.issues[0]
  return `${premier?.path.join('.') ?? 'saisie'} : ${premier?.message ?? 'invalide'}`
}

/** Champ de formulaire en chaîne, jamais `null` : `FormData` rend `null` pour un
 *  champ absent, et `String(null)` vaudrait « null ». */
function lire(donnees: FormData, champ: string): string {
  const v = donnees.get(champ)
  return typeof v === 'string' ? v : ''
}

/** L'agenda se relit à chaque mutation : deux postes le regardent en même temps. */
function rafraichirAgenda() {
  revalidatePath('/tableau-de-bord/agenda')
  // L'encart de demandes en attente vit sur le tableau de bord lui-même.
  revalidatePath('/tableau-de-bord')
}

/**
 * Le résultat d'une annulation dépend de qui l'a demandée (D17, retournée le
 * 2026-09-23) : le praticien du rendez-vous annule pour de bon, tout autre
 * appelant ne fait que demander — même geste, deux issues.
 */
function messageAnnulation(statut: StatutRendezVous): string {
  return statut === StatutRendezVous.ANNULATION_DEMANDEE
    ? "Demande d'annulation envoyée. En attente de la décision du praticien concerné."
    : 'Rendez-vous annulé. Le créneau est de nouveau disponible.'
}

export type ApercuVue =
  | { etat: 'incomplet' }
  | { etat: 'libre'; debut: string; fin: string; duree: number; fauteuil: string }
  | { etat: 'refuse'; duree: number | null; raison: string; planningPlein: boolean }

/**
 * Récapitulatif en direct de l'écran « Nouveau rendez-vous » : le verdict de
 * `apercuCreneau` pour la saisie en cours. Lecture seule ; une saisie
 * incomplète ne consulte rien.
 */
export async function apercuCreneauAction(donnees: FormData): Promise<ApercuVue> {
  const ctx = await exigerContexte()
  const debut = instantCabinet(lire(donnees, 'jour'), lire(donnees, 'heure'))
  const saisie = creerRendezVousSchema.omit({ patientId: true, note: true }).safeParse({
    praticienId: donnees.get('praticienId'),
    motifId: donnees.get('motifId'),
    siteId: donnees.get('siteId'),
    debut,
    dureeMinutes: donnees.get('dureeMinutes') ? Number(donnees.get('dureeMinutes')) : undefined,
    surbooking: donnees.get('surbooking') === 'on',
    horsHoraire: donnees.get('horsHoraire') === 'on',
  })
  if (!debut || !saisie.success) return { etat: 'incomplet' }

  try {
    const a = await apercuCreneau(ctx, saisie.data)
    return a.ok
      ? { etat: 'libre', debut: a.debut.toISOString(), fin: a.fin.toISOString(), duree: a.duree, fauteuil: a.fauteuil }
      : { etat: 'refuse', duree: a.duree, raison: a.raison, planningPlein: a.planningPlein }
  } catch (e) {
    return { etat: 'refuse', duree: null, raison: messageErreur(e), planningPlein: false }
  }
}

export async function creerRendezVousAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()

  const valeurs = {
    patientId: lire(donnees, 'patientId'),
    praticienId: lire(donnees, 'praticienId'),
    motifId: lire(donnees, 'motifId'),
    siteId: lire(donnees, 'siteId'),
    jour: lire(donnees, 'jour'),
    heure: lire(donnees, 'heure'),
    dureeMinutes: lire(donnees, 'dureeMinutes'),
    note: lire(donnees, 'note'),
  }
  const refus = (erreur: string): EtatAgenda => ({ erreur, valeurs, jeton: crypto.randomUUID() })

  // L'écran envoie une date et une heure séparées, lues à l'heure du cabinet.
  // La conversion est faite ici et non dans le composant : un champ `datetime-local`
  // rend « 2027-04-05T09:30 », que rien n'attache à un fuseau, et laisser le
  // navigateur du poste d'accueil décider du sien reviendrait à faire dépendre
  // l'heure du rendez-vous du réglage de la machine.
  const debut = instantCabinet(valeurs.jour, valeurs.heure)
  if (!debut) return refus('Date ou heure : saisie invalide.')

  const saisie = creerRendezVousSchema.safeParse({
    patientId: donnees.get('patientId'),
    praticienId: donnees.get('praticienId'),
    motifId: donnees.get('motifId'),
    siteId: donnees.get('siteId'),
    debut,
    dureeMinutes: donnees.get('dureeMinutes') ? Number(donnees.get('dureeMinutes')) : undefined,
    note: donnees.get('note') || undefined,
    // Cases à cocher natives : absentes du FormData quand elles ne sont pas
    // cochées, d'où la comparaison à la valeur plutôt qu'un Boolean() direct.
    surbooking: donnees.get('surbooking') === 'on',
    horsHoraire: donnees.get('horsHoraire') === 'on',
  })
  if (!saisie.success) return refus(premierProbleme(saisie.error))

  try {
    const rdv = await creerRendezVous(ctx, saisie.data)
    rafraichirAgenda()
    return { succes: 'Rendez-vous enregistré.', id: rdv.id }
  } catch (e) {
    return refus(messageErreur(e))
  }
}

/**
 * Duplication (lot 5) : seule une date et une heure se saisissent, patient,
 * motif et praticien viennent de la source (`id`) et ne sont pas dans le
 * formulaire. Même comportement de refus que la création : message affiché,
 * date/heure déjà tapées conservées (React remet les formulaires à zéro après
 * une Server Action, cf. `EtatAgenda.valeurs`).
 */
export async function dupliquerRendezVousAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()

  const valeurs = {
    id: lire(donnees, 'id'),
    jour: lire(donnees, 'jour'),
    heure: lire(donnees, 'heure'),
  }
  const refus = (erreur: string): EtatAgenda => ({ erreur, valeurs, jeton: crypto.randomUUID() })

  const debut = instantCabinet(valeurs.jour, valeurs.heure)
  if (!debut) return refus('Date ou heure : saisie invalide.')

  const saisie = dupliquerRendezVousSchema.safeParse({ id: donnees.get('id'), debut })
  if (!saisie.success) return refus(premierProbleme(saisie.error))

  try {
    const rdv = await dupliquerRendezVous(ctx, saisie.data)
    rafraichirAgenda()
    return { succes: 'Rendez-vous dupliqué.', id: rdv.id }
  } catch (e) {
    return refus(messageErreur(e))
  }
}

export async function deplacerRendezVousAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()

  // Même jour, heure différente : le geste est « le praticien a vingt minutes
  // de retard », pas « ce rendez-vous part la semaine prochaine ». Le jour vient
  // de la vue affichée, la secrétaire ne saisit que l'heure.
  const debut = instantCabinet(lire(donnees, 'jour'), lire(donnees, 'heure'))
  if (!debut) return { erreur: 'Heure invalide.' }

  const saisie = deplacerRendezVousSchema.safeParse({
    id: donnees.get('id'),
    debut,
    dureeMinutes: donnees.get('dureeMinutes') ? Number(donnees.get('dureeMinutes')) : undefined,
    // Colonne visée par un glisser-déposer (lot 6) : absent du formulaire
    // « Décaler à » ordinaire, qui ne choisit pas de fauteuil.
    fauteuilId: donnees.get('fauteuilId') || undefined,
  })
  if (!saisie.success) return { erreur: premierProbleme(saisie.error) }

  try {
    await deplacerRendezVous(ctx, saisie.data)
    rafraichirAgenda()
    return { succes: 'Rendez-vous déplacé.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

/** « Modifier » dans la fiche (27/10) : jour, heure, praticien, acte et note, avec les règles de la prise. */
export async function modifierRendezVousAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()

  const debut = instantCabinet(lire(donnees, 'jour'), lire(donnees, 'heure'))
  if (!debut) return { erreur: 'Jour ou heure invalide.' }

  const saisie = deplacerRendezVousSchema.safeParse({
    id: donnees.get('id'),
    debut,
    praticienId: donnees.get('praticienId') || undefined,
    motifId: donnees.get('motifId') || undefined,
    note: lire(donnees, 'note'),
  })
  if (!saisie.success) return { erreur: premierProbleme(saisie.error) }

  try {
    await deplacerRendezVous(ctx, saisie.data)
    rafraichirAgenda()
    return { succes: 'Rendez-vous modifié.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

/**
 * « Annuler » du bandeau qui suit un glisser-déposer (23/10) : le rendez-vous revient à sa place d'avant, sans SMS.
 * Le service vérifie qu'il s'agit bien du dernier déplacement fait par cette personne, il y a moins de deux minutes.
 */
export async function revenirAvantDeplacementAction(donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()
  const debut = instantCabinet(lire(donnees, 'jour'), lire(donnees, 'heure'))
  if (!debut) return { erreur: 'Heure invalide.' }
  const saisie = deplacerRendezVousSchema.safeParse({
    id: donnees.get('id'),
    debut,
    dureeMinutes: donnees.get('dureeMinutes') ? Number(donnees.get('dureeMinutes')) : undefined,
    fauteuilId: donnees.get('fauteuilId') || undefined,
  })
  if (!saisie.success) return { erreur: premierProbleme(saisie.error) }
  try {
    await deplacerRendezVous(ctx, saisie.data, { retourArriere: true })
    rafraichirAgenda()
    return { succes: 'Déplacement annulé.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

export async function changerStatutAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()

  // Au passage « En caisse » (D81) : un montant saisi (« Autre montant »), sinon le prix du soin.
  const montant = lire(donnees, 'montant')
  const montantCentimes = montant ? centimesDepuisSaisie(montant) : undefined
  if (montantCentimes === null) return { erreur: 'Montant invalide : écrivez par exemple 60 ou 62,50.' }
  const saisie = changerStatutSchema.safeParse({
    id: donnees.get('id'),
    statut: donnees.get('statut'),
    montantCentimes,
  })
  if (!saisie.success) return { erreur: premierProbleme(saisie.error) }

  try {
    const rdv = await changerStatut(ctx, saisie.data)
    rafraichirAgenda()
    return {
      succes: saisie.data.statut === StatutRendezVous.ANNULE ? messageAnnulation(rdv.statut) : 'Statut mis à jour.',
    }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

/** Corrige le montant d'un rendez-vous déjà passé en caisse (D81). */
export async function corrigerMontantAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()
  const saisie = corrigerMontantSchema.safeParse({
    id: donnees.get('id'),
    montantCentimes: centimesDepuisSaisie(lire(donnees, 'montant')),
  })
  if (!saisie.success) return { erreur: 'Montant invalide : écrivez par exemple 60 ou 62,50.' }
  try {
    await corrigerMontant(ctx, saisie.data)
    rafraichirAgenda()
    return { succes: 'Montant corrigé.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

export async function annulerRendezVousAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()

  const saisie = annulerRendezVousSchema.safeParse({
    id: donnees.get('id'),
    raison: donnees.get('raison') || undefined,
  })
  if (!saisie.success) return { erreur: premierProbleme(saisie.error) }

  try {
    const rdv = await annulerRendezVous(ctx, saisie.data)
    rafraichirAgenda()
    return { succes: messageAnnulation(rdv.statut) }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

export async function validerAnnulationAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()

  const saisie = validerAnnulationSchema.safeParse({ id: donnees.get('id') })
  if (!saisie.success) return { erreur: premierProbleme(saisie.error) }

  try {
    await validerAnnulation(ctx, saisie.data)
    rafraichirAgenda()
    return { succes: 'Annulation validée. Le patient a été prévenu par SMS.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

export async function refuserAnnulationAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()

  const saisie = refuserAnnulationSchema.safeParse({
    id: donnees.get('id'),
    raison: donnees.get('raison') || undefined,
  })
  // Renvoie la saisie : un refus qui échoue (demande déjà tranchée entre-temps,
  // par exemple) ne doit pas faire perdre le motif déjà tapé.
  if (!saisie.success) {
    return { erreur: premierProbleme(saisie.error), valeurs: { raison: lire(donnees, 'raison') } }
  }

  try {
    await refuserAnnulation(ctx, saisie.data)
    rafraichirAgenda()
    return { succes: 'Demande refusée. Le rendez-vous reprend son statut précédent.' }
  } catch (e) {
    return { erreur: messageErreur(e), valeurs: { raison: lire(donnees, 'raison') } }
  }
}

export async function creerPatientAction(_precedent: EtatAgenda, donnees: FormData): Promise<EtatAgenda> {
  const ctx = await exigerContexte()

  const saisie = creerPatientSchema.safeParse({
    nom: donnees.get('nom'),
    prenom: donnees.get('prenom'),
    telephone: donnees.get('telephone'),
    dateNaissance: donnees.get('dateNaissance') || undefined,
    email: donnees.get('email') || undefined,
    representantLegal: donnees.get('representantLegal') || undefined,
    telephoneRepresentant: donnees.get('telephoneRepresentant') || undefined,
  })
  if (!saisie.success) return { erreur: premierProbleme(saisie.error) }

  try {
    const patient = await creerPatient(ctx, saisie.data)
    rafraichirAgenda()
    return {
      succes: patient.profilComplet
        ? 'Patient enregistré.'
        : 'Patient enregistré. Sa date de naissance reste à compléter à sa venue.',
      id: patient.id,
      libelle: `${patient.nom.toUpperCase()} ${patient.prenom}`,
    }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

// ─── Fiche d'un rendez-vous (clic sur sa carte dans l'agenda) ──────────────

export type FicheRendezVousVue = {
  id: string
  jour: string
  jourLong: string
  heureDebut: string
  heureFin: string
  statut: StatutRendezVous
  acte: string
  urgence: boolean
  praticien: { nom: string; couleur: string }
  cabinet: string
  fauteuil: string
  note: string | null
  origine: string
  demande: { par: string; le: string } | null
  patient: { id: string; prenomNom: string; age: string | null; telephone: string; manquements: number }
  droits: { annuleDirectement: boolean; tranche: boolean; modifie: boolean; annule: boolean }
  /** Le passage en caisse (D81) : le prix du soin dans la grille, et le montant validé une fois encaissé. */
  caisse: { prixCentimes: number | null; montantCentimes: number | null }
  /** Ce que « Modifier » propose (27/10) ; `null` sans le droit de modifier. */
  modification: {
    praticienId: string
    motifId: string
    praticiens: { id: string; nom: string; motifs: string[] }[]
    motifs: { id: string; libelle: string }[]
  } | null
  /** Posé par l'assistant des urgences (D77) : ce que le patient a décrit, le niveau, la conversation. */
  assistant: {
    niveau: NiveauUrgence | null
    niveauAssistant: NiveauUrgence | null
    resume: string[]
    /** Pourquoi l'assistant a choisi ce créneau (D79). */
    raison: string | null
    messages: { role: 'patient' | 'assistant'; texte: string }[]
    le: string
  } | null
}

const FUSEAU = 'America/Guadeloupe'
const jourLongFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: FUSEAU,
})
const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** « 58 ans · né(e) le 12 mars 1968 », à partir d'une date de naissance (colonne `date`, sans fuseau). */
function age(naissance: Date | null, maintenant: Date): string | null {
  if (!naissance) return null
  const [a, m, j] = jourLocal(maintenant).split('-').map(Number) as [number, number, number]
  let ans = a - naissance.getUTCFullYear()
  if (m < naissance.getUTCMonth() + 1 || (m === naissance.getUTCMonth() + 1 && j < naissance.getUTCDate())) ans -= 1
  return `${ans} ans · né(e) le ${dateFormat.format(naissance)}`
}

export async function lireFicheRendezVousAction(id: string): Promise<{ fiche?: FicheRendezVousVue; erreur?: string }> {
  const ctx = await exigerContexte()
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { erreur: 'Rendez-vous introuvable.' }

  try {
    const resultat = await lireFicheRendezVous(ctx, id)
    if (!resultat) return { erreur: 'Rendez-vous introuvable, ou hors de vos cabinets.' }
    const { rdv, droits } = resultat
    const [praticiens, motifs] = droits.modifie
      ? await Promise.all([listerPraticiens(ctx), listerMotifs(ctx)])
      : [[], []]
    return {
      fiche: {
        id: rdv.id,
        jour: jourLocal(rdv.debut),
        jourLong: majuscule(jourLongFormat.format(rdv.debut)),
        heureDebut: heureCabinet(rdv.debut),
        heureFin: heureCabinet(rdv.fin),
        statut: rdv.statut,
        acte: rdv.motif.libelle,
        urgence: rdv.motif.estUrgence || rdv.surbooking,
        praticien: { nom: `Dr ${rdv.praticien.prenom} ${rdv.praticien.nom}`, couleur: rdv.praticien.couleur },
        cabinet: rdv.site.nom.replace(/^Cabinet (de |d’|d')/, ''),
        fauteuil: rdv.fauteuil.nom,
        note: rdv.note,
        origine: `${rdv.conversationAssistant ? 'Pris avec l’assistant des urgences' : rdv.reservationPublique ? 'Pris en ligne' : 'Pris au cabinet'} le ${jourLongFormat.format(rdv.createdAt)}`,
        demande:
          rdv.statut === StatutRendezVous.ANNULATION_DEMANDEE && rdv.annulationDemandeePar
            ? {
                par: `${rdv.annulationDemandeePar.prenom} ${rdv.annulationDemandeePar.nom}`,
                le: rdv.annulationDemandeeLe
                  ? `${jourLongFormat.format(rdv.annulationDemandeeLe)} à ${heureCabinet(rdv.annulationDemandeeLe)}`
                  : '',
              }
            : null,
        patient: {
          id: rdv.patient.id,
          prenomNom: `${rdv.patient.prenom} ${rdv.patient.nom}`,
          age: age(rdv.patient.dateNaissance, new Date()),
          telephone: afficherTelephone(rdv.patient.telephone),
          manquements: rdv.patient.manquements,
        },
        droits,
        caisse: { prixCentimes: rdv.motif.prixCentimes, montantCentimes: rdv.montantCentimes },
        modification: droits.modifie
          ? {
              praticienId: rdv.praticien.id,
              motifId: rdv.motif.id,
              praticiens: praticiens
                .filter((p) => !ctx.praticienRestreint || p.id === ctx.praticienRestreint)
                .map((p) => ({ id: p.id, nom: `Dr ${p.prenom} ${p.nom}`, motifs: p.motifs.map((m) => m.motifId) })),
              motifs: motifs.map((m) => ({ id: m.id, libelle: m.libelle })),
            }
          : null,
        assistant: rdv.conversationAssistant
          ? {
              niveau: niveauRetenu(rdv.conversationAssistant),
              niveauAssistant: rdv.conversationAssistant.niveau,
              resume: rdv.conversationAssistant.resume,
              raison: rdv.conversationAssistant.raison,
              messages: (Array.isArray(rdv.conversationAssistant.messages)
                ? (rdv.conversationAssistant.messages as { role: 'patient' | 'assistant'; texte: string }[])
                : []
              ).map((m) => ({ role: m.role, texte: m.texte })),
              le: `${jourLongFormat.format(rdv.conversationAssistant.createdAt)} à ${heureCabinet(rdv.conversationAssistant.createdAt)}`,
            }
          : null,
      },
    }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

/**
 * Le cabinet corrige le niveau que l'assistant des urgences a donné (D77). Le niveau de l'assistant est gardé :
 * l'écart entre les deux mesure sa justesse.
 */
export async function corrigerNiveauUrgenceAction(id: string, niveau: string): Promise<EtatAgenda> {
  const ctx = await exigerContexte()
  if (typeof id !== 'string' || !UUID.test(id) || !(Object.values(NiveauUrgence) as string[]).includes(niveau)) {
    return { erreur: 'Demande invalide.' }
  }
  try {
    await corrigerNiveauUrgence(ctx, id, niveau as NiveauUrgence)
    revalidatePath('/tableau-de-bord/agenda')
    return { succes: 'Niveau d’urgence corrigé.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

/** « Rappelé » sur une demande d'urgence transmise par l'assistant (D79). */
export async function marquerDemandeUrgenceTraiteeAction(id: string): Promise<EtatAgenda> {
  const ctx = await exigerContexte()
  if (typeof id !== 'string' || !UUID.test(id)) return { erreur: 'Demande invalide.' }
  try {
    await marquerDemandeUrgenceTraitee(ctx, id)
    revalidatePath('/tableau-de-bord')
    return { succes: 'Demande traitée.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

// ─── Créneaux libres pour déplacer un rendez-vous (tour du 20/10) ──────────

export type JourDeCreneaux = { jour: string; libelle: string; heures: string[] }

const jourMoyenFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Guadeloupe',
})

/**
 * Les prochains créneaux libres du même praticien, pour le même acte et dans le
 * même cabinet, groupés par jour : la secrétaire choisit au lieu de taper un jour
 * et une heure à l'aveugle (un refus sur deux au tour du 20/10). Même garde que la
 * fiche : un rendez-vous hors de portée ne rend rien.
 */
export async function creneauxPourDeplacerAction(id: string, depuis?: string): Promise<JourDeCreneaux[]> {
  const ctx = await exigerContexte()
  if (typeof id !== 'string' || !UUID.test(id)) return []
  try {
    const resultat = await lireFicheRendezVous(ctx, id)
    if (!resultat || !resultat.droits.modifie) return []
    const { rdv } = resultat
    const debut = depuis && /^\d{4}-\d{2}-\d{2}$/.test(depuis) ? bornesDuJour(depuis).debut : new Date()
    const creneaux = await creneauxDisponibles({
      motifId: rdv.motif.id,
      siteId: rdv.site.id,
      praticienId: rdv.praticien.id,
      debut,
      fin: new Date(debut.getTime() + 21 * 86_400_000),
    })
    const parJour = new Map<string, JourDeCreneaux>()
    for (const c of creneaux) {
      const jour = jourLocal(c.debut)
      if (!parJour.has(jour)) {
        if (parJour.size === 4) break
        parJour.set(jour, { jour, libelle: majuscule(jourMoyenFormat.format(c.debut)), heures: [] })
      }
      const heure = heureCabinet(c.debut)
      const liste = parJour.get(jour)!.heures
      if (!liste.includes(heure)) liste.push(heure)
    }
    return [...parJour.values()]
  } catch {
    return []
  }
}

// ─── Prochains créneaux libres, proposés dans « Nouveau rendez-vous » ──────

export type CreneauSuggere = { jour: string; heure: string; libelle: string }

const jourCourtFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: FUSEAU,
})
const UUID = /^[0-9a-f-]{36}$/i

/**
 * Les huit prochains créneaux libres du praticien pour cet acte, dans ce
 * cabinet, à partir du jour choisi et sur deux semaines. Même calcul que le
 * portail (présences, congés, rendez-vous, durée de l'acte, D14) : une
 * suggestion, jamais une contrainte — la secrétaire peut toujours saisir une
 * autre heure (Q22), que la création revérifie.
 */
export async function prochainsCreneauxAction(entree: {
  praticienId: string
  motifId: string
  siteId: string
  jour: string
}): Promise<CreneauSuggere[]> {
  const ctx = await exigerContexte()
  const { praticienId, motifId, siteId, jour } = entree
  if (![praticienId, motifId, siteId].every((v) => UUID.test(v)) || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return []
  try {
    await requirePermission(ctx, 'agenda', 'read')
    await exigerAccesSite(ctx, siteId)
  } catch {
    return []
  }
  const debut = bornesDuJour(jour).debut
  const creneaux = await creneauxDisponibles({
    motifId,
    siteId,
    praticienId,
    debut,
    fin: new Date(debut.getTime() + 14 * 86_400_000),
  })
  return creneaux.slice(0, 8).map((c) => ({
    jour: jourLocal(c.debut),
    heure: heureCabinet(c.debut),
    libelle: `${jourCourtFormat.format(c.debut)} · ${heureCabinet(c.debut)}`,
  }))
}
