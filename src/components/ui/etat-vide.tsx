import { AlertCircle, FilterX, Inbox } from "lucide-react"

import { cn } from "@/lib/utils"

const VARIANTES = {
  "jamais-rempli": Inbox,
  filtre: FilterX,
  erreur: AlertCircle,
} as const

/**
 * Trois vides différents, trois traitements différents : rien encore créé
 * (invitation à agir), un filtre sans résultat (explique et propose
 * d'élargir), une erreur de chargement (propose de réessayer).
 */
export function EtatVide({
  variante,
  titre,
  texte,
  action,
  className,
}: {
  variante: "jamais-rempli" | "filtre" | "erreur"
  titre: string
  texte: string
  action?: React.ReactNode
  className?: string
}) {
  const Icone = VARIANTES[variante]

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-[1.75rem] border-2 border-dashed border-[#d3e6e1] bg-white/70 px-6 py-12 text-center",
        className,
      )}
    >
      <span aria-hidden className="hexagone grid h-14 w-12 place-items-center bg-[#e4f1ee] text-[#387a70]">
        <Icone className="size-6" strokeWidth={1.7} />
      </span>
      <p className="font-heading text-base font-semibold text-foreground">{titre}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{texte}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
