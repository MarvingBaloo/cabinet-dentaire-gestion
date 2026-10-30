'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { nommerPoste } from '@/server/services/postes'
import {
  DesactivationDeSoiError,
  EmailDejaUtiliseError,
  changerTelephone,
  creerUtilisateur,
  desactiverUtilisateur,
  reactiverUtilisateur,
  reinitialiserMfa,
} from '@/server/services/users'
import { changerTelephoneSchema, creerUtilisateurSchema } from '@/server/validation/user'

// Server Actions et non routes API : c'est d'elles que vient la protection CSRF
// (D6). Chacune commence par `exigerContexte`, qui redirige si la session n'est
// pas pleinement valide — le garde de permission, lui, est dans la DAL (D4).

// La saisie revient avec un refus : React vide le formulaire après chaque
// action, et retaper sept champs pour une adresse déjà prise décourage. Le mot
// de passe, lui, n'est jamais renvoyé.
export type SaisieCompte = {
  prenom: string
  nom: string
  email: string
  telephoneMobile: string
  roles: string[]
  siteIds: string[]
  titrePraticien: string
  couleurPraticien: string
}

export type EtatCompte = { erreur?: string; succes?: string; saisie?: SaisieCompte }

const LIBELLE_CHAMP: Record<string, string> = {
  prenom: 'Prénom',
  nom: 'Nom',
  email: 'Adresse professionnelle',
  telephoneMobile: 'Téléphone mobile',
  motDePasse: 'Mot de passe provisoire',
  roles: 'Rôles',
  siteIds: 'Sites de rattachement',
  titrePraticien: 'Titre affiché aux patients',
  couleurPraticien: 'Couleur dans l’agenda',
}

const texte = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '')

/** Traduit les erreurs métier en message affichable, et laisse remonter le reste. */
function messageErreur(e: unknown): string {
  if (e instanceof EmailDejaUtiliseError || e instanceof DesactivationDeSoiError) return e.message
  if (e instanceof PermissionDeniedError) return "Vous n'avez pas le droit d'effectuer cette action."
  throw e
}

export async function creerCompteAction(
  _precedent: EtatCompte,
  donnees: FormData,
): Promise<EtatCompte> {
  const ctx = await exigerContexte()

  const renvoi: SaisieCompte = {
    prenom: texte(donnees.get('prenom')),
    nom: texte(donnees.get('nom')),
    email: texte(donnees.get('email')),
    telephoneMobile: texte(donnees.get('telephoneMobile')),
    roles: donnees.getAll('roles').map(texte),
    siteIds: donnees.getAll('siteIds').map(texte),
    titrePraticien: texte(donnees.get('titrePraticien')),
    couleurPraticien: texte(donnees.get('couleurPraticien')),
  }

  const saisie = creerUtilisateurSchema.safeParse({
    email: donnees.get('email'),
    nom: donnees.get('nom'),
    prenom: donnees.get('prenom'),
    motDePasse: donnees.get('motDePasse'),
    telephoneMobile: donnees.get('telephoneMobile'),
    roles: donnees.getAll('roles'),
    siteIds: donnees.getAll('siteIds'),
    titrePraticien: donnees.get('titrePraticien') || undefined,
    couleurPraticien: donnees.get('couleurPraticien') || undefined,
  })
  if (!saisie.success) {
    const premier = saisie.error.issues[0]
    const champ = String(premier?.path[0] ?? '')
    return { erreur: `${LIBELLE_CHAMP[champ] ?? 'Saisie'} : ${premier?.message ?? 'invalide'}.`, saisie: renvoi }
  }

  try {
    const u = await creerUtilisateur(ctx, saisie.data)
    revalidatePath('/tableau-de-bord/comptes')
    const praticien = saisie.data.roles.includes('PRATICIEN')
    const agenda = u.ficheRattachee
      ? ' Le compte a été rattaché à sa fiche d’agenda existante.'
      : ' Il apparaît désormais dans l’agenda.'
    return {
      succes:
        `Compte créé pour ${u.prenom} ${u.nom}.` +
        (praticien ? agenda : '') +
        ' Un code lui sera envoyé par SMS à sa première connexion.',
    }
  } catch (e) {
    return { erreur: messageErreur(e), saisie: renvoi }
  }
}

const idSchema = z.uuid()

export async function desactiverCompteAction(donnees: FormData): Promise<void> {
  const ctx = await exigerContexte()
  const id = idSchema.parse(donnees.get('id'))

  // Se désactiver soi-même fermerait la session en cours et pourrait laisser le
  // cabinet sans aucun compte capable d'en rouvrir un.
  if (id === ctx.userId) return

  await desactiverUtilisateur(ctx, id)
  revalidatePath('/tableau-de-bord/comptes')
}

export async function reactiverCompteAction(donnees: FormData): Promise<void> {
  const ctx = await exigerContexte()
  await reactiverUtilisateur(ctx, idSchema.parse(donnees.get('id')))
  revalidatePath('/tableau-de-bord/comptes')
}

export async function reinitialiserMfaAction(donnees: FormData): Promise<void> {
  const ctx = await exigerContexte()
  await reinitialiserMfa(ctx, idSchema.parse(donnees.get('id')))
  revalidatePath('/tableau-de-bord/comptes')
}

const posteSchema = z.object({
  id: z.uuid(),
  nom: z.string().trim().min(1, 'Nom requis').max(80),
  // Chaîne vide = « aucun site », que le formulaire envoie quand rien n'est choisi.
  siteId: z.union([z.uuid(), z.literal('')]).transform((v) => (v === '' ? null : v)),
})

export async function nommerPosteAction(
  _precedent: EtatCompte,
  donnees: FormData,
): Promise<EtatCompte> {
  const ctx = await exigerContexte()

  const saisie = posteSchema.safeParse({
    id: donnees.get('id'),
    nom: donnees.get('nom'),
    siteId: donnees.get('siteId') ?? '',
  })
  if (!saisie.success) {
    return { erreur: saisie.error.issues[0]?.message ?? 'Saisie invalide' }
  }

  try {
    const { id, ...reste } = saisie.data
    await nommerPoste(ctx, id, reste)
    revalidatePath('/tableau-de-bord/postes')
    return { succes: 'Poste enregistré.' }
  } catch (e) {
    return { erreur: messageErreur(e) }
  }
}

export type EtatTelephone = { erreur?: string; succes?: string; telephone?: string }

/** Nouveau numéro d'un compte : la saisie est rendue en cas de refus, comme partout (CLAUDE.md). */
export async function changerTelephoneAction(_precedent: EtatTelephone, donnees: FormData): Promise<EtatTelephone> {
  const ctx = await exigerContexte()
  const telephone = texte(donnees.get('telephone'))
  const saisie = changerTelephoneSchema.safeParse({ id: donnees.get('id'), telephone })
  if (!saisie.success) return { erreur: saisie.error.issues[0]?.message ?? 'Numéro invalide.', telephone }
  try {
    const u = await changerTelephone(ctx, saisie.data.id, saisie.data.telephone)
    revalidatePath('/tableau-de-bord/comptes')
    return { succes: `Numéro enregistré. ${u.prenom} recevra son prochain code sur ce numéro.` }
  } catch (e) {
    return { erreur: messageErreur(e), telephone }
  }
}
