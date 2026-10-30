'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { adresseIpClient } from '@/server/http/adresse-ip'
import { NOM_COOKIE_ACCES } from '@/server/services/acces-patient'
import { enregistrerPreferences } from '@/server/services/preferences-notifications'
import { enregistrerPreferencesSchema } from '@/server/validation/preferences-notifications'

// Server Action des préférences de notification (phase 4, lot 5b, D44).
// Comme le reste du portail patient : pas de route API, c'est la Server
// Action qui porte la protection CSRF (D6).

export type SaisiePreferences = {
  smsRappels: boolean
  smsNonEssentiels: boolean
  emailRappels: boolean
  emailNonEssentiels: boolean
}

export type EtatPreferences = {
  erreur?: string
  succes?: string
  /** Renvoyée en cas de refus : React remet les formulaires à zéro après une
   *  action, un renvoi manquant ferait redécocher ce que le patient venait de
   *  choisir (règle du projet). */
  saisie?: SaisiePreferences
}

/** Case à cocher NATIVE : une case décochée n'apparaît PAS dans `FormData`,
 *  d'où la comparaison à `'on'` plutôt qu'une lecture de valeur. */
function lireCase(donnees: FormData, champ: string): boolean {
  return donnees.get(champ) === 'on'
}

export async function enregistrerPreferencesAction(
  _precedent: EtatPreferences,
  donnees: FormData,
): Promise<EtatPreferences> {
  const jar = await cookies()
  const jeton = jar.get(NOM_COOKIE_ACCES)?.value
  if (!jeton) return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.' }

  // Marqueur posé par la page seulement quand un canal e-mail a été proposé
  // (une adresse existe pour ce numéro) : sans lui, deux cases décochées sur
  // un formulaire qui n'affichait pas la section e-mail serait indiscernable
  // d'un formulaire qui l'affichait avec les deux cases décochées.
  const emailPropose = donnees.get('emailPropose') === 'on'

  const saisie: SaisiePreferences = {
    smsRappels: lireCase(donnees, 'smsRappels'),
    smsNonEssentiels: lireCase(donnees, 'smsNonEssentiels'),
    emailRappels: lireCase(donnees, 'emailRappels'),
    emailNonEssentiels: lireCase(donnees, 'emailNonEssentiels'),
  }

  const analyse = enregistrerPreferencesSchema.safeParse({
    sms: { rappels: saisie.smsRappels, nonEssentiels: saisie.smsNonEssentiels },
    ...(emailPropose
      ? { email: { rappels: saisie.emailRappels, nonEssentiels: saisie.emailNonEssentiels } }
      : {}),
  })
  if (!analyse.success) return { erreur: 'Saisie invalide.', saisie }

  const r = await enregistrerPreferences(jeton, analyse.data, await adresseIpClient())

  revalidatePath('/mes-rendez-vous')

  switch (r.etat) {
    case 'enregistre':
      return { succes: 'Vos préférences sont enregistrées.' }
    case 'fenetre_expiree':
      return { erreur: 'Votre session a expiré. Recommencez avec votre numéro.', saisie }
  }
}
