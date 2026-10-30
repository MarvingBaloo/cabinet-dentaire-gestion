import type { CSSProperties } from 'react'

// Fond du haut de l'accueil (19/10) : une grille de plaques hexagonales translucides
// qu'une vague de lumière traverse toutes les 8 s. Sur son passage les plaques se
// soulèvent l'une après l'autre ; trois d'entre elles portent une icône dentaire et
// montent plus haut.
//
// La grille est calée sur le bord droit (largeur fixe) : les plaques à icône gardent la
// même place quelle que soit la largeur d'écran, loin du titre. Le retard de chaque
// plaque suit la position de la bande de lumière, calculée pour un écran de 1440 px —
// sur d'autres largeurs l'ondulation reste lisible, à peine décalée.

const R = 62
const L = R * Math.sqrt(3)
const LARGEUR = 1100
const HAUTEUR = 900
const ESPACE = 3

function sommets(x: number, y: number, r: number) {
  const l = r * Math.sqrt(3)
  return [
    [x, y - r],
    [x + l / 2, y - r / 2],
    [x + l / 2, y + r / 2],
    [x, y + r],
    [x - l / 2, y + r / 2],
    [x - l / 2, y - r / 2],
  ]
    .map(([a, b]) => `${a!.toFixed(1)},${b!.toFixed(1)}`)
    .join(' ')
}

/** Retard (s) pour que la plaque soit au plus haut quand le centre de la bande passe :
 *  la bande traverse en 4 s, de -720 à 2160 px sur un écran de 1440, et sa ligne
 *  centrale suit x + 0,18·y (dégradé à 100°). Le sommet de la montée est à 0,56 s. */
function retard(x: number, y: number) {
  return ((1440 - LARGEUR + 720 + x + 0.18 * y) / 720 - 0.56).toFixed(2)
}

// Centres de la grille : rangées (L/2 + L·i, R + 3R·j) et rangées décalées (L·i, 2,5R + 3R·j).
const PLAQUES = [
  ...Array.from({ length: 11 }, (_, i) => Array.from({ length: 5 }, (_, j) => ({ x: L / 2 + L * i, y: R + 3 * R * j }))),
  ...Array.from({ length: 12 }, (_, i) => Array.from({ length: 5 }, (_, j) => ({ x: L * i, y: 2.5 * R + 3 * R * j }))),
]
  .flat()
  .filter((p) => p.y - R < HAUTEUR)

const ICONES = {
  dent: (
    <path d="M7 3c-2.2 0-4 1.8-4 4.2 0 2 .7 3.3 1.3 5 .6 1.9.7 4.5 1.3 6.6.3 1.1.8 2.2 1.8 2.2 1.3 0 1.4-2.2 1.7-3.6.3-1.4.6-2.6 1.9-2.6s1.6 1.2 1.9 2.6c.3 1.4.4 3.6 1.7 3.6 1 0 1.5-1.1 1.8-2.2.6-2.1.7-4.7 1.3-6.6.6-1.7 1.3-3 1.3-5C21 4.8 19.2 3 17 3c-1.9 0-2.9 1-5 1S8.9 3 7 3z" />
  ),
  bouclier: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
  calendrier: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M8 15h2M14 15h2" />
    </>
  ),
}

const A_ICONE: { x: number; y: number; icone: keyof typeof ICONES }[] = [
  { x: L / 2 + 8 * L, y: R + 3 * R, icone: 'dent' },
  { x: 7 * L, y: 2.5 * R + 3 * R, icone: 'bouclier' },
  { x: L / 2 + 8 * L, y: R + 6 * R, icone: 'calendrier' },
]

export function FondHero() {
  return (
    <>
      {/* Le vert d'eau dessine une virgule sur le fond bleu : tête ronde en haut à gauche, queue
          qui s'effile vers le bas, très floutée pour se fondre dans le dégradé. */}
      <svg
        aria-hidden
        viewBox="0 0 1440 800"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 -z-30 size-full blur-[60px]"
      >
        <path
          d="M-200 -200 L980 -200 C1020 120 820 300 640 380 C500 440 470 560 560 700 C620 790 760 860 900 900 L-200 900 Z"
          fill="#d3ebe5"
        />
      </svg>
      <div aria-hidden className="vague-lumiere -z-20" />
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 -z-10 h-full [mask-image:linear-gradient(90deg,transparent,#000_40%)]"
        style={{ width: LARGEUR }}
      >
        {PLAQUES.map(({ x, y }) => (
          <polygon
            key={`${x.toFixed(0)}-${y.toFixed(0)}`}
            points={sommets(x, y, R - ESPACE)}
            className="plaque"
            style={{ animationDelay: `${retard(x, y)}s` } as CSSProperties}
          />
        ))}
        <g className="max-xl:hidden">
          {A_ICONE.map(({ x, y, icone }) => (
            <g key={icone} className="plaque-icone" style={{ animationDelay: `${retard(x, y)}s` } as CSSProperties}>
              <polygon
                points={sommets(x, y, R - ESPACE)}
                fill="rgb(255 255 255 / 0.14)"
                stroke="#fff"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
              <g
                transform={`translate(${(x - 24).toFixed(1)} ${(y - 24).toFixed(1)}) scale(2)`}
                fill="none"
                stroke="#fff"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICONES[icone]}
              </g>
            </g>
          ))}
        </g>
      </svg>
    </>
  )
}
