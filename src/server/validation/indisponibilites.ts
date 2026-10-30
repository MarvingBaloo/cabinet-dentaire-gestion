import { z } from 'zod'

// Validation aux frontières système uniquement (même principe que
// validation/presences.ts) : Zod vérifie la FORME de ce qui arrive d'un
// formulaire. Ce qu'il ne vérifie PAS, et pourquoi : la garde anti-orphelin
// (Q5, D11) — elle n'existe qu'une fois, dans le domaine
// (`src/server/domaine/indisponibilites.ts`), rejouée par le service.

const heureHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure invalide (HH:MM attendu)')

/**
 * Les trois seuls usages de cet écran (compléments d'agenda, lot 2). `PAUSE`
 * et `RESERVE_URGENCE` restent hors de sa portée — le cadrage de ce lot ne
 * parle que de congés, fermetures et maintenance.
 */
export const TYPES_INDISPONIBILITE_SAISISSABLES = ['CONGE', 'FERMETURE', 'AUTRE'] as const
export type TypeIndisponibiliteSaisissable = (typeof TYPES_INDISPONIBILITE_SAISISSABLES)[number]

/**
 * Une indisponibilité, jours entiers (`dateDebut`…`dateFin`, bornes incluses)
 * ou en heures (une seule date, `heureDebut`…`heureFin`). Le type détermine ce
 * qui est exigé : CONGE veut un praticien, FERMETURE un cabinet, AUTRE l'un
 * des deux au moins — et dans tous les cas un motif, seul type sans cible
 * intrinsèque (D9 : le journal doit pouvoir dire pourquoi).
 */
export const creerIndisponibiliteSchema = z
  .object({
    type: z.enum(TYPES_INDISPONIBILITE_SAISISSABLES),
    praticienId: z.uuid().optional(),
    siteId: z.uuid().optional(),
    joursEntiers: z.boolean(),
    dateDebut: z.iso.date(),
    /** Requis si `joursEntiers`, ignoré sinon (le créneau tient sur `dateDebut`). */
    dateFin: z.iso.date().optional(),
    heureDebut: heureHHMM.optional(),
    heureFin: heureHHMM.optional(),
    motif: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'CONGE' && !v.praticienId) {
      ctx.addIssue({ code: 'custom', message: 'praticien requis', path: ['praticienId'] })
    }
    if (v.type === 'FERMETURE' && !v.siteId) {
      ctx.addIssue({ code: 'custom', message: 'cabinet requis', path: ['siteId'] })
    }
    if (v.type === 'AUTRE') {
      if (!v.praticienId && !v.siteId) {
        ctx.addIssue({ code: 'custom', message: 'praticien ou cabinet requis', path: ['siteId'] })
      }
      if (!v.motif) {
        ctx.addIssue({ code: 'custom', message: 'motif requis pour « maintenance / autre »', path: ['motif'] })
      }
    }

    if (v.joursEntiers) {
      if (!v.dateFin) {
        ctx.addIssue({ code: 'custom', message: 'date de fin requise', path: ['dateFin'] })
        return
      }
      if (v.dateFin < v.dateDebut) {
        ctx.addIssue({ code: 'custom', message: 'la fin doit suivre le début', path: ['dateFin'] })
      }
    } else {
      if (!v.heureDebut || !v.heureFin) {
        ctx.addIssue({ code: 'custom', message: 'heures de début et de fin requises', path: ['heureDebut'] })
        return
      }
      if (v.heureFin <= v.heureDebut) {
        ctx.addIssue({ code: 'custom', message: 'la fin doit suivre le début', path: ['heureFin'] })
      }
    }
  })

export type CreerIndisponibiliteInput = z.infer<typeof creerIndisponibiliteSchema>

export const supprimerIndisponibiliteSchema = z.object({ id: z.uuid() })
export type SupprimerIndisponibiliteInput = z.infer<typeof supprimerIndisponibiliteSchema>
