import { z } from 'zod'

import { telephoneFacultatif, telephoneSaisi } from './telephone'

export const debloquerPatientSchema = z.object({
  id: z.uuid(),
})

export type DebloquerPatientInput = z.infer<typeof debloquerPatientSchema>

// Un champ facultatif vidé à l'écran arrive en chaîne vide : il efface la valeur.
const vide = (v: string) => (v === '' ? null : v)

export const modifierPatientSchema = z.object({
  id: z.uuid(),
  nom: z.string().trim().min(1, 'Le nom est obligatoire.').max(100),
  prenom: z.string().trim().min(1, 'Le prénom est obligatoire.').max(100),
  telephone: telephoneSaisi,
  dateNaissance: z.string().trim().transform(vide).pipe(z.iso.date('Date de naissance invalide.').nullable()),
  email: z.string().trim().toLowerCase().transform(vide).pipe(z.email('Adresse e-mail invalide.').nullable()),
  representantLegal: z.string().trim().max(200).transform(vide),
  telephoneRepresentant: telephoneFacultatif,
})

export type ModifierPatientInput = z.infer<typeof modifierPatientSchema>
