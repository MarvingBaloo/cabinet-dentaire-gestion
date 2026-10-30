// Jours de présence, écrits comme un patient les lit sur le site public
// (maquettes du 13/10) : « lun. → sam. », « du lundi au samedi », « le vendredi ».
// Module neutre : lu par les pages publiques, serveur comme client.

const COURTS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

/** Suites de jours consécutifs : [1,2,3,4,6] → [[1,4],[6,6]]. Jours 1 (lundi) à 7, triés. */
function suites(jours: number[]): [number, number][] {
  const res: [number, number][] = []
  for (const j of jours) {
    const derniere = res.at(-1)
    if (derniere && j === derniere[1] + 1) derniere[1] = j
    else res.push([j, j])
  }
  return res
}

function liste(mots: string[]): string {
  return mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots.at(-1)}` : (mots[0] ?? '')
}

/** « lun. → sam. », « le vendredi », « lun. → jeu. et sam. ». */
export function joursCourts(jours: number[]): string {
  if (jours.length === 1) return `le ${LONGS[jours[0]! - 1]}`
  return liste(suites(jours).map(([a, b]) => (a === b ? COURTS[a - 1]! : `${COURTS[a - 1]} → ${COURTS[b - 1]}`)))
}

/** « du lundi au samedi », « le vendredi », « du lundi au jeudi et le samedi ». */
export function joursLongs(jours: number[]): string {
  return liste(
    suites(jours).map(([a, b]) => (a === b ? `le ${LONGS[a - 1]}` : `du ${LONGS[a - 1]} au ${LONGS[b - 1]}`)),
  )
}

/** « Cabinet de Marie-Galante » → « Marie-Galante ». */
export function nomCourtCabinet(nom: string): string {
  return nom.replace(/^Cabinet (de |d’|d')/, '')
}

/** « Marie-Galante · lun. → sam. · Guadeloupe le vendredi ». */
export function ouIlRecoit(sites: { siteNom: string; jours: number[] }[]): string {
  return sites
    .map((s, i) =>
      i === 0 || s.jours.length > 1
        ? `${nomCourtCabinet(s.siteNom)} · ${joursCourts(s.jours)}`
        : `${nomCourtCabinet(s.siteNom)} ${joursCourts(s.jours)}`,
    )
    .join(' · ')
}
