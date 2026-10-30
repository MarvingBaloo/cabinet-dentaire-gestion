import { badgeSite, couleurSite } from '@/lib/sites'

// Légende de la vue consolidée (lot 4) : chaque cabinet s'y lit par sa couleur
// ET son badge textuel — jamais la couleur seule (RGAA). `null` quand un seul
// site est présent : rien à distinguer, la légende n'a alors rien à dire.

export function LegendeSites({ sites }: { sites: { id: string; code: string; nom: string }[] }) {
  if (sites.length < 2) return null

  return (
    <ul aria-label="Légende des cabinets" className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {sites.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: couleurSite(s.code) }}
          />
          <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-semibold">{badgeSite(s.code, s.nom)}</span>
          {s.nom}
        </li>
      ))}
    </ul>
  )
}
