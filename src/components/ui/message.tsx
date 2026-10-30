import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"

const STYLES = {
  erreur: {
    classe: "border-etat-erreur/30 bg-etat-erreur-fond text-etat-erreur",
    Icone: XCircle,
  },
  succes: {
    classe: "border-etat-succes/30 bg-etat-succes-fond text-etat-succes",
    Icone: CheckCircle2,
  },
  alerte: {
    classe: "border-etat-alerte/30 bg-etat-alerte-fond text-etat-alerte",
    Icone: AlertTriangle,
  },
  info: {
    classe: "border-border bg-muted text-foreground",
    Icone: Info,
  },
} as const

/**
 * Remplace les paragraphes rouges/verts recopiés dans les formulaires.
 * La couleur ne porte jamais seule l'information : une icône et le `role`
 * d'origine de chaque appelant l'accompagnent toujours.
 */
export function Message({
  ton,
  role,
  id,
  className,
  children,
}: {
  ton: "erreur" | "succes" | "alerte" | "info"
  role?: "alert" | "status"
  id?: string
  className?: string
  children: React.ReactNode
}) {
  const { classe, Icone } = STYLES[ton]

  return (
    <p
      id={id}
      role={role}
      className={cn(
        "flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm",
        classe,
        className,
      )}
    >
      <Icone aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
