'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { env } from '@/config/env'
import { adresseIpClient } from '@/server/http/adresse-ip'
import {
  NOM_COOKIE_ACCES,
  annulerParPatient,
  creneauxPourDeplacement,
  demanderAcces,
  deplacerParPatient,
  fermerFenetre,
  verifierAcces,
} from '@/server/services/acces-patient'
import { tropDeLecturesPubliques } from '@/server/services/lecture-publique'
import {
  annulerParPatientSchema,
  creneauxPourDeplacementSchema,
  demanderAccesSchema,
  deplacerParPatientSchema,
  verifierAccesSchema,
} from '@/server/validation/acces-patient'

// Server Actions du portail patient. Comme pour la réservation, c'est d'elles
// que vient la protection CSRF (D6) — il n'existe aucune route API ici.

/** Le cookie n'est pas l'autorité : c'est la ligne `AccesPatient` qui décide,
 *  se prolonge à chaque geste et se révoque. Il dure donc plus longtemps que la
 *  fenêtre (qui se prolonge, elle) ; un jeton dont la fenêtre est fermée ne lit
 *  plus rien. */
const DUREE_COOKIE_SECONDES = 12 * 60 * 60

export type EtatAcces = {
  erreur?: string
  /** Le numéro masqué, une fois le code parti : l'étape suivante s'affiche. */
  masque?: string
  /** Renseigné pour repeupler le champ après un refus. */
  telephone?: string
  ouvert?: boolean
  restantes?: number
}

export type EtatAnnulation = {
  erreur?: string
  succes?: string
}

export type EtatCreneauxDeplacement = {
  erreur?: string
  creneaux?: { debut: string; fin: string; praticienId: string }[]
}

export type EtatDeplacement = {
  erreur?: string
  succes?: { debut: string; fin: string }
}

function lire(donnees: FormData, champ: string): string {
  const v = donnees.get(champ)
  return typeof v === 'string' ? v : ''
}

export async function demanderAccesAction(
  _precedent: EtatAcces,
  donnees: FormData,
): Promise<EtatAcces> {
  const telephone = lire(donnees, 'telephone')

  const saisie = demanderAccesSchema.safeParse({ telephone })
  // La saisie est renvoyée telle quelle : React remet le formulaire à zéro après
  // une action, et sans ce renvoi le patient retaperait son numéro à chaque fois.
  if (!saisie.success) {
    return { erreur: saisie.error.issues[0]?.message ?? 'Numéro invalide.', telephone }
  }

  const r = await demanderAcces(saisie.data.telephone, await adresseIpClient())

  if (r.etat === 'trop_de_tentatives') {
    return {
      erreur: 'Trop de demandes de code pour l’instant. Réessayez dans une heure ou appelez le cabinet.',
      telephone,
    }
  }

  return { masque: r.masque, telephone: saisie.data.telephone }
}

export async function verifierAccesAction(
  _precedent: EtatAcces,
  donnees: FormData,
): Promise<EtatAcces> {
  const telephone = lire(donnees, 'telephone')

  const saisie = verifierAccesSchema.safeParse({ telephone, code: lire(donnees, 'code') })
  if (!saisie.success) {
    return {
      erreur: saisie.error.issues[0]?.message ?? 'Code invalide.',
      masque: lire(donnees, 'masque'),
      telephone,
    }
  }

  const r = await verifierAcces(saisie.data.telephone, saisie.data.code)

  if (r.etat === 'code_invalide') {
    return {
      erreur: `Code incorrect. ${r.restantes} essai${r.restantes > 1 ? 's' : ''} restant${r.restantes > 1 ? 's' : ''}.`,
      masque: lire(donnees, 'masque'),
      telephone,
      restantes: r.restantes,
    }
  }

  if (r.etat === 'code_expire') {
    return { erreur: 'Ce code n’est plus valable. Demandez-en un nouveau.', telephone }
  }

  const jar = await cookies()
  jar.set(NOM_COOKIE_ACCES, r.jeton, {
    httpOnly: true, // inaccessible au JavaScript de la page : neutralise le vol par XSS
    sameSite: 'lax' as const,
    secure: env.SESSION_COOKIE_SECURE,
    path: '/',
    maxAge: DUREE_COOKIE_SECONDES,
  })

  revalidatePath('/mes-rendez-vous')
  // La liste d'attente (lot D) partage le même jeton de fenêtre : la page
  // d'inscription doit se relire elle aussi, sinon elle reste bloquée sur le
  // formulaire de code après une vérification pourtant réussie.
  revalidatePath('/rendez-vous/liste-attente')
  return { ouvert: true }
}

