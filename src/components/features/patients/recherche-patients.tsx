'use client'

import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef } from 'react'

/**
 * Champ de recherche du fichier patients : la recherche part pendant la frappe
 * (paramètre `q` de l'adresse, lu côté serveur), et le formulaire reste un
 * simple GET pour un navigateur sans JavaScript.
 */
export function RecherchePatients({ valeur }: { valeur: string }) {
  const router = useRouter()
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null)

  const chercher = (texte: string) =>
    router.replace(texte.length >= 2 ? `?q=${encodeURIComponent(texte)}` : '?', { scroll: false })

  return (
    <form
      method="get"
      role="search"
      // Entrée suit le même chemin que la frappe : sans quoi la page entière se rechargeait en coupant la
      // recherche déjà partie (Safari la journalisait en erreur).
      onSubmit={(e) => {
        e.preventDefault()
        if (minuterie.current) clearTimeout(minuterie.current)
        chercher(new FormData(e.currentTarget).get('q')?.toString().trim() ?? '')
      }}
      className="relative max-w-[40rem]"
    >
      <label htmlFor="q" className="sr-only">
        Rechercher un patient
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={valeur}
        autoFocus
        autoComplete="off"
        placeholder="Nom, prénom ou téléphone"
        onChange={(e) => {
          const texte = e.target.value.trim()
          if (minuterie.current) clearTimeout(minuterie.current)
          minuterie.current = setTimeout(() => chercher(texte), 250)
        }}
        className="champ h-14 rounded-full border-[#dde9e6] bg-white pl-12 text-[1.0625rem] focus-visible:border-[#387a70] focus-visible:shadow-[0_0_0_4px_rgb(15_138_124/0.12)]"
      />
    </form>
  )
}
