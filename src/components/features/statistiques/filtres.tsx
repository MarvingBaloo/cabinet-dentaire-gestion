'use client'

import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { cn } from '@/lib/utils'

/**
 * Période, praticien et cabinet, en tête de chaque onglet. Ils vivent dans l'adresse : un onglet ouvert depuis
 * un autre garde le même choix (la barre du haut recopie la requête), et la page se partage telle quelle.
 */
export function FiltresStatistiques({
  periodes,
  praticiens,
  cabinets,
  choix,
}: {
  periodes: { valeur: string; libelle: string }[]
  /** Vide pour un praticien qui ne voit que ses propres chiffres : le filtre n'est pas montré. */
  praticiens: { id: string; nom: string }[]
  cabinets: { id: string; nom: string }[]
  choix: { periode: string; praticien: string; cabinet: string }
}) {
  const chemin = usePathname()
  const params = useSearchParams()
  const router = useRouter()

  const avec = (cle: string, valeur: string) => {
    const p = new URLSearchParams(params.toString())
    p.set(cle, valeur)
    return `${chemin}?${p.toString()}`
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <nav aria-label="Période" className="inline-flex max-w-full overflow-x-auto rounded-full border border-border bg-white p-[3px]">
        {periodes.map((p) => (
          <Link
            key={p.valeur}
            href={avec('periode', p.valeur)}
            replace
            scroll={false}
            aria-current={p.valeur === choix.periode ? 'true' : undefined}
            className={cn(
              'rounded-full px-2.5 py-1.5 text-[0.8125rem] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-3.5',
              p.valeur === choix.periode && 'bg-primary font-semibold text-white hover:text-white',
            )}
          >
            {p.libelle}
          </Link>
        ))}
      </nav>
      {praticiens.length > 0 ? (
        <Choix
          libelle="Praticien"
          valeur={choix.praticien}
          options={[{ id: 'tous', nom: 'Tout le cabinet' }, ...praticiens]}
          onChange={(v) => router.replace(avec('praticien', v), { scroll: false })}
        />
      ) : null}
      {cabinets.length > 1 ? (
        <Choix
          libelle="Cabinet"
          valeur={choix.cabinet}
          options={[{ id: 'tous', nom: 'Les deux' }, ...cabinets]}
          onChange={(v) => router.replace(avec('cabinet', v), { scroll: false })}
        />
      ) : null}
    </div>
  )
}

function Choix({
  libelle,
  valeur,
  options,
  onChange,
}: {
  libelle: string
  valeur: string
  options: { id: string; nom: string }[]
  onChange: (v: string) => void
}) {
  return (
    <label className="relative inline-flex max-w-full min-w-0 items-center rounded-full border border-border bg-white pr-8 pl-3.5 text-[0.8125rem] focus-within:border-primary">
      <span className="whitespace-nowrap text-muted-foreground">{libelle}&nbsp;:</span>
      <select
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        // 16 px sur téléphone : en dessous, Safari zoome sur la liste à l'ouverture.
        className="h-9 min-h-0 min-w-0 cursor-pointer appearance-none truncate border-0 bg-transparent py-0 pr-0 pl-1.5 text-base font-semibold focus:outline-none sm:text-[0.8125rem]"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nom}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 size-4 text-muted-foreground" />
    </label>
  )
}
