import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// Alvéoles des écrans Patients (maquette P1 du 20/10) : les initiales du patient
// et le titre des encadrés de la fiche, chacun dans un hexagone vert d'eau.

export function Initiales({ prenom, nom, grand = false }: { prenom: string; nom: string; grand?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'hexagone grid shrink-0 place-items-center font-heading font-extrabold',
        grand
          ? 'h-[4.75rem] w-[4.25rem] bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-2xl text-white sm:h-[5.375rem] sm:w-[4.75rem] sm:text-[1.625rem]'
          : 'h-[3.125rem] w-11 bg-[#e4f1ee] text-[0.9375rem] text-[#387a70]',
      )}
    >
      {(prenom.charAt(0) + nom.charAt(0)).toUpperCase()}
    </span>
  )
}

export function TitreAlveole({
  id,
  icone: Icone,
  children,
}: {
  id: string
  icone: LucideIcon
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="hexagone grid h-[3.25rem] w-[2.875rem] shrink-0 place-items-center bg-[#e4f1ee] text-[#387a70]"
      >
        <Icone className="size-5" strokeWidth={1.7} />
      </span>
      <h2 id={id} className="font-heading text-xl font-bold">
        {children}
      </h2>
    </div>
  )
}
