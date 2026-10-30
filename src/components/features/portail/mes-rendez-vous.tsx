'use client'

import { useActionState, useState } from 'react'

import { PanneauDeplacement } from '@/components/features/portail/deplacer-rendez-vous'
import { EtatVide } from '@/components/ui/etat-vide'
import { Message } from '@/components/ui/message'
import { heureCabinet } from '@/lib/dates'
import { construireIcs, identifiantEvenement, nomFichierIcs } from '@/lib/ics'
import { cn } from '@/lib/utils'
import { type EtatAnnulation, annulerParPatientAction } from '@/server/actions/acces-patient'

// L'état de l'annulation vit au niveau de la liste et non sur chaque bouton :
// annuler fait disparaître la carte, et un message porté par le bouton serait
// démonté à la seconde où il aurait quelque chose à dire.

type RendezVousPatient = {
  id: string
  debut: Date
  fin: Date
  /** L'adresse est `null` tant que le cabinet ne l'a pas donnée : on n'affiche
   *  alors que le nom du cabinet, jamais un texte de remplacement. */
  site: { nom: string; adresse: string | null }
  motif: { libelle: string }
  praticien: { nom: string; prenom: string }
  annulable: boolean
  /** Faux pour une demande d'annulation en attente (D17/D27) : ni annulable
   *  ni déplaçable tant que le praticien n'a pas tranché (D28). */
  deplacable: boolean
  /** Jours avant le rendez-vous, en dates du cabinet (calculé côté serveur). */
  dansJours: number
}

type Praticien = { id: string; nom: string; prenom: string }

const jourLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Guadeloupe',
})
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const boutonContour =
  'h-11 rounded-full border border-border bg-card px-5 text-[0.9375rem] font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-60'

/** Fabriqué au clic, jamais au rendu : c'est là qu'on a le droit de lire l'horloge. */
function telechargerIcs(debut: Date, fin: Date, motif: string, site: { nom: string; adresse: string | null }) {
  const ics = construireIcs({
    debut,
    fin,
    titre: `${motif} — ${site.nom}`,
    lieu: site.adresse ? `${site.nom} — ${site.adresse}` : site.nom,
    description: 'En cas d’empêchement, prévenez le cabinet au plus tôt.',
    uid: identifiantEvenement(),
    horodatage: new Date(),
  })
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichierIcs(debut)
  a.click()
  URL.revokeObjectURL(url)
}

export function MesRendezVous({
  rendezVous,
  praticiens,
}: {
  rendezVous: RendezVousPatient[]
  /** Pour nommer, dans la liste de déplacement, un praticien qui n'est pas
   *  forcément celui du rendez-vous d'origine (D28). */
  praticiens: Praticien[]
}) {
  const [etat, action, enCours] = useActionState<EtatAnnulation, FormData>(annulerParPatientAction, {})

  return (
    <div className="space-y-8">
      {etat.erreur ? (
        <Message ton="erreur" role="alert">
          {etat.erreur}
        </Message>
      ) : null}
      {etat.succes ? (
        <Message ton="succes" role="status">
          {etat.succes}
        </Message>
      ) : null}

      {rendezVous.length === 0 ? (
        <EtatVide
          variante="jamais-rempli"
          titre="Aucun rendez-vous à venir"
          texte="Vos prochains rendez-vous apparaîtront ici."
        />
      ) : (
        rendezVous.map((r, i) => (
          <CarteRendezVous
            key={r.id}
            r={r}
            premier={i === 0}
            praticiens={praticiens}
            action={action}
            enCours={enCours}
          />
        ))
      )}
    </div>
  )
}

