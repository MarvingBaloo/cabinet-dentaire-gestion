'use server'

import { revalidatePath } from 'next/cache'

import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import {
  ModeleMessageInvalideError,
  enregistrerModeleMessage,
  reinitialiserModeleMessage,
} from '@/server/services/modeles-messages'
import {
  enregistrerModeleMessageSchema,
  reinitialiserModeleMessageSchema,
} from '@/server/validation/modeles-messages'

// Écran de paramétrage des modèles de messages (lot 5a) : symétrique de
// `src/server/actions/motifs-patient.ts` — un formulaire par ligne, la saisie
// reçue renvoyée telle quelle en cas de refus (règle du projet : React remet
// les formulaires à zéro après une action, un renvoi manquant fait retaper
// tout le texte pour une seule accolade mal fermée).

export type SaisieModeleMessage = { sujet: string; corps: string }

export type EtatModeleMessage = {
  erreur?: string
  succes?: string
  avertissement?: string
  saisie?: SaisieModeleMessage
}

function lire(donnees: FormData, champ: string): string {
  const v = donnees.get(champ)
  return typeof v === 'string' ? v.trim() : ''
}

function messageErreur(e: unknown): string {
  if (e instanceof ModeleMessageInvalideError) return e.message
  if (e instanceof PermissionDeniedError) {
    return 'Les modèles de messages se règlent avec un compte praticien ou administrateur.'
  }
  // Le reste doit rester bruyant : un catch fourre-tout rendrait un bug
  // introuvable derrière « une erreur est survenue ».
  throw e
}

const rafraichir = () => {
  revalidatePath('/tableau-de-bord/messages')
}

export async function enregistrerModeleMessageAction(
  _precedent: EtatModeleMessage,
  donnees: FormData,
): Promise<EtatModeleMessage> {
  const ctx = await exigerContexte()

  const sujetBrut = lire(donnees, 'sujet')
  const corpsBrut = lire(donnees, 'corps')
  const saisie: SaisieModeleMessage = { sujet: sujetBrut, corps: corpsBrut }

  const analyse = enregistrerModeleMessageSchema.safeParse({
    type: lire(donnees, 'type'),
    canal: lire(donnees, 'canal'),
    sujet: sujetBrut || undefined,
    corps: corpsBrut,
  })
  if (!analyse.success) {
    return { erreur: analyse.error.issues[0]?.message ?? 'Saisie invalide.', saisie }
  }

  try {
    const resultat = await enregistrerModeleMessage(ctx, {
      type: analyse.data.type,
      canal: analyse.data.canal,
      sujet: analyse.data.sujet ?? null,
      corps: analyse.data.corps,
    })
    rafraichir()
    return {
      succes: 'Modèle enregistré.',
      ...(resultat.avertissement !== undefined ? { avertissement: resultat.avertissement } : {}),
    }
  } catch (e) {
    return { erreur: messageErreur(e), saisie }
  }
}

export async function reinitialiserModeleMessageAction(
  _precedent: EtatModeleMessage,
  donnees: FormData,
): Promise<EtatModeleMessage> {
  const ctx = await exigerContexte()

  const analyse = reinitialiserModeleMessageSchema.safeParse({
    type: lire(donnees, 'type'),
    canal: lire(donnees, 'canal'),
  })
  if (!analyse.success) {
    return { erreur: analyse.error.issues[0]?.message ?? 'Saisie invalide.' }
  }

  try {
    await reinitialiserModeleMessage(ctx, analyse.data.type, analyse.data.canal)
    rafraichir()
    return { succes: 'Revenu au texte par défaut.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}
