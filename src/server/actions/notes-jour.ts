'use server'

import { revalidatePath } from 'next/cache'

import { PermissionDeniedError } from '@/server/auth/permissions'
import { PorteeSiteError } from '@/server/auth/portee'
import { exigerContexte } from '@/server/auth/session-courante'
import {
  NoteJourIntrouvableError,
  creerNoteJour,
  modifierNoteJour,
  supprimerNoteJour,
} from '@/server/services/notes-jour'
import {
  creerNoteJourSchema,
  modifierNoteJourSchema,
  supprimerNoteJourSchema,
} from '@/server/validation/notes-jour'

export type EtatNoteJour = {
  erreur?: string
  succes?: string
  /** La saisie reçue, renvoyée en cas de refus pour repeupler le formulaire. */
  saisie?: Record<string, string>
  /** Change à chaque refus : fait remonter le formulaire (`key`). */
  jeton?: string
}

function lire(donnees: FormData, champ: string): string {
  const v = donnees.get(champ)
  return typeof v === 'string' ? v : ''
}

function premierProbleme(erreur: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return erreur.issues[0]?.message ?? 'Saisie invalide.'
}

function refusDe(e: unknown, saisie: Record<string, string>): EtatNoteJour {
  const base: EtatNoteJour = { saisie, jeton: crypto.randomUUID() }
  if (e instanceof PorteeSiteError) return { ...base, erreur: 'Ce cabinet n’est pas dans votre périmètre.' }
  if (e instanceof PermissionDeniedError) {
    return { ...base, erreur: 'Vous n’avez pas le droit d’effectuer cette action.' }
  }
  if (e instanceof NoteJourIntrouvableError) return { ...base, erreur: e.message }
  throw e
}

const rafraichir = () => revalidatePath('/tableau-de-bord/agenda')

export async function creerNoteJourAction(_precedent: EtatNoteJour, donnees: FormData): Promise<EtatNoteJour> {
  const ctx = await exigerContexte()
  const saisie = { siteId: lire(donnees, 'siteId'), jour: lire(donnees, 'jour'), texte: lire(donnees, 'texte') }

  const analyse = creerNoteJourSchema.safeParse(saisie)
  if (!analyse.success) return { erreur: premierProbleme(analyse.error), saisie, jeton: crypto.randomUUID() }

  try {
    await creerNoteJour(ctx, analyse.data)
    rafraichir()
    return { succes: 'Note ajoutée.' }
  } catch (e) {
    return refusDe(e, saisie)
  }
}

export async function modifierNoteJourAction(_precedent: EtatNoteJour, donnees: FormData): Promise<EtatNoteJour> {
  const ctx = await exigerContexte()
  const saisie = { id: lire(donnees, 'id'), texte: lire(donnees, 'texte') }

  const analyse = modifierNoteJourSchema.safeParse(saisie)
  if (!analyse.success) return { erreur: premierProbleme(analyse.error), saisie, jeton: crypto.randomUUID() }

  try {
    await modifierNoteJour(ctx, analyse.data)
    rafraichir()
    return { succes: 'Note modifiée.' }
  } catch (e) {
    return refusDe(e, saisie)
  }
}

export async function supprimerNoteJourAction(_precedent: EtatNoteJour, donnees: FormData): Promise<EtatNoteJour> {
  const ctx = await exigerContexte()
  const saisie = { id: lire(donnees, 'id') }

  const analyse = supprimerNoteJourSchema.safeParse(saisie)
  if (!analyse.success) return { erreur: premierProbleme(analyse.error), saisie, jeton: crypto.randomUUID() }

  try {
    await supprimerNoteJour(ctx, analyse.data)
    rafraichir()
    return { succes: 'Note supprimée.' }
  } catch (e) {
    return refusDe(e, saisie)
  }
}