function CarteRendezVous({
  r,
  premier,
  praticiens,
  action,
  enCours,
}: {
  r: RendezVousPatient
  premier: boolean
  praticiens: Praticien[]
  action: (donnees: FormData) => void
  enCours: boolean
}) {
  const [deplacer, setDeplacer] = useState(false)
  const [deplace, setDeplace] = useState<{ debut: string; fin: string } | null>(null)
  // Un toucher de trop ne doit pas annuler : la confirmation dit ce que coûte une annulation (21/10).
  const [confirmer, setConfirmer] = useState(false)
  const debut = deplace ? new Date(deplace.debut) : r.debut
  const fin = deplace ? new Date(deplace.fin) : r.fin
  const enAttente = !r.deplacable

  return (
    <div className="min-w-0 space-y-6">
      {/* M3 (19/10) : en-tête vert d'eau avec la date et le compte à rebours, actions en pilules. */}
      <article className="carte-douce overflow-hidden">
        <div
          className={cn(
            'flex items-center justify-between gap-5 px-6 py-5 sm:px-7',
            enAttente ? 'bg-etat-erreur-fond' : 'bg-[#edf6f3]',
          )}
        >
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
              {premier ? 'Prochain rendez-vous' : 'Rendez-vous'}
            </p>
            <h2 className="mt-1.5 font-heading text-[1.5rem] leading-tight font-extrabold sm:text-[1.75rem]">
              {majuscule(jourLong.format(debut))} · {heureCabinet(debut)}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {r.site.nom}
              {r.site.adresse ? `, ${r.site.adresse}` : null}
            </p>
          </div>
          {deplace ? null : (
            <p className="shrink-0 rounded-[1.125rem] bg-linear-to-br from-[#4f9a8f] to-[#387a70] px-4 py-2.5 text-center text-white">
              {r.dansJours <= 1 ? (
                <span className="block font-heading text-lg font-extrabold">
                  {r.dansJours <= 0 ? 'Aujourd’hui' : 'Demain'}
                </span>
              ) : (
                <>
                  <span className="block font-heading text-[1.625rem] leading-none font-extrabold">
                    J-{r.dansJours}
                  </span>
                  <span className="text-xs">dans {r.dansJours} jours</span>
                </>
              )}
            </p>
          )}
        </div>

        <div className="px-6 pt-5 pb-6 sm:px-7">
          <p className="font-semibold">{r.motif.libelle}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Dr {r.praticien.prenom} {r.praticien.nom}
          </p>

          {deplace ? (
            <Message ton="succes" role="status" className="mt-5">
              Rendez-vous déplacé au {jourLong.format(debut)} à {heureCabinet(debut)}.
            </Message>
          ) : null}

          {enAttente ? (
            // Une demande d'annulation de l'accueil est en attente du praticien
            // (D17/D27) : ni annulable ni déplaçable tant qu'elle n'est pas tranchée.
            <>
              <p className="mt-4 w-fit rounded-full bg-etat-erreur-fond px-3 py-1 text-[0.8125rem] font-medium text-etat-erreur">
                Annulation demandée
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Une annulation est en cours d’examen par le cabinet pour ce rendez-vous. Pour le déplacer, appelez le
                cabinet.
              </p>
            </>
          ) : (
            <>
              <div className="mt-5 flex flex-wrap gap-2.5">
                {deplace ? null : (
                  <button
                    type="button"
                    aria-expanded={deplacer}
                    onClick={() => setDeplacer((v) => !v)}
                    className="lien-action bouton-principal h-11 px-5 text-[0.9375rem]"
                  >
                    Déplacer
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => telechargerIcs(debut, fin, r.motif.libelle, r.site)}
                  className={boutonContour}
                >
                  Ajouter à mon agenda
                </button>
                {deplace || !r.annulable || confirmer ? null : (
                  <button
                    type="button"
                    onClick={() => setConfirmer(true)}
                    className="h-11 rounded-full border border-etat-erreur/30 bg-card px-5 text-[0.9375rem] font-medium text-etat-erreur hover:bg-etat-erreur-fond"
                  >
                    Annuler
                  </button>
                )}
              </div>
              {confirmer && !deplace && r.annulable ? (
                <div role="group" aria-labelledby={`confirmer-${r.id}`} className="mt-4 rounded-2xl border border-etat-erreur/30 bg-etat-erreur-fond px-5 py-4">
                  <p id={`confirmer-${r.id}`} className="font-semibold">
                    Annuler ce rendez-vous ?
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Une annulation compte comme une absence : au bout de trois, la réservation en ligne se ferme et il
                    faudra appeler le cabinet. Pour changer d’horaire sans rien perdre, déplacez-le plutôt.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    <form action={action}>
                      <input type="hidden" name="rendezVousId" value={r.id} />
                      <button
                        type="submit"
                        disabled={enCours}
                        className="h-11 rounded-full bg-etat-erreur px-5 text-[0.9375rem] font-semibold text-white disabled:pointer-events-none disabled:opacity-60"
                      >
                        {enCours ? 'Annulation…' : 'Oui, annuler'}
                      </button>
                    </form>
                    <button
                      type="button"
                      onClick={() => setConfirmer(false)}
                      className="h-11 rounded-full border border-border bg-card px-5 text-[0.9375rem] font-medium"
                    >
                      Garder mon rendez-vous
                    </button>
                  </div>
                </div>
              ) : null}
              {deplace || r.annulable ? null : (
                // Q28/D28 : sous 24 h, plus d'annulation en ligne — mais le
                // déplacement, lui, reste ouvert.
                <p className="mt-4 text-sm text-muted-foreground">
                  Dans moins de 24 heures : plus d’annulation en ligne, mais vous pouvez encore le déplacer.
                </p>
              )}
            </>
          )}
        </div>
      </article>

      {deplacer && !deplace ? (
        <PanneauDeplacement
          rendezVousId={r.id}
          praticienActuel={`${r.praticien.prenom} ${r.praticien.nom}`}
          praticiens={praticiens}
          onDeplace={(succes) => {
            setDeplace(succes)
            setDeplacer(false)
          }}
        />
      ) : null}
    </div>
  )
}
