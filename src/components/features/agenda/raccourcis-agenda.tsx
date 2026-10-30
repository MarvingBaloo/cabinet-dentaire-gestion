'use client'

import { Keyboard, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

// Raccourcis clavier de l'agenda (24/10), à la manière de Google Agenda : changer de période, de vue, revenir à
// aujourd'hui, créer un rendez-vous, sans la souris. Ils se taisent pendant une saisie (champ, liste, zone de texte)
// et quand une touche a déjà été prise ailleurs — les flèches sur un rendez-vous le déplacent, celles du
// mini-calendrier changent de jour.

export type LiensRaccourcis = {
  precedent: string
  suivant: string
  aujourdHui: string
  jour: string
  semaine: string
  mois: string
  nouveau: string
}

const AIDE: { touches: string[]; quoi: string }[] = [
  { touches: ['←', '→'], quoi: 'Période précédente, suivante' },
  { touches: ['T'], quoi: 'Aujourd’hui' },
  { touches: ['J'], quoi: 'Vue jour' },
  { touches: ['S'], quoi: 'Vue semaine' },
  { touches: ['M'], quoi: 'Vue mois' },
  { touches: ['N'], quoi: 'Nouveau rendez-vous' },
  { touches: ['Tab'], quoi: 'Passer d’un rendez-vous à l’autre' },
  { touches: ['Entrée'], quoi: 'Ouvrir ou fermer la fiche du rendez-vous' },
  { touches: ['↑', '↓', '←', '→'], quoi: 'Sur un rendez-vous : le déplacer (Entrée valide, Échap annule)' },
  { touches: ['Maj', '↑', '↓'], quoi: 'Sur un rendez-vous : raccourcir, allonger' },
  { touches: ['?'], quoi: 'Cette aide' },
]

function enSaisie(cible: EventTarget | null) {
  return cible instanceof HTMLElement && Boolean(cible.closest('input, textarea, select, [contenteditable="true"]'))
}

export function RaccourcisAgenda({ liens }: { liens: LiensRaccourcis }) {
  const router = useRouter()
  const aide = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    function surTouche(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.isComposing || enSaisie(e.target)) return
      if (aide.current?.open) return
      if (e.key === '?') {
        e.preventDefault()
        aide.current?.showModal()
        return
      }
      const cible: Record<string, string> = {
        ArrowLeft: liens.precedent,
        ArrowRight: liens.suivant,
        t: liens.aujourdHui,
        j: liens.jour,
        s: liens.semaine,
        m: liens.mois,
        n: liens.nouveau,
      }
      const href = cible[e.key.length === 1 ? e.key.toLowerCase() : e.key]
      if (!href) return
      e.preventDefault()
      router.push(href, { scroll: false })
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [liens, router])

  return (
    <>
      <button
        type="button"
        onClick={() => aide.current?.showModal()}
        aria-keyshortcuts="?"
        title="Raccourcis clavier (?)"
        className="hidden size-10 place-items-center rounded-full border border-[#dde9e6] bg-white text-muted-foreground hover:bg-[#f5f9f8] hover:text-foreground md:grid"
      >
        <Keyboard aria-hidden className="size-5" />
        <span className="sr-only">Raccourcis clavier</span>
      </button>

      <dialog
        ref={aide}
        aria-labelledby="titre-raccourcis"
        // Échap ferme l'aide, et elle seule : la fiche d'un rendez-vous ouverte derrière reste ouverte.
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          aide.current?.close()
        }}
        onClick={(e) => e.target === aide.current && aide.current?.close()}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-3xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-encre/30"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="titre-raccourcis" className="font-heading text-lg font-semibold">
            Raccourcis clavier
          </h2>
          <button
            type="button"
            onClick={() => aide.current?.close()}
            className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X aria-hidden className="size-5" />
            <span className="sr-only">Fermer</span>
          </button>
        </div>
        <dl className="space-y-3 px-6 py-5 text-sm">
          {AIDE.map((a) => (
            <div key={a.quoi} className="grid grid-cols-[8.5rem_1fr] items-baseline gap-4">
              <dt className="flex flex-wrap gap-1">
                {a.touches.map((t, i) => (
                  <kbd
                    key={i}
                    className="min-w-7 rounded-lg border border-border bg-[#f5f9f8] px-1.5 py-0.5 text-center font-sans text-xs font-semibold"
                  >
                    {t}
                  </kbd>
                ))}
              </dt>
              <dd className="text-muted-foreground">{a.quoi}</dd>
            </div>
          ))}
        </dl>
      </dialog>
    </>
  )
}
