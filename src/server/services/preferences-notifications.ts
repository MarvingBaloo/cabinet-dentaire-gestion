import 'server-only'

import { CanalNotification } from '@prisma/client'

import { masquerNumero } from '@/server/auth/code-sms'
import { prisma } from '@/server/db/client'
import { fenetreValide } from '@/server/services/acces-patient'
import type { EnregistrerPreferencesInput } from '@/server/validation/preferences-notifications'

// Préférences patient par canal (phase 4, lot 5b, D44) : lecture et écriture
// depuis l'accès patient (D23), au même titre que « mes rendez-vous » et « ma
// liste d'attente ».
//
// ⚠ ZONE AUTORISÉE, PAS `queries/public/` (D19) : ce module touche un numéro
// de téléphone vérifié et, potentiellement, une adresse e-mail — jamais dans
// les lectures publiques.
//
// Voir le commentaire du modèle `PreferenceNotification` dans le schéma pour
// ce qu'une ligne représente, et `src/lib/categories-notifications.ts` pour ce
// qu'elle coupe. Absence de ligne = tout autorisé, appliqué ici comme dans
// `traiterLot` (src/server/notifications/file.ts), qui applique la
// préférence au moment de l'ENVOI.

export type PreferenceCanal = { rappels: boolean; nonEssentiels: boolean }

const DEFAUT: PreferenceCanal = { rappels: true, nonEssentiels: true }

export type PreferencesPatient = {
  sms: PreferenceCanal
  // `null` : aucune fiche patient de ce numéro ne porte d'adresse e-mail —
  // rien à proposer sur ce canal (le brief : « affiché seulement si au moins
  // un Patient de ce numéro a un email non nul »).
  email: (PreferenceCanal & { adresse: string }) | null
}

/**
 * L'adresse e-mail d'une fiche patient de ce numéro, s'il en existe une.
 *
 * Plusieurs fiches peuvent partager un numéro (famille) ; la première créée
 * qui porte un e-mail fait foi — un choix arbitraire mais stable, faute de
 * règle du cabinet sur plusieurs adresses pour un même numéro.
 */
async function adresseEmailDuNumero(telephone: string): Promise<string | null> {
  const patient = await prisma.patient.findFirst({
    where: { telephone, actif: true, email: { not: null } },
    select: { email: true },
    orderBy: { createdAt: 'asc' },
  })
  return patient?.email ?? null
}

export type EtatPreferences =
  | { etat: 'chargees'; preferences: PreferencesPatient }
  | { etat: 'fenetre_expiree' }

/** Les préférences du numéro derrière ce jeton, avec leurs défauts. */
export async function preferencesDuPatient(jeton: string): Promise<EtatPreferences> {
  const acces = await fenetreValide(jeton)
  if (!acces) return { etat: 'fenetre_expiree' }

  const [prefSms, adresseEmail] = await Promise.all([
    prisma.preferenceNotification.findUnique({
      where: { canal_destinataire: { canal: CanalNotification.SMS, destinataire: acces.telephone } },
      select: { rappels: true, nonEssentiels: true },
    }),
    adresseEmailDuNumero(acces.telephone),
  ])

  let email: (PreferenceCanal & { adresse: string }) | null = null
  if (adresseEmail) {
    const prefEmail = await prisma.preferenceNotification.findUnique({
      where: { canal_destinataire: { canal: CanalNotification.EMAIL, destinataire: adresseEmail } },
      select: { rappels: true, nonEssentiels: true },
    })
    email = { adresse: adresseEmail, ...(prefEmail ?? DEFAUT) }
  }

  return {
    etat: 'chargees',
    preferences: { sms: prefSms ?? DEFAUT, email },
  }
}

export type EtatEnregistrementPreferences =
  | { etat: 'enregistre' }
  | { etat: 'fenetre_expiree' }

/**
 * Enregistre les préférences du numéro derrière ce jeton.
 *
 * `input.email`, s'il est fourni, ne dicte PAS l'adresse : elle est
 * re-résolue ICI depuis le numéro authentifié par le jeton — une adresse
 * soumise par le navigateur ne prouve rien, et rien n'oblige le formulaire
 * envoyé à correspondre encore à la fiche patient actuelle. Sans adresse
 * trouvée, la préférence e-mail soumise est silencieusement ignorée : il n'y
 * a rien à quoi la rattacher.
 */
export async function enregistrerPreferences(
  jeton: string,
  input: EnregistrerPreferencesInput,
  ipAddress: string,
): Promise<EtatEnregistrementPreferences> {
  const acces = await fenetreValide(jeton)
  if (!acces) return { etat: 'fenetre_expiree' }

  await prisma.preferenceNotification.upsert({
    where: { canal_destinataire: { canal: CanalNotification.SMS, destinataire: acces.telephone } },
    create: {
      canal: CanalNotification.SMS,
      destinataire: acces.telephone,
      rappels: input.sms.rappels,
      nonEssentiels: input.sms.nonEssentiels,
    },
    update: { rappels: input.sms.rappels, nonEssentiels: input.sms.nonEssentiels },
  })

  let emailModifie = false
  if (input.email) {
    const adresseEmail = await adresseEmailDuNumero(acces.telephone)
    if (adresseEmail) {
      await prisma.preferenceNotification.upsert({
        where: { canal_destinataire: { canal: CanalNotification.EMAIL, destinataire: adresseEmail } },
        create: {
          canal: CanalNotification.EMAIL,
          destinataire: adresseEmail,
          rappels: input.email.rappels,
          nonEssentiels: input.email.nonEssentiels,
        },
        update: { rappels: input.email.rappels, nonEssentiels: input.email.nonEssentiels },
      })
      emailModifie = true
    }
  }

  await prisma.auditLog.create({
    data: {
      action: 'PREFERENCES_NOTIFICATION_MODIFIEES',
      entityType: 'preference_notification',
      actorRoles: [],
      ipAddress,
      // Sans le numéro complet, ni l'adresse e-mail : le journal se garde bien
      // plus longtemps que ce dont il porte la trace (36 mois, AUDIT_RETENTION_MONTHS).
      metadata: {
        origine: 'portail public',
        telephoneMasque: masquerNumero(acces.telephone),
        smsRappels: input.sms.rappels,
        smsNonEssentiels: input.sms.nonEssentiels,
        emailModifie,
      },
    },
  })

  return { etat: 'enregistre' }
}
