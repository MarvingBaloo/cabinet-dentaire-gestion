'use client'

import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { type PatientTrouve, rechercheRapideAction } from '@/server/actions/patients'

// « Chercher un patient » dans la barre du haut, sur tous les écrans (tour du
// 20/10). Un patient appelle : on tape trois lettres, on voit son prochain
// rendez-vous, Entrée l'ouvre dans l'agenda — 2 gestes au lieu de 4.

export function RechercheGlobale() {
  const router = useRouter()
  const champ = useRef<HTMLInputElement>(null)
  const [texte, setTexte] = useState('')
  const [resultats, setResultats] = useState<PatientTrouve[] | null>(null)
  const [actif, setActif] = useState(0)
  const [ouvert, setOuvert] = useState(false)

  // ⌘K / Ctrl K, depuis n'importe où dans l'espace du cabinet.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        champ.current?.focus()
      }
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [])

  useEffect(() => {
    if (texte.trim().length < 2) return
    let encore = true
    const minuterie = setTimeout(() => {
      void rechercheRapideAction(texte).then((r) => {
        if (!encore) return
        setResultats(r)
        setActif(0)
      })
    }, 200)
    return () => {
      encore = false
      clearTimeout(minuterie)
    }
  }, [texte])

  const liste = texte.trim().length >= 2 ? resultats : null

  function ouvrir(p: PatientTrouve) {
    setOuvert(false)
    setTexte('')
    setResultats(null)
    champ.current?.blur()
    router.push(
      p.prochain
        ? `/tableau-de-bord/agenda?vue=jour&date=${p.prochain.jour}&rdv=${p.prochain.id}`
        : `/tableau-de-bord/patients/${p.id}`,
    )
  }

  return (
    <div className="relative w-full max-w-[28rem]">
      <label htmlFor="recherche-globale" className="sr-only">
        Chercher un patient
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-4 size-[1.125rem] -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={champ}
        id="recherche-globale"
        type="search"
        autoComplete="off"
        role="combobox"
        aria-expanded={ouvert && !!liste}
        aria-controls="resultats-recherche"
        placeholder="Chercher un patient"
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value)
          setOuvert(true)
        }}
        onFocus={() => setOuvert(true)}
        onBlur={() => setTimeout(() => setOuvert(false), 150)}
        onKeyDown={(e) => {
          if (!liste?.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActif((a) => Math.min(a + 1, liste.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActif((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            ouvrir(liste[actif]!)
          } else if (e.key === 'Escape') {
            setOuvert(false)
          }
        }}
        className="champ h-10 rounded-full border-[#dde9e6] bg-white pr-14 pl-11 text-[0.9375rem] focus-visible:border-[#387a70] focus-visible:shadow-[0_0_0_4px_rgb(15_138_124/0.12)]"
      />
      {texte ? null : (
        <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-[#dde9e6] px-1.5 text-[0.6875rem] text-muted-foreground sm:block">
          ⌘K
        </kbd>
      )}

      {ouvert && liste ? (
        <div
          id="resultats-recherche"
          role="listbox"
          className="carte-douce absolute top-full right-0 left-0 z-50 mt-2 p-2 sm:right-auto sm:w-[34rem]"
        >
          {liste.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Aucun patient ne correspond à « {texte.trim()} ».</p>
          ) : (
            liste.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === actif}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActif(i)}
                onClick={() => ouvrir(p)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-[1.125rem] px-3 py-2.5 text-left',
                  i === actif && 'bg-[#f2f8f6]',
                )}
              >
                <span
                  aria-hidden
                  className="hexagone grid h-10 w-9 shrink-0 place-items-center bg-[#e4f1ee] font-heading text-[0.8125rem] font-extrabold text-[#387a70]"
                >
                  {p.nom
                    .split(' ')
                    .map((m) => m[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.nom}</span>
                  <span className="chiffres block text-[0.8125rem] text-muted-foreground">{p.telephone}</span>
                </span>
                <span
                  className={cn(
                    'shrink-0 text-right text-[0.8125rem]',
                    p.prochain ? 'font-semibold text-[#387a70]' : 'text-muted-foreground',
                  )}
                >
                  {p.prochain ? `Prochain : ${p.prochain.libelle}` : 'Aucun rendez-vous à venir'}
                </span>
              </button>
            ))
          )}
          <div className="mt-1 flex items-center justify-between border-t border-[#eef2f2] px-3 pt-2.5 pb-1 text-[0.75rem] text-muted-foreground">
            <span>↑↓ pour choisir · Entrée pour ouvrir</span>
            <a
              href={`/tableau-de-bord/agenda/nouveau?q=${encodeURIComponent(texte.trim())}`}
              className="font-semibold text-[#387a70] hover:underline"
            >
              + Nouveau rendez-vous
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
}
