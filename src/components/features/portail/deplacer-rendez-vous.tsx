'use client'

import { startTransition, useActionState, useEffect, useMemo, useState } from 'react'

import { Message } from '@/components/ui/message'
import { heureCabinet, jourLocal } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
  type EtatCreneauxDeplacement,
  type EtatDeplacement,
  creneauxDeplacementAction,
  deplacerParPatientAction,
} from '@/server/actions/acces-patient'

// Déplacement d'un rendez-vous depuis l'accès patient (D28) : la carte ouvre ce
// panneau, qui charge aussitôt les créneaux. Pas de code à saisir ici — le jeton
// de la fenêtre ouverte (D23) a déjà authentifié ce numéro.
//
// Tour de l'application du 20/10 : la liste était coupée aux 30 premiers
// créneaux, tous du même jour, et renvoyait au téléphone pour les autres. Les
// créneaux sont désormais rangés par jour : une rangée de jours, puis les heures
// du jour choisi, puis une confirmation.

const jourCourt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'America/Guadeloupe' })
const quantieme = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: 'America/Guadeloupe' })
const jourLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Guadeloupe',
})
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

type Praticien = { id: string; nom: string; prenom: string }
type Creneau = { debut: string; fin: string; praticienId: string }

export function PanneauDeplacement({
  rendezVousId,
  praticienActuel,
  praticiens,
  onDeplace,
}: {
  rendezVousId: string
  /** « Prénom Nom » du praticien du rendez-vous : un autre praticien est nommé, pas celui-ci. */
  praticienActuel: string
  praticiens: Praticien[]
  onDeplace: (succes: { debut: string; fin: string }) => void
}) {
  const [etatListe, actionListe, enChargement] = useActionState<EtatCreneauxDeplacement, FormData>(
    creneauxDeplacementAction,
    {},
  )
  const [etatDeplacement, actionDeplacer, enCours] = useActionState<EtatDeplacement, FormData>(
    async (precedent, donnees) => {
      const resultat = await deplacerParPatientAction(precedent, donnees)
      if (resultat.succes) onDeplace(resultat.succes)
      return resultat
    },
    {},
  )
  const [jourChoisi, setJourChoisi] = useState<string | null>(null)
  const [choix, setChoix] = useState<Creneau | null>(null)

  // Ouvrir le panneau, c'est demander les créneaux : pas de second bouton.
  useEffect(() => {
    const donnees = new FormData()
    donnees.set('rendezVousId', rendezVousId)
    startTransition(() => actionListe(donnees))
  }, [rendezVousId, actionListe])

  const parJour = useMemo(() => {
    const m = new Map<string, Creneau[]>()
    for (const c of etatListe.creneaux ?? []) {
      const j = jourLocal(new Date(c.debut))
      m.set(j, [...(m.get(j) ?? []), c])
    }
    return [...m]
  }, [etatListe.creneaux])
  const jour = jourChoisi ?? parJour[0]?.[0] ?? null
  const duJour = parJour.find(([j]) => j === jour)?.[1] ?? []
  const matin = duJour.filter((c) => Number(heureCabinet(new Date(c.debut)).slice(0, 2)) < 12)
  const apresMidi = duJour.filter((c) => Number(heureCabinet(new Date(c.debut)).slice(0, 2)) >= 12)

  const nomAutre = (id: string) => {
    const p = praticiens.find((pr) => pr.id === id)
    const nom = p ? `${p.prenom} ${p.nom}` : null
    return nom && nom !== praticienActuel ? `Dr ${nom}` : null
  }

  const heures = (liste: Creneau[], titre: string) =>
    liste.length ? (
      <div className="mt-4">
        <p className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">{titre}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {liste.map((c) => {
            const actif = choix?.debut === c.debut && choix.praticienId === c.praticienId
            return (
              <button
                key={`${c.praticienId}-${c.debut}`}
                type="button"
                aria-pressed={actif}
                onClick={() => setChoix(c)}
                className={cn(
                  'chiffres rounded-full border px-2 py-2.5 text-[0.9375rem] font-medium',
                  actif ? 'choix-actif' : 'border-[#dde9e6] bg-white text-[#387a70] hover:border-[#387a70]',
                )}
              >
                {heureCabinet(new Date(c.debut))}
                {nomAutre(c.praticienId) ? (
                  <span className={cn('block text-[0.6875rem]', actif ? 'text-white/85' : 'text-muted-foreground')}>
                    {nomAutre(c.praticienId)}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    ) : null

  return (
    <div className="carte-douce min-w-0 px-5 py-6 sm:px-8">
      <p className="font-heading text-lg font-bold">Choisissez un jour</p>

      {etatListe.erreur ? (
        <Message ton="erreur" role="alert" className="mt-4">
          {etatListe.erreur}
        </Message>
      ) : null}
      {etatDeplacement.erreur ? (
        <Message ton="erreur" role="alert" className="mt-4">
          {etatDeplacement.erreur}
        </Message>
      ) : null}

      {enChargement && !etatListe.creneaux ? (
        <p className="mt-4 text-sm text-muted-foreground">Recherche des créneaux…</p>
      ) : etatListe.creneaux && etatListe.creneaux.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Aucun créneau libre dans les deux prochains mois : appelez le cabinet.
        </p>
      ) : jour ? (
        <>
          <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-2">
            {parJour.map(([j, liste]) => {
              const d = new Date(liste[0]!.debut)
              const actif = j === jour
              return (
                <button
                  key={j}
                  type="button"
                  aria-pressed={actif}
                  onClick={() => {
                    setJourChoisi(j)
                    setChoix(null)
                  }}
                  className={cn(
                    'w-[4.25rem] shrink-0 rounded-[1.125rem] border py-2.5 text-center',
                    actif ? 'choix-actif' : 'border-[#dde9e6] bg-white hover:border-[#387a70]',
                  )}
                >
                  <span className="block text-xs">{jourCourt.format(d)}</span>
                  <span className="block font-heading text-xl font-extrabold">{quantieme.format(d)}</span>
                  <span className={cn('block text-[0.6875rem]', actif ? 'text-white/85' : 'text-muted-foreground')}>
                    {liste.length} libre{liste.length > 1 ? 's' : ''}
                  </span>
                </button>
              )
            })}
          </div>

          <p className="mt-4 font-semibold">{majuscule(jourLong.format(new Date(duJour[0]!.debut)))}</p>
          {heures(matin, 'Matin')}
          {heures(apresMidi, 'Après-midi')}

          {choix ? (
            <form action={actionDeplacer} className="mt-6 rounded-[1.375rem] bg-[#f2f8f6] px-5 py-4">
              <input type="hidden" name="rendezVousId" value={rendezVousId} />
              <input type="hidden" name="nouveauDebut" value={choix.debut} />
              <input type="hidden" name="nouveauPraticienId" value={choix.praticienId} />
              <p className="font-semibold">
                {majuscule(jourLong.format(new Date(choix.debut)))} à {heureCabinet(new Date(choix.debut))}
              </p>
              {nomAutre(choix.praticienId) ? (
                <p className="text-sm text-muted-foreground">avec le {nomAutre(choix.praticienId)}</p>
              ) : null}
              <button
                type="submit"
                disabled={enCours}
                className="mt-3 h-12 w-full bouton-principal text-[0.9375rem] font-semibold disabled:opacity-60 sm:w-auto sm:px-6"
              >
                {enCours ? 'Déplacement…' : 'Confirmer le déplacement'}
              </button>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
