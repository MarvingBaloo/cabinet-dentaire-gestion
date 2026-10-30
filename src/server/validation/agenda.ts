import { StatutRendezVous } from '@prisma/client'
import { z } from 'zod'

import { telephoneFacultatif, telephoneSaisi } from './telephone'

// Validation aux frontières système uniquement : ce qui arrive d'un formulaire.
// Les appels internes s'appuient sur les types TypeScript.
//
// Ce qui n'est PAS validé ici, et pourquoi : la cohérence métier — praticien
// présent, créneau libre, acte pratiqué par ce praticien. Zod vérifie la forme
// de ce qui arrive ; le domaine vérifie ce qui est vrai du cabinet (D11). Mettre
// une règle d'agenda ici la rendrait invisible aux deux autres chemins d'écriture
// à venir, le portail public et la resynchronisation hors ligne.

/** Accepte une chaîne ISO comme un Date : un formulaire envoie du texte. */
const instant = z.union([z.iso.datetime(), z.date()]).pipe(z.coerce.date())

export const creerRendezVousSchema = z.object({
  patientId: z.uuid(),
  praticienId: z.uuid(),
  motifId: z.uuid(),
  siteId: z.uuid(),
  debut: instant,
  /**
   * Facultative : la durée vient du couple praticien × motif (D14). Ne la
   * renseigner que pour s'en écarter sciemment sur ce rendez-vous précis — le
   * cabinet a demandé que la durée par défaut reste ajustable à la main.
   */
  dureeMinutes: z.number().int().min(5).max(480).optional(),
  note: z.string().trim().max(1000).optional(),
  /** Urgence glissée par-dessus un planning plein. Le domaine la refuse à qui
   *  n'est pas praticien : ce drapeau est une demande, pas une autorisation. */
  surbooking: z.boolean().default(false),
  horsHoraire: z.boolean().default(false),
})

export type CreerRendezVousInput = z.infer<typeof creerRendezVousSchema>

