'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { env } from '@/config/env'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { NOM_COOKIE_CABINET, listerCabinetsAccessibles } from '@/server/cabinet-choisi'
import { DernierCabinetError, changerActiviteCabinet } from '@/server/services/cabinets'

/** Retient le cabinet affiché ; un cabinet hors portée (D5) est ignoré sans bruit. */
export async function choisirCabinetAction(donnees: FormData): Promise<void> {
  const ctx = await exigerContexte()
  const id = donnees.get('cabinet')
  const cabinets = await listerCabinetsAccessibles(ctx)
  if (typeof id !== 'string' || !cabinets.some((c) => c.id === id)) return

  const jar = await cookies()
  jar.set(NOM_COOKIE_CABINET, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.SESSION_COOKIE_SECURE,
    path: '/tableau-de-bord',
    maxAge: 365 * 24 * 3600,
  })
  revalidatePath('/tableau-de-bord', 'layout')
}

export type EtatActiviteCabinet = { erreur?: string; succes?: string }

/** Coche ou décoche « En activité » sur un cabinet (D74). */
export async function changerActiviteCabinetAction(
  _precedent: EtatActiviteCabinet,
  donnees: FormData,
): Promise<EtatActiviteCabinet> {
  const ctx = await exigerContexte()
  const id = donnees.get('cabinet')
  const actif = donnees.get('actif') === 'oui'
  if (typeof id !== 'string') return { erreur: 'Cabinet introuvable.' }
  try {
    await changerActiviteCabinet(ctx, id, actif)
  } catch (e) {
    if (e instanceof DernierCabinetError) return { erreur: e.message }
    if (e instanceof PermissionDeniedError) return { erreur: "Vous n'avez pas le droit d'effectuer cette action." }
    throw e
  }
  // Tout l'espace du cabinet et tout le site public changent : on oublie tout ce qui était rendu.
  revalidatePath('/', 'layout')
  return { succes: actif ? 'Le cabinet est de nouveau en activité.' : 'Le cabinet n’apparaît plus nulle part.' }
}
