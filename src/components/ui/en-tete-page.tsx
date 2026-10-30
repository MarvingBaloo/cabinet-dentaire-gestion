import { cn } from "@/lib/utils"

/** Même `h1` et mêmes espacements sur toutes les pages du tableau de bord. */
export function EnTetePage({
  titre,
  description,
  actions,
  className,
}: {
  titre: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div>
        <h1 className="font-heading text-[length:var(--texte-titre-4)] leading-[1.1] font-bold tracking-tight text-foreground">
          {titre}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
