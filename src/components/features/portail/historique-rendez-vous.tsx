import { StatutRendezVous } from '@prisma/client'
import { Check, X } from 'lucide-react'

import { cn } from '@/lib/utils'

// Les rendez-vous passés du patient, en lecture seule (19/10 ; mise en forme M3). Le vocabulaire est
// celui du patient, pas celui de l'accueil : « Effectué », pas « En caisse ».

type RendezVousPasse = {
  id: string
  debut: Date
  statut: StatutRendezVous
  site: { nom: string }
  motif: { libelle: string }
  praticien: { nom: string; prenom: string }
}

const date = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Guadeloupe',
})

const ISSUE: Partial<Record<StatutRendezVous, 'effectue' | 'absence' | 'annule'>> = {
  TERMINE: 'effectue',
  EN_CAISSE: 'effectue',
  ABSENT: 'absence',
  ANNULE: 'annule',
}

const PASTILLE = {
  effectue: { texte: 'Effectué', classe: 'bg-etat-succes-fond text-etat-succes' },
  absence: { texte: 'Absence', classe: 'bg-etat-erreur-fond text-etat-erreur' },
  annule: { texte: 'Annulé', classe: 'bg-muted text-muted-foreground' },
}

export function HistoriqueRendezVous({ rendezVous }: { rendezVous: RendezVousPasse[] }) {
  return (
    <section aria-labelledby="titre-historique" className="carte-douce px-6 py-7 sm:px-7">
      <h2 id="titre-historique" className="font-heading text-2xl font-bold">
        Mes rendez-vous passés
      </h2>
      {rendezVous.length === 0 ? (
        <p className="mt-3 text-muted-foreground">Aucun rendez-vous passé avec ce numéro.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#edf2f2]">
          {rendezVous.map((r) => {
            const issue = ISSUE[r.statut]
            return (
              <li key={r.id} className="flex items-center gap-3.5 py-3.5">
                <span
                  aria-hidden
                  className={cn(
                    'hexagone grid h-[2.4rem] w-[2.125rem] shrink-0 place-items-center',
                    issue === 'effectue'
                      ? 'bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white'
                      : issue === 'absence'
                        ? 'bg-etat-erreur-fond text-etat-erreur'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {issue === 'effectue' ? (
                    <Check className="size-4" strokeWidth={2} />
                  ) : issue ? (
                    <X className="size-4" strokeWidth={2} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{r.motif.libelle}</span>
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    {date.format(r.debut)} · Dr {r.praticien.prenom} {r.praticien.nom} · {r.site.nom}
                  </span>
                </span>
                {issue ? (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-3 py-1 text-[0.8125rem] font-semibold',
                      PASTILLE[issue].classe,
                    )}
                  >
                    {PASTILLE[issue].texte}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
