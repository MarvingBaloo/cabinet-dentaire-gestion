'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

import {
  decalerJour,
  grilleMois,
  lundiDeSemaine,
  moisEnToutesLettres,
  moisPrecedent,
  moisSuivant,
  premierJourMois,
} from '@/lib/dates'
import { type ParametresLienAgenda, hrefAgenda } from '@/lib/url-agenda'
import { cn } from '@/lib/utils'

const INITIALES = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const DECALAGE: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

/**
 * Mini-calendrier du panneau du planning : un clic sur un jour affiche la vue
 * en cours (jour, semaine ou mois) à cette date. Seul le mois feuilleté est un
 * état local — la date affichée, elle, vient de l'URL.
 *
 * Au clavier (24/10), un seul arrêt de la touche Tab, sur le jour affiché, au lieu
 * des 42 jours l'un après l'autre : les flèches passent d'un jour à l'autre (le
 * mois suit), Entrée l'affiche.
 */
export function MiniCalendrier({
  vue,
  date,
  aujourdHui,
  lienBase,
}: {
  vue: 'jour' | 'semaine' | 'mois'
  date: string
  aujourdHui: string
  /** Paramètres conservés dans chaque lien (cabinet, exclusions…). */
  lienBase: ParametresLienAgenda
}) {
  const [mois, setMois] = useState(() => premierJourMois(date))
  const semaines = grilleMois(mois)
  const lundiAffiche = lundiDeSemaine(date)
  const titre = moisEnToutesLettres(mois)
  const [jourClavier, setJourClavier] = useState(date)
  const jours = semaines.flat()
  const arret = jours.includes(jourClavier) ? jourClavier : jours.includes(date) ? date : mois
  const section = useRef<HTMLElement>(null)
  const aFocaliser = useRef<string | null>(null)

  useEffect(() => {
    if (!aFocaliser.current) return
    section.current?.querySelector<HTMLElement>(`[data-jour="${aFocaliser.current}"]`)?.focus()
    aFocaliser.current = null
  })

  function surTouche(e: React.KeyboardEvent, jour: string) {
    const decalage = DECALAGE[e.key]
    if (decalage === undefined || e.altKey || e.metaKey || e.ctrlKey) return
    e.preventDefault()
    const suivant = decalerJour(jour, decalage)
    if (!jours.includes(suivant) || suivant.slice(0, 7) !== mois.slice(0, 7)) setMois(premierJourMois(suivant))
    setJourClavier(suivant)
    aFocaliser.current = suivant
  }

  return (
    <section ref={section} aria-label="Choisir une date">
      <div className="mb-3 flex items-center justify-between">
        <p aria-live="polite" className="font-heading text-[1.0625rem] font-medium">
          {titre.charAt(0).toUpperCase() + titre.slice(1)}
        </p>
        <div className="flex">
          <button
            type="button"
            aria-label="Mois précédent"
            onClick={() => setMois(moisPrecedent(mois))}
            className="flex size-8 items-center justify-center rounded-sm text-lg text-muted-foreground hover:bg-muted"
          >
            <span aria-hidden>‹</span>
          </button>
          <button
            type="button"
            aria-label="Mois suivant"
            onClick={() => setMois(moisSuivant(mois))}
            className="flex size-8 items-center justify-center rounded-sm text-lg text-muted-foreground hover:bg-muted"
          >
            <span aria-hidden>›</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground" aria-hidden>
        {INITIALES.map((l, i) => (
          <span key={i} className="py-1">
            {l}
          </span>
        ))}
      </div>
      {semaines.map((semaine) => (
        <div
          key={semaine[0]}
          className={cn(
            'grid grid-cols-7 text-center text-sm',
            vue !== 'mois' && semaine[0] === lundiAffiche && 'rounded-xl bg-[#e4f1ee]',
          )}
        >
          {semaine.map((jour, i) => {
            const horsMois = jour.slice(0, 7) !== mois.slice(0, 7)
            const choisi = vue !== 'mois' && jour === date
            return (
              <Link
                key={jour}
                href={hrefAgenda({ ...lienBase, vue, date: jour })}
                aria-label={`Afficher le ${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`}
                aria-current={jour === aujourdHui ? 'date' : undefined}
                data-jour={jour}
                tabIndex={jour === arret ? 0 : -1}
                onKeyDown={(e) => surTouche(e, jour)}
                className="group/jour flex justify-center py-1 focus-visible:outline-none"
              >
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-[0.625rem] tabular-nums hover:text-[#387a70]',
                    'group-focus-visible/jour:outline-2 group-focus-visible/jour:outline-offset-1 group-focus-visible/jour:outline-ring',
                    (horsMois || i === 6) && 'text-muted-foreground/60',
                    jour === aujourdHui && 'font-semibold text-[#387a70]',
                    choisi && 'choix-actif font-semibold text-white! hover:text-white',
                  )}
                >
                  {Number(jour.slice(8, 10))}
                </span>
              </Link>
            )
          })}
        </div>
      ))}
    </section>
  )
}
