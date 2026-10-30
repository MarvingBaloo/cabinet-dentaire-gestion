'use client'

import type { StatutRendezVous } from '@prisma/client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { attributsCarte, useFicheRendezVous } from '@/components/features/agenda/panneau-rendez-vous'
import { cn } from '@/lib/utils'
import { COLONNES_LIGNE, ETAPE, ETAPES } from '@/lib/workflow'
import { changerStatutAction } from '@/server/actions/agenda'

// Un patient du Workflow, sur une ligne (direction B, Marving, 30/10) : son fil à cinq étapes montre où il en est, le
// bouton de droite le fait avancer d'une étape ; un clic ailleurs sur la ligne ouvre la fiche du rendez-vous.

const GESTE: Partial<Record<StatutRendezVous, { statut: StatutRendezVous; libelle: string }>> = {
  A_CONFIRMER: { statut: 'CONFIRME', libelle: 'Confirmer' },
  CONFIRME: { statut: 'SALLE_ATTENTE', libelle: 'Arrivé' },
  SALLE_ATTENTE: { statut: 'AU_FAUTEUIL', libelle: 'Au fauteuil' },
  AU_FAUTEUIL: { statut: 'TERMINE', libelle: 'Terminé' },
  TERMINE: { statut: 'EN_CAISSE', libelle: 'En caisse' },
}

export function LigneWorkflow({
  id,
  statut,
  couleur,
  heure,
  patient,
  detail,
  peutAgir,
}: {
  id: string
  statut: StatutRendezVous
  couleur: string
  heure: string
  patient: string
  detail: string
  peutAgir: boolean
}) {
  const { ouvrir, selection } = useFicheRendezVous()
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [erreur, setErreur] = useState<string | null>(null)
  const geste = peutAgir ? GESTE[statut] : undefined
  const etape = ETAPE[statut] ?? 0

  return (
    <li>
      <div
        {...attributsCarte(id, ouvrir)}
        onClick={() => ouvrir(id)}
        className={cn(
          'grid cursor-pointer grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 rounded-xl border border-[#e8efed] bg-white px-4 py-2 transition-[filter] hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          COLONNES_LIGNE,
          statut === 'EN_CAISSE' && 'opacity-55',
          selection === id && 'ring-2 ring-[#387a70]',
        )}
      >
        <span className="chiffres font-bold">{heure}</span>
        <span className="col-span-2 flex min-w-0 items-center gap-2.5 lg:col-span-1">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: couleur }} />
          <span className="min-w-0 truncate font-bold">{patient}</span>
          {statut === 'A_CONFIRMER' ? (
            <span className="shrink-0 text-[0.75rem] font-semibold text-etat-alerte">À confirmer</span>
          ) : null}
        </span>
        <span className="col-span-2 col-start-2 row-start-2 min-w-0 truncate text-[0.8125rem] text-muted-foreground lg:col-span-1 lg:col-start-auto lg:row-start-auto">
          {detail}
        </span>
        <Fil etape={etape} />
        <span className="col-start-3 row-start-3 text-right lg:col-start-auto lg:row-start-auto">
          {geste ? (
            <button
              type="button"
              disabled={enCours}
              onClick={(e) => {
                e.stopPropagation()
                setErreur(null)
                const donnees = new FormData()
                donnees.set('id', id)
                donnees.set('statut', geste.statut)
                demarrer(async () => {
                  const r = await changerStatutAction({}, donnees)
                  if (r.erreur) setErreur(r.erreur)
                  else router.refresh()
                })
              }}
              className="lien-action h-8 bouton-principal px-3.5 text-[0.8125rem] font-semibold whitespace-nowrap disabled:opacity-60"
            >
              {enCours ? '…' : geste.libelle}
            </button>
          ) : statut === 'ANNULATION_DEMANDEE' ? (
            <span className="text-[0.75rem] font-semibold whitespace-nowrap text-etat-erreur">Annulation demandée</span>
          ) : null}
        </span>
        {erreur ? (
          <p role="alert" className="col-span-full text-[0.8125rem] text-etat-erreur">
            {erreur}
          </p>
        ) : null}
      </div>
    </li>
  )
}

/** Cinq points reliés : pleins pour les étapes passées, cerclé pour l'étape en cours. */
function Fil({ etape }: { etape: number }) {
  return (
    <span className="col-span-2 row-start-3 flex items-center lg:col-span-1 lg:row-start-auto">
      <span className="sr-only">Étape : {ETAPES[etape]}</span>
      {ETAPES.map((libelle, i) => (
        <span key={libelle} aria-hidden className="relative flex flex-1 justify-center lg:w-[5.25rem] lg:flex-none">
          {i > 0 ? (
            <span
              className={cn(
                'absolute top-1/2 right-1/2 z-0 h-0.5 w-full -translate-y-1/2',
                i <= etape ? 'bg-[#387a70]' : 'bg-[#d9e3e0]',
              )}
            />
          ) : null}
          <span
            className={cn(
              'relative z-10 size-3.5 rounded-full border-2',
              i < etape && 'border-[#387a70] bg-[#387a70]',
              i === etape && 'border-4 border-[#387a70] bg-white',
              i > etape && 'border-[#d9e3e0] bg-white',
            )}
          />
        </span>
      ))}
      <span className="ml-2 shrink-0 text-[0.75rem] font-semibold lg:hidden">{ETAPES[etape]}</span>
    </span>
  )
}
