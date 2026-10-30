// Ce que la réservation en ligne montre des créneaux libres (maquette du 26/10, version P1,
// docs/maquettes/maquette-choix-creneau.pdf) : peu à la fois, jamais collés, jamais comptés — un mur de places
// libres laisse croire que le cabinet est vide. Chaque horaire montré est réellement libre ; seule la quantité
// montrée change. Module neutre, sans base ni React : testé seul.

export type Moment = 'matin' | 'midi' | 'apres-midi'

export const LIBELLE_MOMENT: Record<Moment, string> = { matin: 'Matin', midi: 'Midi', 'apres-midi': 'Après-midi' }

const MOMENTS: Moment[] = ['matin', 'midi', 'apres-midi']

/** Le moment de la journée d'un horaire, en minutes depuis minuit au cabinet. */
export function momentDe(minutes: number): Moment {
  return minutes < 12 * 60 ? 'matin' : minutes < 14 * 60 ? 'midi' : 'apres-midi'
}

/** Un nombre tiré du texte, toujours le même pour le même texte. */
function empreinte(texte: string): number {
  let h = 2166136261
  for (let i = 0; i < texte.length; i++) h = Math.imul(h ^ texte.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Écart minimal entre deux horaires montrés le même jour : 13 h 30 puis 14 h 00 se lisent comme une journée vide. */
const ECART_MINUTES = 60

/**
 * Les horaires montrés pour un jour : au plus un par moment (matin, midi, après-midi), à une heure au moins l'un de
 * l'autre. Choisi au hasard parmi les libres de ce moment, mais toujours le même pour ce jour : le patient qui
 * revient retrouve ce qu'il a vu.
 */
export function horairesDuJour<T>(jour: string, libres: T[], minutes: (c: T) => number): { moment: Moment; creneau: T }[] {
  const montres: { moment: Moment; creneau: T }[] = []
  for (const moment of MOMENTS) {
    const ceux = libres.filter(
      (c) =>
        momentDe(minutes(c)) === moment &&
        montres.every((m) => Math.abs(minutes(m.creneau) - minutes(c)) >= ECART_MINUTES),
    )
    if (ceux.length) montres.push({ moment, creneau: ceux[empreinte(`${jour}|${moment}`) % ceux.length]! })
  }
  return montres
}

/**
 * Les trois propositions du début : trois jours différents, les premiers où il reste de la place, et des moments
 * qui changent d'un jour à l'autre (matin, puis après-midi, puis midi) quand c'est possible.
 */
export function propositions<T>(parJour: Map<string, T[]>, minutes: (c: T) => number, nombre = 3): T[] {
  const ordre: Moment[] = ['matin', 'apres-midi', 'midi']
  const retenues: T[] = []
  for (const [jour, libres] of parJour) {
    if (retenues.length === nombre) break
    const montres = horairesDuJour(jour, libres, minutes)
    const voulu = ordre[retenues.length % ordre.length]
    const pris = montres.find((m) => m.moment === voulu) ?? montres[0]
    if (pris) retenues.push(pris.creneau)
  }
  return retenues
}
