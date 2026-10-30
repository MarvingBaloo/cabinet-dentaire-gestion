import 'server-only'

import { StatutRendezVous, TypeIndisponibilite } from '@prisma/client'

import { decalerJour, heureCabinet, instantCabinet, jourLocal, minutesDepuisMinuit } from '@/lib/dates'
import { libelleFerie } from '@/lib/jours-feries'
import { prisma } from '@/server/db/client'
import { HORIZON_JOURS, creneauxDisponibles } from '@/server/queries/public/creneaux'

// Ce que l'assistant voit de l'agenda (D79) : un accès permanent, qu'il interroge lui-même au moment où il
// réfléchit — les présences, les congés et fermetures, le remplissage, les créneaux libres. Jamais un patient : ni
// nom, ni téléphone, ni motif ; seulement des heures, des praticiens et des taux. C'est ce qu'une secrétaire lit
// d'un coup d'œil au planning avant de proposer une heure au téléphone.

export type CreneauVu = {
  id: string
  praticienId: string
  siteId: string
  debut: string
  fin: string
  praticien: string
  /** Dans une plage gardée aux urgences (7 h 30 – 9 h), ou une place ordinaire. */
  type: 'urgence' | 'ordinaire'
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/
const OCCUPE_PAS: StatutRendezVous[] = [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT]

const jourFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'America/Guadeloupe',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})
export const jourEnClair = (jour: string) => jourFormat.format(instantCabinet(jour, '12:00')!)

/** Une période demandée par le modèle, ramenée à ce qu'il a le droit de voir : d'aujourd'hui à l'horizon de réservation. */
export function bornerPeriode(du: unknown, au: unknown, maxJours: number): { du: string; au: string } {
  const aujourdHui = jourLocal(new Date())
  const horizon = decalerJour(aujourdHui, HORIZON_JOURS)
  let debut = typeof du === 'string' && JOUR.test(du) && du >= aujourdHui ? du : aujourdHui
  if (debut > horizon) debut = horizon
  let fin = typeof au === 'string' && JOUR.test(au) && au >= debut ? au : debut
  if (fin > horizon) fin = horizon
  if (fin > decalerJour(debut, maxJours - 1)) fin = decalerJour(debut, maxJours - 1)
  return { du: debut, au: fin }
}

