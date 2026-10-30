'use server'

import { revalidatePath } from 'next/cache'

import { FUSEAU_CABINET, jourLocal } from '@/lib/dates'
import { afficherTelephone } from '@/lib/telephone'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { rechercheRapide } from '@/server/queries/patients'
import { debloquerPatient, modifierPatient } from '@/server/services/patients'
import { debloquerPatientSchema, modifierPatientSchema } from '@/server/validation/patient'

// Server Action et non route API : c'est d'elle que vient la protection CSRF
// (D6). La permission, elle, est dans le service (D4).

export type EtatPatient = {
  erreur?: string
  succes?: string
  /** La saisie, renvoyée avec un refus : React vide le formulaire après chaque action. */
  valeurs?: Record<string, string>
}

export async function debloquerPatientAction(_precedent: EtatPatient, donnees: FormData): Promise<EtatPatient> {
  const ctx = await exigerContexte()

  const saisie = debloquerPatientSchema.safeParse({ id: donnees.get('id') })
  if (!saisie.success) return { erreur: 'Patient introuvable.' }

  try {
    const patient = await debloquerPatient(ctx, saisie.data)
    revalidatePath('/tableau-de-bord/patients/bloques')
    return {
      succes: `${patient.prenom} ${patient.nom.toUpperCase()} peut de nouveau réserver en ligne. Son compteur repart de zéro.`,
    }
  } catch (e) {
    if (e instanceof PermissionDeniedError) {
      return { erreur: 'Seul un administrateur peut lever un blocage.' }
    }
    throw e
  }
}

const CHAMPS_FICHE = [
  'nom',
  'prenom',
  'telephone',
  'dateNaissance',
  'email',
  'representantLegal',
  'telephoneRepresentant',
] as const

export async function modifierPatientAction(_precedent: EtatPatient, donnees: FormData): Promise<EtatPatient> {
  const ctx = await exigerContexte()
  const valeurs: Record<string, string> = {}
  for (const c of CHAMPS_FICHE) {
    const v = donnees.get(c)
    valeurs[c] = typeof v === 'string' ? v : ''
  }

  const saisie = modifierPatientSchema.safeParse({ id: donnees.get('id'), ...valeurs })
  if (!saisie.success) return { erreur: saisie.error.issues[0]?.message ?? 'Saisie invalide.', valeurs }

  try {
    const patient = await modifierPatient(ctx, saisie.data)
    revalidatePath(`/tableau-de-bord/patients/${patient.id}`)
    return { succes: 'Fiche enregistrée.' }
  } catch (e) {
    if (e instanceof PermissionDeniedError) {
      return { erreur: 'Votre compte ne permet pas de modifier une fiche patient.', valeurs }
    }
    return { erreur: e instanceof Error ? e.message : 'La fiche n’a pas pu être enregistrée.', valeurs }
  }
}

export type PatientTrouve = {
  id: string
  nom: string
  telephone: string
  prochain: { id: string; jour: string; libelle: string } | null
}

const prochainFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: FUSEAU_CABINET,
})

/** La recherche de la barre du haut, lancée pendant la frappe (tour du 20/10). */
export async function rechercheRapideAction(terme: string): Promise<PatientTrouve[]> {
  const ctx = await exigerContexte()
  if (typeof terme !== 'string' || terme.length > 60) return []
  try {
    return (await rechercheRapide(ctx, terme)).map((p) => ({
      id: p.id,
      nom: `${p.prenom} ${p.nom}`,
      telephone: afficherTelephone(p.telephone),
      prochain: p.prochain
        ? { id: p.prochain.id, jour: jourLocal(p.prochain.debut), libelle: prochainFormat.format(p.prochain.debut) }
        : null,
    }))
  } catch (e) {
    if (e instanceof PermissionDeniedError) return []
    throw e
  }
}
