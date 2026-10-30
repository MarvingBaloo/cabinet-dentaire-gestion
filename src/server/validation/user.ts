import { RoleName } from '@prisma/client'
import { z } from 'zod'

import { telephoneSaisi } from './telephone'

// Validation aux frontières système uniquement : ce qui arrive d'un formulaire
// ou d'une API. Les appels internes s'appuient sur les types TypeScript, qui ne
// franchissent pas de frontière et n'ont donc rien à revalider.

// Longueur plutôt que complexité : imposer majuscule + chiffre + caractère
// spécial produit des mots de passe courts et prévisibles, que les gens
// réutilisent. La longueur est ce qui résiste réellement.
const motDePasse = z
  .string()
  .min(12, 'au moins 12 caractères')
  .max(200, 'au plus 200 caractères')

// Format international attendu : le fournisseur de SMS ne devine pas l'indicatif,
// et un numéro guadeloupéen saisi en 0690… partirait vers la métropole.
const mobile = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'numéro au format international, par exemple +590690123456')

export const creerUtilisateurSchema = z.object({
  email: z.email('adresse invalide').trim().toLowerCase(),
  nom: z.string().trim().min(1, 'obligatoire').max(100),
  prenom: z.string().trim().min(1, 'obligatoire').max(100),
  motDePasse,
  // Obligatoire et tapé comme on en a l'habitude (D65) : sans numéro, aucun code de connexion ne peut partir, et le
  // compte créé ne servait à rien (21/10 — le formulaire n'avait pas ce champ).
  telephoneMobile: telephoneSaisi,
  roles: z
    .array(z.enum(RoleName))
    .min(1, 'au moins un rôle')
    // Rôles cumulables (D4), mais pas en double.
    .refine((r) => new Set(r).size === r.length, 'rôle en double'),
  siteIds: z.array(z.uuid()).default([]),

  // Renseignés seulement quand le rôle PRATICIEN est coché. Un compte permet de
  // se connecter ; c'est la fiche praticien qui fait apparaître quelqu'un dans
  // l'agenda, et sans elle on ne peut lui poser aucun rendez-vous.
  titrePraticien: z.string().trim().min(1).max(100).optional(),
  couleurPraticien: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'couleur hexadécimale attendue')
    .optional(),
})

export type CreerUtilisateurInput = z.infer<typeof creerUtilisateurSchema>

export const modifierUtilisateurSchema = z.object({
  nom: z.string().trim().min(1).max(100).optional(),
  prenom: z.string().trim().min(1).max(100).optional(),
  telephoneMobile: mobile.optional(),
  roles: z
    .array(z.enum(RoleName))
    .min(1)
    .refine((r) => new Set(r).size === r.length, 'rôle en double')
    .optional(),
})

export type ModifierUtilisateurInput = z.infer<typeof modifierUtilisateurSchema>

/** Nouveau numéro d'un compte : téléphone changé, ou code réinitialisé (21/10). */
export const changerTelephoneSchema = z.object({ id: z.uuid(), telephone: telephoneSaisi })
