'use client'

import { heureCabinet } from '@/lib/dates'
import { badgeSite, couleurSite } from '@/lib/sites'
import { ESTOMPE, LIBELLE_STATUT, PASSE, TEINTE_STATUT } from '@/lib/statuts'
import { cn } from '@/lib/utils'

import type { RendezVousVue } from './grille-jour'
import { useFicheRendezVous, useStatutsAJour } from './panneau-rendez-vous'

/**
 * Déroulé de la journée : la même journée que la grille, dans l'ordre du temps.
 *
 * La grille est une mise en page — positions absolues, colonnes — que rien ne
 * restitue à un lecteur d'écran ; cette liste porte la même information dans
 * l'ordre, et c'est elle qui rend la vue conforme au RGAA. Chaque ligne ouvre
 * la fiche du rendez-vous, comme sa carte dans la grille : les gestes vivent
 * dans la fiche, plus sous chaque ligne.
 */
export function DerouleJour({
  rendezVous: rendezVousRecus,
  consolide = false,
}: {
  rendezVous: RendezVousVue[]
  consolide?: boolean
}) {
  const { ouvrir, selection } = useFicheRendezVous()
  const rendezVous = useStatutsAJour(rendezVousRecus)

  if (rendezVous.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun rendez-vous ce jour.</p>
  }

  return (
    <ol className="space-y-2.5 md:space-y-0 md:divide-y md:divide-[#eef2f2] md:border-y md:border-[#eef2f2]">
      {rendezVous.map((rdv) => {
        const estompe = ESTOMPE.includes(rdv.statut)
        const passe = PASSE.includes(rdv.statut)
        return (
          <li key={rdv.id}>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => ouvrir(rdv.id)}
              style={{ borderLeftColor: rdv.praticien.couleur }}
              className={cn(
                'grid w-full grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-2xl border border-l-4 border-[#e0ebe8] bg-white px-3 py-3 text-left text-[0.9375rem] hover:bg-[#f5f9f8] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[6.5rem_minmax(0,14rem)_minmax(0,1fr)_auto] md:rounded-none md:border-0 md:bg-transparent',
                selection === rdv.id && 'bg-[#f2f8f6]',
                (estompe || passe) && 'text-muted-foreground',
              )}
            >
              <span
                className={cn('chiffres font-heading font-bold md:font-sans md:font-normal', estompe && 'line-through')}
              >
                {heureCabinet(rdv.debut)}
                <span className="hidden sm:inline"> – {heureCabinet(rdv.fin)}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: rdv.praticien.couleur }}
                />
                <span className={cn('truncate font-medium', estompe && 'line-through')}>
                  {rdv.patient.prenom} {rdv.patient.nom}
                </span>
              </span>
              <span className="col-start-2 truncate text-sm text-muted-foreground sm:col-start-auto">
                {rdv.motif.libelle} · Dr {rdv.praticien.nom} · {rdv.fauteuil.nom}
                {consolide && rdv.site ? (
                  <span
                    className="ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white"
                    style={{ backgroundColor: couleurSite(rdv.site.code) }}
                  >
                    {badgeSite(rdv.site.code, rdv.site.nom)}
                    <span className="sr-only"> — {rdv.site.nom}</span>
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  'col-start-3 row-start-1 rounded-full px-2.5 py-0.5 text-[0.75rem] font-semibold whitespace-nowrap sm:col-start-auto sm:row-start-auto sm:text-[0.8125rem]',
                  TEINTE_STATUT[rdv.statut],
                )}
              >
                {LIBELLE_STATUT[rdv.statut]}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