export const deplacerRendezVousSchema = z.object({
  id: z.uuid(),
  debut: instant,
  dureeMinutes: z.number().int().min(5).max(480).optional(),
  fauteuilId: z.uuid().optional(),
  // « Modifier » dans la fiche (27/10) : le praticien, l'acte et la note changent avec l'heure.
  praticienId: z.uuid().optional(),
  motifId: z.uuid().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

export type DeplacerRendezVousInput = z.infer<typeof deplacerRendezVousSchema>

// ── Duplication (lot 5) ──────────────────────────────────────────────────
//
// Patient, motif et praticien viennent de la source, jamais du formulaire :
// seule une nouvelle date/heure se saisit. La durée n'est pas ici non plus —
// comme à la création, elle vient du couple praticien × motif au moment de la
// duplication (D14), pas de celui, potentiellement périmé, du rendez-vous source.

export const dupliquerRendezVousSchema = z.object({
  id: z.uuid(),
  debut: instant,
})

export type DupliquerRendezVousInput = z.infer<typeof dupliquerRendezVousSchema>

export const changerStatutSchema = z.object({
  id: z.uuid(),
  statut: z.enum(StatutRendezVous),
  /** Au passage « En caisse » (D81) : le montant validé, en centimes. Absent : le prix du soin. */
  montantCentimes: z.number().int().min(0).max(10_000_000).optional(),
})

export const corrigerMontantSchema = z.object({
  id: z.uuid(),
  montantCentimes: z.number().int().min(0).max(10_000_000),
})

export type ChangerStatutInput = z.infer<typeof changerStatutSchema>

export const annulerRendezVousSchema = z.object({
  id: z.uuid(),
  raison: z.string().trim().max(500).optional(),
})

export type AnnulerRendezVousInput = z.infer<typeof annulerRendezVousSchema>

// ── Décision sur une demande d'annulation (D17, retournée le 2026-09-23) ────

export const validerAnnulationSchema = z.object({
  id: z.uuid(),
})

export type ValiderAnnulationInput = z.infer<typeof validerAnnulationSchema>

export const refuserAnnulationSchema = z.object({
  id: z.uuid(),
  raison: z.string().trim().max(500).optional(),
})

export type RefuserAnnulationInput = z.infer<typeof refuserAnnulationSchema>

export const creerPresenceSchema = z
  .object({
    praticienId: z.uuid(),
    siteId: z.uuid(),
    fauteuilId: z.uuid(),
    debut: instant,
    fin: instant,
  })
  .refine((v) => v.fin > v.debut, { message: 'la fin doit suivre le début', path: ['fin'] })

export type CreerPresenceInput = z.infer<typeof creerPresenceSchema>

export const creerPatientSchema = z.object({
  nom: z.string().trim().min(1).max(100),
  prenom: z.string().trim().min(1).max(100),
  telephone: telephoneSaisi,
  // Facultative : un rendez-vous peut se prendre avec un nom et un téléphone,
  // la fiche se complétant à la venue. C'est aussi la clé qui distingue deux
  // homonymes — d'où la notification de profil incomplet tant qu'elle manque.
  dateNaissance: z.union([z.iso.date(), z.date()]).pipe(z.coerce.date()).optional(),
  email: z.email().trim().toLowerCase().optional(),
  representantLegal: z.string().trim().max(200).optional(),
  telephoneRepresentant: telephoneFacultatif.optional(),
})

export type CreerPatientInput = z.infer<typeof creerPatientSchema>

export const creerMotifSchema = z.object({
  libelle: z.string().trim().min(1).max(120),
  dureeIndicative: z.number().int().min(5).max(480),
  couleur: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'couleur hexadécimale attendue, par exemple #0078cc'),
  estUrgence: z.boolean().default(false),
  ordre: z.number().int().min(0).max(10_000).default(0),
})

export type CreerMotifInput = z.infer<typeof creerMotifSchema>

export const modifierMotifSchema = creerMotifSchema.partial().extend({
  id: z.uuid(),
  actif: z.boolean().optional(),
})

// ─── Navigation des vues de l'agenda (lot 4) ────────────────────────────────
//
// Ce n'est pas une frontière de mutation, mais reste une frontière système :
// l'URL est une saisie utilisateur comme un formulaire, et un lien partagé ou
// tapé à la main peut porter n'importe quoi. `parseParametresAgenda` ne lève
// jamais : un paramètre absent ou invalide retombe sur sa valeur par défaut,
// jamais une erreur 500 pour une adresse mal formée.

export const VUES_AGENDA = ['jour', 'semaine', 'mois'] as const
export type VueAgenda = (typeof VUES_AGENDA)[number]

export type ParametresAgenda = {
  vue: VueAgenda
  /** `AAAA-MM-JJ`, jamais lu depuis l'horloge : l'appelant fournit « aujourd'hui ». */
  date: string
  /** Site explicitement choisi, ou `null` — l'appelant décide alors du site par défaut. */
  siteId: string | null
  /** `site=tous` : demande la vue consolidée des deux cabinets (D5 — encore
   *  soumise à `exigerPorteeGlobale` dans la DAL, ce paramètre n'accorde rien
   *  par lui-même). */
  tousLesSites: boolean
  praticienId: string | null
  /** Exclusions d'affichage (D58), appliquées aux trois vues depuis le 18/10. */
  praticiensExclus: string[]
  motifsExclus: string[]
  statutsExclus: StatutRendezVous[]
  /** Le praticien a coché ses confrères (sinon il ne voit que les siens). */
  tousPraticiens: boolean
}

type ValeurParam = string | string[] | undefined

const vueSchema = z.enum(VUES_AGENDA)
const jourAgendaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    // `Date.parse` normalise silencieusement un 30 février en 2 mars plutôt
    // que de le rejeter : recomposer la date UTC et comparer ses champs à la
    // saisie est ce qui distingue une vraie date d'un débordement de calendrier.
    const [annee, mois, jour] = d.split('-').map(Number) as [number, number, number]
    const recompose = new Date(Date.UTC(annee, mois - 1, jour))
    return (
      recompose.getUTCFullYear() === annee && recompose.getUTCMonth() === mois - 1 && recompose.getUTCDate() === jour
    )
  })
