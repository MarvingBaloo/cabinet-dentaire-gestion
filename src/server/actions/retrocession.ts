'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { centimesDepuisSaisie } from '@/lib/euros'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { DejaVerseError, SansPartError, marquerVerse, reglerPart, reglerPrix } from '@/server/services/retrocession'

// La rétrocession (D81) : Server Actions minces, les gardes sont dans le service.

export type EtatRetrocession = { erreur?: string; succes?: string }

const lire = (d: FormData, champ: string) => {
  const v = d.get(champ)
  return typeof v === 'string' ? v.trim() : ''
}

function refus(e: unknown): EtatRetrocession {
  if (e instanceof PermissionDeniedError) return { erreur: 'Réservé à l’administrateur du cabinet.' }
  if (e instanceof DejaVerseError || e instanceof SansPartError) return { erreur: e.message }
  throw e
}

const rafraichir = () => {
  revalidatePath('/tableau-de-bord/statistiques/retrocession')
  revalidatePath('/tableau-de-bord/reglages-retrocession')
}

export async function marquerVerseAction(_p: EtatRetrocession, donnees: FormData): Promise<EtatRetrocession> {
  const ctx = await exigerContexte()
  const saisie = z
    .object({ praticienId: z.uuid(), mois: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
    .safeParse({ praticienId: lire(donnees, 'praticienId'), mois: lire(donnees, 'mois') })
  if (!saisie.success) return { erreur: 'Demande invalide.' }
  try {
    await marquerVerse(ctx, saisie.data)
    rafraichir()
    return { succes: 'Marqué comme versé.' }
  } catch (e) {
    return refus(e)
  }
}

export async function reglerPartAction(_p: EtatRetrocession, donnees: FormData): Promise<EtatRetrocession> {
  const ctx = await exigerContexte()
  const brut = lire(donnees, 'part').replace('%', '').trim()
  const part = brut === '' ? null : Number(brut)
  const id = z.uuid().safeParse(lire(donnees, 'praticienId'))
  if (!id.success || (part !== null && (!Number.isInteger(part) || part < 0 || part > 100))) {
    return { erreur: 'Une part entre 0 et 100 %, ou vide pour aucune.' }
  }
  try {
    await reglerPart(ctx, { praticienId: id.data, part })
    rafraichir()
    return { succes: 'Part enregistrée.' }
  } catch (e) {
    return refus(e)
  }
}

export async function reglerPrixAction(_p: EtatRetrocession, donnees: FormData): Promise<EtatRetrocession> {
  const ctx = await exigerContexte()
  const brut = lire(donnees, 'prix')
  const prixCentimes = brut === '' ? null : centimesDepuisSaisie(brut)
  const id = z.uuid().safeParse(lire(donnees, 'motifId'))
  if (!id.success || (brut !== '' && prixCentimes === null)) {
    return { erreur: 'Un prix comme 60 ou 62,50, ou vide pour aucun.' }
  }
  try {
    await reglerPrix(ctx, { motifId: id.data, prixCentimes })
    rafraichir()
    return { succes: 'Prix enregistré.' }
  } catch (e) {
    return refus(e)
  }
}