async function motifUrgence() {
  return prisma.motifConsultation.findFirst({
    where: { estUrgence: true, actif: true },
    orderBy: [{ ordre: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
}

const recouvre = (a: { debut: Date; fin: Date }, b: { debut: Date; fin: Date }) => a.debut < b.fin && a.fin > b.debut

/** Les créneaux libres du motif « urgence » sur une période, chacun dit « urgence » ou « ordinaire ». */
async function creneauxClasses(du: string, au: string, praticienId?: string): Promise<CreneauVu[]> {
  const motif = await motifUrgence()
  if (!motif) return []
  const debut = instantCabinet(du, '00:00')!
  const fin = instantCabinet(decalerJour(au, 1), '00:00')!
  const [libres, gardes, praticiens] = await Promise.all([
    creneauxDisponibles({ motifId: motif.id, debut, fin, ...(praticienId ? { praticienId } : {}) }),
    prisma.indisponibilite.findMany({
      where: { type: TypeIndisponibilite.RESERVE_URGENCE, debut: { lt: fin }, fin: { gt: debut } },
      select: { praticienId: true, siteId: true, debut: true, fin: true },
    }),
    prisma.praticien.findMany({ select: { id: true, nom: true, titre: true } }),
  ])
  return libres.map((c) => {
    const p = praticiens.find((x) => x.id === c.praticienId)
    const urgence = gardes.some(
      (g) =>
        (g.praticienId === null || g.praticienId === c.praticienId) &&
        (g.siteId === null || g.siteId === c.siteId) &&
        recouvre(g, c),
    )
    const jour = jourLocal(c.debut)
    return {
      id: `${jour}-${heureCabinet(c.debut).replace(':', '')}-${c.praticienId.slice(0, 4)}`,
      praticienId: c.praticienId,
      siteId: c.siteId,
      debut: c.debut.toISOString(),
      fin: c.fin.toISOString(),
      praticien: p ? `Dr ${p.nom}${/implant/i.test(p.titre) ? ' (implantologie)' : ''}` : 'Dr ?',
      type: urgence ? 'urgence' : 'ordinaire',
    }
  })
}

/**
 * L'agenda d'une période, jour par jour : qui reçoit, où, à quelles heures ; congés, fermetures, jours fériés ;
 * remplissage du matin et de l'après-midi ; urgences déjà posées ; places libres, d'urgence et ordinaires.
 */
export async function consulterAgenda(du: string, au: string) {
  const debut = instantCabinet(du, '00:00')!
  const fin = instantCabinet(decalerJour(au, 1), '00:00')!
  const [plages, indispos, rdv, libres] = await Promise.all([
    prisma.plageDePresence.findMany({
      where: { debut: { lt: fin }, fin: { gt: debut }, site: { actif: true }, praticien: { actif: true } },
      select: { praticienId: true, debut: true, fin: true, site: { select: { nom: true } }, praticien: { select: { nom: true, titre: true } } },
      orderBy: { debut: 'asc' },
    }),
    prisma.indisponibilite.findMany({
      where: { debut: { lt: fin }, fin: { gt: debut }, type: { not: TypeIndisponibilite.RESERVE_URGENCE } },
      select: { type: true, praticienId: true, siteId: true, debut: true, fin: true },
    }),
    // ⚠ Rien qui identifie le patient ni le motif : des heures, un praticien, et « urgence ou non ».
    prisma.rendezVous.findMany({
      where: { debut: { lt: fin }, fin: { gt: debut }, statut: { notIn: OCCUPE_PAS } },
      select: { praticienId: true, debut: true, fin: true, motif: { select: { estUrgence: true } } },
    }),
    creneauxClasses(du, au),
  ])

  const jours: string[] = []
  for (let j = du; j <= au; j = decalerJour(j, 1)) jours.push(j)

  return jours.map((jour) => {
    const bornes = { debut: instantCabinet(jour, '00:00')!, fin: instantCabinet(decalerJour(jour, 1), '00:00')! }
    const treize = instantCabinet(jour, '13:00')!
    const occupe = (praticienId: string, d: Date, f: Date) =>
      rdv
        .filter((r) => r.praticienId === praticienId && r.debut < f && r.fin > d)
        .reduce((s, r) => s + (Math.min(r.fin.getTime(), f.getTime()) - Math.max(r.debut.getTime(), d.getTime())) / 60_000, 0)
    const taux = (praticienId: string, d: Date, f: Date) => {
      const duree = (f.getTime() - d.getTime()) / 60_000
      return duree > 0 ? Math.min(100, Math.round((occupe(praticienId, d, f) / duree) * 100)) : null
    }
    const duJour = libres.filter((c) => jourLocal(new Date(c.debut)) === jour)
    return {
      jour,
      nom: jourEnClair(jour),
      ...(libelleFerie(jour) ? { ferie: libelleFerie(jour) } : {}),
      fermeturesEtConges: indispos
        .filter((i) => recouvre(i, bornes))
        .map((i) => ({
          type: i.type === TypeIndisponibilite.CONGE ? 'congé' : i.type === TypeIndisponibilite.FERMETURE ? 'fermeture du cabinet' : 'indisponibilité',
          praticien: plages.find((p) => p.praticienId === i.praticienId)?.praticien.nom ?? (i.praticienId ? 'un praticien' : 'tous'),
          de: heureCabinet(new Date(Math.max(i.debut.getTime(), bornes.debut.getTime()))),
          a: i.fin >= bornes.fin ? 'fin de journée' : heureCabinet(i.fin),
        })),
      praticiens: plages
        .filter((p) => jourLocal(p.debut) === jour)
        .map((p) => ({
          praticien: `Dr ${p.praticien.nom}${/implant/i.test(p.praticien.titre) ? ' (implantologie)' : ''}`,
          cabinet: p.site.nom,
          horaires: `${heureCabinet(p.debut)}–${heureCabinet(p.fin)}`,
          remplissageMatin: p.debut < treize ? taux(p.praticienId, p.debut, new Date(Math.min(p.fin.getTime(), treize.getTime()))) : null,
          remplissageApresMidi: p.fin > treize ? taux(p.praticienId, new Date(Math.max(p.debut.getTime(), treize.getTime())), p.fin) : null,
          urgencesDejaPosees: rdv.filter((r) => r.praticienId === p.praticienId && r.motif.estUrgence && recouvre(r, p)).length,
        })),
      placesUrgenceLibres: duJour.filter((c) => c.type === 'urgence').length,
      placesOrdinairesLibres: duJour.filter((c) => c.type === 'ordinaire').length,
    }
  })
}

/** Les créneaux libres d'une période, filtrés : type (urgence, ordinaire), moment, praticien. Les quinze premiers. */
export async function chercherCreneaux(demande: {
  du: string
  au: string
  type: 'urgence' | 'ordinaire' | 'tous'
  moment?: 'matin' | 'midi' | 'apres-midi' | undefined
  praticienId?: string | undefined
}): Promise<CreneauVu[]> {
  const tous = await creneauxClasses(demande.du, demande.au, demande.praticienId)
  return tous
    .filter((c) => demande.type === 'tous' || c.type === demande.type)
    .filter((c) => {
      if (!demande.moment) return true
      const m = minutesDepuisMinuit(new Date(c.debut), jourLocal(new Date(c.debut)))
      return demande.moment === 'matin' ? m < 12 * 60 : demande.moment === 'midi' ? m >= 12 * 60 && m < 14 * 60 : m >= 14 * 60
    })
    .slice(0, 15)
}
