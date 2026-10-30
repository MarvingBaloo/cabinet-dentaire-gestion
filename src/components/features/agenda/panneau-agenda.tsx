'use client'

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { StatutRendezVous } from '@prisma/client'

import { couleurLisibleSurBlanc } from '@/lib/couleurs'
import { LIBELLE_STATUT, PARCOURS } from '@/lib/statuts'
import { COOKIE_PANNEAU_REPLIE, type ParametresLienAgenda, hrefAgenda } from '@/lib/url-agenda'
import { cn } from '@/lib/utils'

import { MiniCalendrier } from './mini-calendrier'

// Panneau de gauche du planning (maquettes du 13/10), commun aux vues jour,
// semaine et mois. Chaque changement passe par l'URL (lien partageable, retour
// arrière) ; les filtres sont appliqués par la DAL — ce panneau ne fait que les
// demander. Les cases sont non contrôlées, remontées par `key` quand l'URL change.

const STATUTS: StatutRendezVous[] = [...PARCOURS, 'ANNULATION_DEMANDEE']

const TITRE = 'text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase'

export function PanneauAgenda({
  vue,
  date,
  aujourdHui,
  sousTitre,
  cabinets,
  siteCourant,
  consolideDisponible,
  praticienHistorique,
  praticiens,
  motifs,
  praticiensExclus,
  motifsExclus,
  statutsExclus,
  marquerTousPraticiens,
  notes,
  replieInitial,
}: {
  vue: 'jour' | 'semaine' | 'mois'
  date: string
  aujourdHui: string
  sousTitre: string
  cabinets: { id: string; nom: string }[]
  /** Identifiant du cabinet affiché, ou `'tous'` pour la vue consolidée. */
  siteCourant: string
  consolideDisponible: boolean
  praticienHistorique: string | null
  praticiens: { id: string; nom: string; prenom: string; couleur: string; nombre: number }[]
  motifs: { id: string; libelle: string; couleur: string }[]
  praticiensExclus: string[]
  motifsExclus: string[]
  statutsExclus: StatutRendezVous[]
  /** Vrai pour un praticien : tout cocher doit se dire explicitement, sinon il
   *  retombe sur ses seuls rendez-vous. */
  marquerTousPraticiens: boolean
  notes: React.ReactNode
  /** À l'ordinateur, le panneau se replie pour laisser toute la largeur au planning (Marving, 29/10). */
  replieInitial: boolean
}) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [ouvert, setOuvert] = useState(false)
  const [replie, setReplie] = useState(replieInitial)

  function basculerReplie() {
    const suivant = !replie
    setReplie(suivant)
    document.cookie = suivant
      ? `${COOKIE_PANNEAU_REPLIE}=1; path=/; max-age=31536000; samesite=lax`
      : `${COOKIE_PANNEAU_REPLIE}=; path=/; max-age=0; samesite=lax`
  }
  const idPanneau = useId()

  const base: ParametresLienAgenda = {
    vue,
    date,
    site: siteCourant,
    praticien: praticienHistorique ?? undefined,
    sansPraticien: praticiensExclus,
    sansMotif: motifsExclus,
    sansStatut: statutsExclus,
    tousPraticiens: marquerTousPraticiens && praticiensExclus.length === 0,
  }

  function appliquer(form: HTMLFormElement) {
    const f = new FormData(form)
    const exclus = (nom: string, tous: string[]) => {
      const coches = new Set(f.getAll(nom).map(String))
      return tous.filter((v) => !coches.has(v))
    }
    const sansPraticien = exclus(
      'praticien',
      praticiens.map((p) => p.id),
    )
    const href = hrefAgenda({
      ...base,
      sansPraticien,
      sansMotif: exclus(
        'motif',
        motifs.map((m) => m.id),
      ),
      sansStatut: exclus('statut', STATUTS),
      tousPraticiens: marquerTousPraticiens && sansPraticien.length === 0,
    })
    demarrer(() => router.push(href, { scroll: false }))
  }

  const cle = [siteCourant, ...praticiensExclus, '|', ...motifsExclus, '|', ...statutsExclus].join(',')
  const cabinetsAffiches = [
    ...cabinets.map((c) => ({ id: c.id, nom: c.nom.replace(/^Cabinet (de |d’|d')/, '') })),
    ...(consolideDisponible && cabinets.length > 1 ? [{ id: 'tous', nom: 'Les deux' }] : []),
  ]

  return (
    <aside
      aria-label="Agenda : période, cabinet et filtres"
      className={cn(
        'relative border-b border-border bg-[#f5f9f8] px-4 py-3 lg:shrink-0 lg:border-b-0 lg:py-10',
        replie ? 'lg:w-[3.75rem] lg:px-2' : 'lg:w-[18.75rem] lg:px-7',
      )}
    >
      <button
        type="button"
        onClick={basculerReplie}
        aria-expanded={!replie}
        aria-controls={idPanneau}
        title={replie ? 'Afficher le calendrier et les filtres' : 'Masquer le calendrier et les filtres'}
        className={cn(
          'hidden size-9 place-items-center rounded-full text-[#387a70] hover:bg-[#e4f1ee] lg:grid',
          replie ? 'mx-auto' : 'absolute top-9 right-4',
        )}
      >
        {replie ? (
          <PanelLeftOpen aria-hidden className="size-5" strokeWidth={1.8} />
        ) : (
          <PanelLeftClose aria-hidden className="size-5" strokeWidth={1.8} />
        )}
        <span className="sr-only">
          {replie ? 'Afficher le calendrier et les filtres' : 'Masquer le calendrier et les filtres'}
        </span>
      </button>

      {/* Sur téléphone, le titre redirait ce que l'en-tête de la journée dit déjà (tour du 20/10). */}
      <h1
        className={cn(
          'sr-only font-heading text-[length:var(--texte-titre-3)] leading-none font-bold',
          !replie && 'lg:not-sr-only',
        )}
      >
        Agenda
      </h1>
      <p className={cn('mt-2 hidden text-sm text-muted-foreground', !replie && 'lg:block')}>{sousTitre}</p>

      <button
        type="button"
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        onClick={() => setOuvert((o) => !o)}
        className="inline-flex h-9 items-center rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8] lg:hidden"
      >
        Calendrier et filtres
      </button>

      <div
        id={idPanneau}
        aria-busy={enCours}
        className={cn('mt-8 space-y-9', ouvert ? 'block' : 'hidden', replie ? 'lg:hidden' : 'lg:block')}
      >
        <MiniCalendrier vue={vue} date={date} aujourdHui={aujourdHui} lienBase={base} />

        {cabinetsAffiches.length > 1 ? (
          <section aria-label="Cabinet">
            <p className={TITRE}>Cabinet</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {cabinetsAffiches.map((c) => (
                <Link
                  key={c.id}
                  href={hrefAgenda({ ...base, site: c.id })}
                  aria-current={c.id === siteCourant ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-10 items-center rounded-full border px-4 text-sm',
                    c.id === siteCourant
                      ? 'choix-actif font-medium'
                      : 'border-border bg-background text-foreground hover:border-[#387a70]',
                  )}
                >
                  {c.nom}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <form key={cle} onChange={(e) => appliquer(e.currentTarget)} className="space-y-9 text-sm">
          <fieldset>
            <legend className={TITRE}>Praticiens</legend>
            <div className="mt-3 space-y-3">
              {praticiens.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    name="praticien"
                    value={p.id}
                    defaultChecked={!praticiensExclus.includes(p.id)}
                    className="mt-0.5 size-[1.125rem] shrink-0"
                    style={{ accentColor: couleurLisibleSurBlanc(p.couleur) }}
                  />
                  <span>
                    <span className="block text-[0.9375rem] font-medium">
                      Dr {p.prenom} {p.nom}
                    </span>
                    <span className="block text-[0.8125rem] text-muted-foreground">{p.nombre} rendez-vous</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <details className="group" open={motifsExclus.length > 0 || statutsExclus.length > 0}>
            <summary className={cn(TITRE, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
              Actes et statuts{' '}
              <span aria-hidden className="ml-1 inline-block group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="mt-3 space-y-6">
              <fieldset className="space-y-2">
                <legend className="mb-1 text-[0.8125rem] font-medium">Actes</legend>
                {motifs.map((m) => (
                  <label key={m.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="motif"
                      value={m.id}
                      defaultChecked={!motifsExclus.includes(m.id)}
                      className="size-4"
                      style={{ accentColor: couleurLisibleSurBlanc(m.couleur) }}
                    />
                    {m.libelle}
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-[0.8125rem] font-medium">Statuts</legend>
                {STATUTS.map((s) => (
                  <label key={s} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="statut"
                      value={s}
                      defaultChecked={!statutsExclus.includes(s)}
                      className="size-4 accent-primary"
                    />
                    {LIBELLE_STATUT[s]}
                  </label>
                ))}
              </fieldset>
            </div>
          </details>
        </form>

        <section aria-label="Notes du jour">
          <p className={TITRE}>Notes du jour</p>
          <div className="mt-3">{notes}</div>
        </section>
      </div>
    </aside>
  )
}