export async function annulerParPatientAction(
  _precedent: EtatAnnulation,
  donnees: FormData,
): Promise<EtatAnnulation> {
  const jar = await cookies()
  const jeton = jar.get(NOM_COOKIE_ACCES)?.value
  if (!jeton) return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }

  const saisie = annulerParPatientSchema.safeParse({
    rendezVousId: lire(donnees, 'rendezVousId'),
  })
  if (!saisie.success) return { erreur: 'Rendez-vous introuvable.' }

  const r = await annulerParPatient(
    jeton,
    saisie.data.rendezVousId,
    await adresseIpClient(),
    new Date(),
  )

  revalidatePath('/mes-rendez-vous')

  switch (r.etat) {
    case 'annule':
      return { succes: 'Votre rendez-vous est annulé. Le créneau est de nouveau disponible.' }
    case 'trop_tard':
      return {
        erreur: 'Ce rendez-vous est dans moins de 24 heures : appelez le cabinet pour l’annuler.',
      }
    case 'fenetre_expiree':
      return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }
    case 'introuvable':
      return { erreur: 'Rendez-vous introuvable.' }
  }
}

/**
 * Les créneaux où ce rendez-vous peut être replacé (D28).
 *
 * Limitée par adresse IP (D25) comme la page `/rendez-vous` : c'est le même
 * calcul de créneaux libres, à l'appelant de porter la limitation — ces
 * fonctions ne se protègent pas elles-mêmes (README de `queries/public/`).
 */
export async function creneauxDeplacementAction(
  _precedent: EtatCreneauxDeplacement,
  donnees: FormData,
): Promise<EtatCreneauxDeplacement> {
  const jar = await cookies()
  const jeton = jar.get(NOM_COOKIE_ACCES)?.value
  if (!jeton) return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }

  const saisie = creneauxPourDeplacementSchema.safeParse({
    rendezVousId: lire(donnees, 'rendezVousId'),
  })
  if (!saisie.success) return { erreur: 'Rendez-vous introuvable.' }

  if (await tropDeLecturesPubliques(await adresseIpClient())) {
    return {
      erreur: 'Trop de consultations des disponibilités depuis cette connexion. Réessayez dans quelques minutes.',
    }
  }

  const creneaux = await creneauxPourDeplacement(jeton, saisie.data.rendezVousId, new Date())
  if (creneaux === null) {
    return { erreur: 'Rendez-vous introuvable, ou votre session a expiré.' }
  }
  if (creneaux.length === 0) {
    return {
      erreur:
        'Aucun autre créneau disponible pour ce motif dans les deux prochains mois. Appelez le cabinet.',
    }
  }

  return {
    creneaux: creneaux.map((c) => ({
      debut: c.debut.toISOString(),
      fin: c.fin.toISOString(),
      praticienId: c.praticienId,
    })),
  }
}

export async function deplacerParPatientAction(
  _precedent: EtatDeplacement,
  donnees: FormData,
): Promise<EtatDeplacement> {
  const jar = await cookies()
  const jeton = jar.get(NOM_COOKIE_ACCES)?.value
  if (!jeton) return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }

  const saisie = deplacerParPatientSchema.safeParse({
    rendezVousId: lire(donnees, 'rendezVousId'),
    nouveauDebut: lire(donnees, 'nouveauDebut'),
    nouveauPraticienId: lire(donnees, 'nouveauPraticienId'),
  })
  if (!saisie.success) return { erreur: 'Créneau invalide. Rechargez la liste.' }

  const r = await deplacerParPatient(
    jeton,
    saisie.data.rendezVousId,
    saisie.data.nouveauDebut,
    saisie.data.nouveauPraticienId,
    await adresseIpClient(),
    new Date(),
  )

  revalidatePath('/mes-rendez-vous')

  switch (r.etat) {
    case 'deplace':
      return { succes: { debut: r.debut.toISOString(), fin: r.fin.toISOString() } }
    case 'creneau_indisponible':
      return { erreur: 'Ce créneau vient d’être pris. Choisissez-en un autre.' }
    case 'hors_perimetre':
      return { erreur: 'Ce créneau n’est plus proposé. Rechargez la liste.' }
    case 'fenetre_expiree':
      return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }
    case 'introuvable':
      return { erreur: 'Rendez-vous introuvable.' }
  }
}

/** « Fermer mon espace » : la fenêtre est close en base et le cookie retiré ; retour à l'écran du numéro. */
export async function fermerEspaceAction(): Promise<void> {
  const jar = await cookies()
  const jeton = jar.get(NOM_COOKIE_ACCES)?.value
  if (jeton) await fermerFenetre(jeton)
  jar.delete(NOM_COOKIE_ACCES)
  redirect('/mes-rendez-vous?ferme=1')
}
