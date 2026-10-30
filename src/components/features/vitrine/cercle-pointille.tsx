// Anneau vert entouré de points dégradés, repris de la V3 du haut de page (19/10).
// Les points sont calculés une fois, au chargement du module : rien ne bouge.

const RAYON = 100

const POINTS = Array.from({ length: 4 }, (_, k) => {
  const pas = 7 + k * 2
  return Array.from({ length: Math.floor(360 / pas) }, (_, i) => {
    const t = (i * pas * Math.PI) / 180
    const r = RAYON + 20 + k * 14
    return { x: r * Math.cos(t), y: r * Math.sin(t), taille: 4.5 - k, opacite: 0.85 - k * 0.18 }
  })
}).flat()

export function CerclePointille({ className, couleur = '#3f9d8f' }: { className?: string; couleur?: string }) {
  return (
    <svg aria-hidden viewBox="-170 -170 340 340" className={className}>
      {POINTS.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={p.taille} fill={couleur} opacity={p.opacite} />
      ))}
      <circle r={RAYON} fill="none" stroke={couleur} strokeWidth={9} />
    </svg>
  )
}
