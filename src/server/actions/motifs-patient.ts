'use server'

import { revalidatePath } from 'next/cache'

import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import {
  MotifPatientUtiliseError,
  ProfondeurMotifPatientError,
  creerMotifPatient,
  modifierMotifPatient,
  supprimerMotifPatient,
} from '@/server/services/motifs-patient'
import {
  creerMotifPatientSchema,
  modifierMotifPatientSchema,
} from '@/server/validation/agenda'

export type EtatMotifPatient = { erreur?: string; succes?: string }

function lire(donnees: FormData, champ: string): string {
  const v = donnees.get(champ)
  return typeof v === 'string' ? v.trim() : ''
}

function messageErreur(e: unknown): string {
  if (e instanceof ProfondeurMotifPatientError) return e.message
  if (e instanceof MotifPatientUtiliseError) return e.message
  if (e instanceof PermissionDeniedError) {
    return 'Le menu des patients se règle avec un compte praticien ou administrateur.'
  }
  // Le reste doit rester bruyant : un catch fourre-tout rendrait un bug
  // introuvable derrière « une erreur est survenue ».
  throw e
}

const rafraichir = () => {
  revalidatePath('/tableau-de-bord/motifs')
  revalidatePath('/rendez-vous')
}

export async function creerMotifPatientAction(
  _precedent: EtatMotifPatient,
  donnees: FormData,
): Promise<EtatMotifPatient> {
  const ctx = await exigerContexte()

  const saisie = creerMotifPatientSchema.safeParse({
    libelle: lire(donnees, 'libelle'),
    aide: lire(donnees, 'aide') || undefined,
    parentId: lire(donnees, 'parentId') || undefined,
    motifId: lire(donnees, 'motifId') || undefined,
    ordre: Number(lire(donnees, 'ordre') || 0),
  })
  if (!saisie.success) {
    return { erreur: saisie.error.issues[0]?.message ?? 'Saisie invalide.' }
  }

  try {
    const e = await creerMotifPatient(ctx, saisie.data)
    rafraichir()
    return { succes: `« ${e.libelle} » ajouté.` }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

export async function modifierMotifPatientAction(
  _precedent: EtatMotifPatient,
  donnees: FormData,
): Promise<EtatMotifPatient> {
  const ctx = await exigerContexte()

  const brutMotif = lire(donnees, 'motifId')
  const brutActif = donnees.get('actif')

  const saisie = modifierMotifPatientSchema.safeParse({
    id: lire(donnees, 'id'),
    ...(donnees.has('libelle') ? { libelle: lire(donnees, 'libelle') } : {}),
    ...(donnees.has('aide') ? { aide: lire(donnees, 'aide') || null } : {}),
    // Chaîne vide = détacher l'acte. La distinction « absent » / « vidé »
    // compte : l'un ne touche à rien, l'autre retire l'entrée du portail.
    ...(donnees.has('motifId') ? { motifId: brutMotif || null } : {}),
    ...(donnees.has('ordre') ? { ordre: Number(lire(donnees, 'ordre')) } : {}),
    ...(brutActif !== null ? { actif: brutActif === 'oui' } : {}),
  })
  if (!saisie.success) {
    return { erreur: saisie.error.issues[0]?.message ?? 'Saisie invalide.' }
  }

  try {
    await modifierMotifPatient(ctx, saisie.data)
    rafraichir()
    return { succes: 'Enregistré.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

export async function supprimerMotifPatientAction(
  _precedent: EtatMotifPatient,
  donnees: FormData,
): Promise<EtatMotifPatient> {
  const ctx = await exigerContexte()
  const id = lire(donnees, 'id')

  try {
    await supprimerMotifPatient(ctx, id)
    rafraichir()
    return { succes: 'Entrée retirée du menu.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}