const uuidSchema = z.uuid()

function parseSite(brut: string | undefined): { siteId: string | null; tousLesSites: boolean } {
  if (brut === 'tous') return { siteId: null, tousLesSites: true }
  const r = uuidSchema.safeParse(brut)
  return { siteId: r.success ? r.data : null, tousLesSites: false }
}

const MAX_EXCLUSIONS = 50

/** Une liste de paramètres répétés, filtrée par `schema` : l'invalide est ignoré, jamais une erreur. */
function lireListe<T extends string>(brut: ValeurParam, schema: z.ZodType<T>): T[] {
  const valeurs = brut === undefined ? [] : Array.isArray(brut) ? brut : [brut]
  const out: T[] = []
  for (const v of valeurs) {
    const r = schema.safeParse(v)
    if (r.success && !out.includes(r.data)) out.push(r.data)
    if (out.length >= MAX_EXCLUSIONS) break
  }
  return out
}

const statutSchema = z.enum(StatutRendezVous)

/**
 * Lit les paramètres de navigation de l'agenda depuis l'URL.
 *
 * `jour` (l'ancien et unique paramètre de la vue du jour) reste lu en secours
 * quand `date` est absent : les liens déjà partagés avant ce lot continuent de
 * fonctionner sans redirection.
 */
export function parseParametresAgenda(
  brut: {
    vue?: string
    date?: string
    jour?: string
    site?: string
    praticien?: string
    sansPraticien?: ValeurParam
    sansMotif?: ValeurParam
    sansStatut?: ValeurParam
    tousPraticiens?: ValeurParam
  },
  aujourdHui: string,
): ParametresAgenda {
  const vue = vueSchema.safeParse(brut.vue)
  const date = jourAgendaSchema.safeParse(brut.date ?? brut.jour)
  const { siteId, tousLesSites } = parseSite(brut.site)
  const praticien = uuidSchema.safeParse(brut.praticien)

  return {
    vue: vue.success ? vue.data : 'jour',
    date: date.success ? date.data : aujourdHui,
    siteId,
    tousLesSites,
    praticienId: praticien.success ? praticien.data : null,
    praticiensExclus: lireListe(brut.sansPraticien, uuidSchema),
    motifsExclus: lireListe(brut.sansMotif, uuidSchema),
    statutsExclus: lireListe(brut.sansStatut, statutSchema),
    tousPraticiens: brut.tousPraticiens === '1',
  }
}

export type ModifierMotifInput = z.infer<typeof modifierMotifSchema>

/** Durée d'un acte pour un praticien donné (D14). */
export const definirDureeSchema = z.object({
  praticienId: z.uuid(),
  motifId: z.uuid(),
  dureeMinutes: z.number().int().min(5).max(480),
})

export type DefinirDureeInput = z.infer<typeof definirDureeSchema>

// ── Menu proposé aux patients sur le portail ────────────────────────────────

export const creerMotifPatientSchema = z.object({
  libelle: z.string().trim().min(1, 'libellé requis').max(120),
  aide: z.string().trim().max(200).optional(),
  /** Nul au premier niveau, renseigné pour une sous-entrée. */
  parentId: z.uuid().optional(),
  /** Nul sur un menu, renseigné sur un choix final. */
  motifId: z.uuid().optional(),
  ordre: z.number().int().min(0).max(10_000).default(0),
})

export type CreerMotifPatientInput = z.infer<typeof creerMotifPatientSchema>

export const modifierMotifPatientSchema = z.object({
  id: z.uuid(),
  libelle: z.string().trim().min(1).max(120).optional(),
  /** Chaîne vide = retirer le texte d'aide. */
  aide: z.string().trim().max(200).nullable().optional(),
  /** Chaîne vide = détacher l'acte, l'entrée cesse d'être proposée. */
  motifId: z.uuid().nullable().optional(),
  ordre: z.number().int().min(0).max(10_000).optional(),
  actif: z.boolean().optional(),
})

export type ModifierMotifPatientInput = z.infer<typeof modifierMotifPatientSchema>
