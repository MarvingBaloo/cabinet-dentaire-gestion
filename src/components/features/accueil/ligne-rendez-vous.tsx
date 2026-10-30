'use client'

import type { StatutRendezVous } from '@prisma/client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { attributsCarte, useFicheRendezVous } from '@/components/features/agenda/panneau-rendez-vous'
import { cn } from '@/lib/utils'
import { changerStatutAction } from '@/server/actions/agenda'

// Une ligne de « Prochains rendez-vous » (tour de l'application du 20/10) : le
// geste suivant du parcours en un clic, sans passer par l'agenda ; un clic
// ailleurs sur la ligne ouvre la fiche du rendez-vous par-dessus l'Accueil.

/** Le geste suivant, en un mot : la ligne est courte, la fiche garde les libellés longs. */
const GESTE: Partial<Record<StatutRendezVous, { statut: StatutRendezVous; libelle: string }>> = {
  A_CONFIRMER: { statut: 'CONFIRME', libelle: 'Confirmer' },
  CONFIRME: { statut: 'SALLE_ATTENTE', libelle: 'Arrivé' },
  SALLE_ATTENTE: { statut: 'AU_FAUTEUIL', libelle: 'Au fauteuil' },
  AU_FAUTEUIL: { statut: 'TERMINE', libelle: 'Terminé' },
}

export function LigneRendezVous({
  id,
  statut,
  couleur,
  heure,
  children,
}: {
  id: string
  statut: StatutRendezVous
  couleur: string
  heure: string
  children: React.ReactNode
}) {
  const { ouvrir, selection } = useFicheRendezVous()
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [erreur, setErreur] = useState<string | null>(null)
  const geste = GESTE[statut]

  return (
    <li className="flex items-center gap-3 sm:gap-5">
      <span className="chiffres w-12 shrink-0 font-heading text-lg font-bold sm:w-14 sm:text-xl">{heure}</span>
      <div
        {...attributsCarte(id, ouvrir)}
        onClick={() => ouvrir(id)}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-2xl border-l-4 px-4 py-3 transition-[filter] hover:brightness-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          selection === id && 'ring-2 ring-[#387a70]',
        )}
        style={{ borderColor: couleur, backgroundColor: `color-mix(in oklch, ${couleur} 7%, white)` }}
      >
        {children}
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
            className="lien-action h-9 shrink-0 bouton-principal px-4 text-[0.8125rem] font-semibold disabled:opacity-60"
          >
            {enCours ? '…' : geste.libelle}
          </button>
        ) : null}
        {erreur ? (
          <p role="alert" className="w-full text-[0.8125rem] text-etat-erreur">
            {erreur}
          </p>
        ) : null}
      </div>
    </li>
  )
}
