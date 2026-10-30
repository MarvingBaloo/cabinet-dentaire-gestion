// Les couleurs des praticiens et des motifs viennent de la base : rien ne
// garantit leur contraste sur fond blanc. Module neutre, sans dépendance.

function canal(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function rvb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

/** Rapport de contraste WCAG d'une couleur `#rrggbb` sur fond blanc. */
export function contrasteSurBlanc(hex: string): number {
  const c = rvb(hex)
  if (!c) return 1
  return 1.05 / (luminance(c) + 0.05)
}

/**
 * La couleur donnée, assombrie (même teinte, mélange avec du noir) jusqu'à un
 * contraste d'au moins 4,5:1 sur blanc. Une couleur déjà lisible est rendue
 * telle quelle ; une valeur invalide tombe sur un gris foncé.
 */
export function couleurLisibleSurBlanc(hex: string, seuil = 4.5): string {
  const c = rvb(hex)
  if (!c) return '#3d4a54'
  let facteur = 1
  let courant: [number, number, number] = c
  while (1.05 / (luminance(courant) + 0.05) < seuil && facteur > 0) {
    facteur -= 0.05
    courant = [Math.round(c[0] * facteur), Math.round(c[1] * facteur), Math.round(c[2] * facteur)]
  }
  const h = (v: number) => v.toString(16).padStart(2, '0')
  return `#${h(courant[0])}${h(courant[1])}${h(courant[2])}`
}
