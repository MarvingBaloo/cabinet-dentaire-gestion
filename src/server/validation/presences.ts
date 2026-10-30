import { TypeExceptionPresence } from '@prisma/client'
import { z } from 'zod'

// Validation aux frontières système uniquement (même principe qu'agenda.ts) :
// Zod vérifie la FORME de ce qui arrive d'un formulaire. Ce qu'il ne vérifie
// PAS, et pourquoi : la couverture des rendez-vous déjà posés (Q5, D11) — la
// règle n'existe qu'une fois, dans le domaine, rejouée par le service.

const heureHHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure invalide (HH:MM attendu)')

export const jourSemaineSchema = z.number().int().min(1).max(7)

/**
 * Une ligne de la semaine type, jour par jour.
 *
 * `actif: false` = « pas de présence » : les autres champs sont alors
 * ignorés, jamais exigés — c'est le sens même du choix. `actif: true` exige
 * les quatre, vérifié par `superRefine` plutôt que par un schéma discriminé :
 * un discriminant sur un booléen se lirait moins bien qu'un message ciblé par
 * champ, et le formulaire n'envoie jamais qu'un objet plat.
 */
export const enregistrerJourSemaineTypeSchema = z
  .object({
    praticienId: z.uuid(),
    jourSemaine: jourSemaineSchema,
    actif: z.boolean(),
    siteId: z.uuid().optional(),
    /** Ignoré quand le praticien a déjà son fauteuil dans ce cabinet : il est fixe (27/10). */
    fauteuilId: z.uuid().optional(),
    heureDebut: heureHHMM.optional(),
    heureFin: heureHHMM.optional(),
    /** Pause facultative (le midi) : les deux ou aucune, à l'intérieur de la journée. */
    pauseDebut: heureHHMM.optional(),
    pauseFin: heureHHMM.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.actif) return
    if (!v.siteId) ctx.addIssue({ code: 'custom', message: 'cabinet requis', path: ['siteId'] })
    if (!v.heureDebut || !v.heureFin) {
      ctx.addIssue({ code: 'custom', message: 'heures de début et de fin requises', path: ['heureDebut'] })
      return
    }
    if (v.heureFin <= v.heureDebut) {
      ctx.addIssue({ code: 'custom', message: 'la fin doit suivre le début', path: ['heureFin'] })
      return
    }
    if (Boolean(v.pauseDebut) !== Boolean(v.pauseFin)) {
      ctx.addIssue({ code: 'custom', message: 'pause : indiquez son début et sa fin', path: ['pauseDebut'] })
      return
    }
    // Les heures « HH:MM » se comparent comme des chaînes.
    if (
      v.pauseDebut &&
      v.pauseFin &&
      !(v.heureDebut < v.pauseDebut && v.pauseDebut < v.pauseFin && v.pauseFin < v.heureFin)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'la pause doit tenir à l’intérieur des horaires du jour',
        path: ['pauseDebut'],
      })
    }
  })

export type EnregistrerJourSemaineTypeInput = z.infer<typeof enregistrerJourSemaineTypeSchema>

/**
 * Une exception ponctuelle. Même logique qu'au-dessus : RETRAIT n'exige rien
 * de plus, AJOUT_OU_MODIFICATION exige les quatre champs de présence.
 */
export const enregistrerExceptionSchema = z
  .object({
    praticienId: z.uuid(),
    /** Jour civil "AAAA-MM-JJ", jamais une date-heure : une exception porte
     *  sur un jour entier, pas sur un instant. */
    date: z.iso.date(),
    type: z.enum(TypeExceptionPresence),
    motif: z.string().trim().max(300).optional(),
    siteId: z.uuid().optional(),
    fauteuilId: z.uuid().optional(),
    heureDebut: heureHHMM.optional(),
    heureFin: heureHHMM.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type !== TypeExceptionPresence.AJOUT_OU_MODIFICATION) return
    if (!v.siteId) ctx.addIssue({ code: 'custom', message: 'cabinet requis', path: ['siteId'] })
    if (!v.heureDebut || !v.heureFin) {
      ctx.addIssue({ code: 'custom', message: 'heures de début et de fin requises', path: ['heureDebut'] })
      return
    }
    if (v.heureFin <= v.heureDebut) {
      ctx.addIssue({ code: 'custom', message: 'la fin doit suivre le début', path: ['heureFin'] })
    }
  })

export type EnregistrerExceptionInput = z.infer<typeof enregistrerExceptionSchema>

export const supprimerExceptionSchema = z.object({ id: z.uuid() })
export type SupprimerExceptionInput = z.infer<typeof supprimerExceptionSchema>

export const choisirFauteuilSchema = z.object({ praticienId: z.uuid(), siteId: z.uuid(), fauteuilId: z.uuid() })
