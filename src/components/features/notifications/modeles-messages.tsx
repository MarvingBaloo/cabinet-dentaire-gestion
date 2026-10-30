'use client'

import { ArrowLeftRight, BellRing, CalendarCheck, CircleX, Hourglass, type LucideIcon } from 'lucide-react'
import { useActionState, useMemo, useRef, useState } from 'react'

import type { CanalNotification } from '@prisma/client'

import { Message } from '@/components/ui/message'
import {
  CHAMPS_DISPONIBLES,
  LIBELLE_CANAL,
  LIBELLE_EVENEMENT,
  TYPES_MODELISABLES,
  VALEURS_EXEMPLE,
  compterSegmentsSms,
  modeleParDefaut,
  rendreModele,
  validerModele,
  type TypeModelisable,
} from '@/lib/modeles-messages'
import { cn } from '@/lib/utils'
import {
  type EtatModeleMessage,
  enregistrerModeleMessageAction,
  reinitialiserModeleMessageAction,
} from '@/server/actions/modeles-messages'

// Écran de paramétrage des modèles de messages (lot 5a, maquette du 13/10) :
// les événements à gauche, le texte du (type, canal) choisi au centre, l'aperçu
// dans un téléphone à droite.
//
// L'aperçu et le compteur de segments tournent CÔTÉ CLIENT avec les mêmes
// fonctions pures que le serveur revalide à l'enregistrement
// (`src/lib/modeles-messages.ts`) : ce que l'écran promet pendant la saisie
// est exactement ce que le serveur acceptera ou refusera, jamais un aperçu
// optimiste suivi d'un refus surprise.

export type LigneModeleMessageVM = {
  type: TypeModelisable
  canal: CanalNotification
  sujet: string | null
  corps: string
  parDefaut: boolean
  modifieLe: string | null
}

const CANAUX: CanalNotification[] = ['SMS', 'EMAIL']

const ICONE: Record<TypeModelisable, LucideIcon> = {
  CONFIRMATION_RESERVATION: CalendarCheck,
  MODIFICATION_RENDEZ_VOUS: ArrowLeftRight,
  ANNULATION_PATIENT: CircleX,
  ANNULATION_CABINET: CircleX,
  RAPPEL_J2: BellRing,
  RAPPEL_H3: BellRing,
  CRENEAU_LIBERE: Hourglass,
}

export function ModelesMessages({ lignes }: { lignes: LigneModeleMessageVM[] }) {
  const [type, setType] = useState<TypeModelisable>(TYPES_MODELISABLES[0]!)
  const [canal, setCanal] = useState<CanalNotification>('SMS')
  const ligne = lignes.find((l) => l.type === type && l.canal === canal)

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
      <nav aria-label="Événements" className="carte-douce self-start p-2.5">
        <ul className="space-y-0.5">
          {TYPES_MODELISABLES.map((t) => {
            // « Modifié » se juge sur le texte, pas sur la présence d'une ligne
            // en base : un modèle enregistré tel quel reste le texte d'origine.
            const modifie = lignes.some((l) => {
              const defaut = modeleParDefaut(l.type, l.canal)
              return l.type === t && (l.corps.trim() !== defaut.corps || (l.sujet ?? null) !== defaut.sujet)
            })
            const choisi = t === type
            const Icone = ICONE[t]
            return (
              <li key={t} data-cible={modifie ? 'modele modifie' : 'modele'} className="rounded-2xl">
                <button
                  type="button"
                  aria-current={choisi ? 'true' : undefined}
                  onClick={() => setType(t)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[1.125rem] px-3 py-2.5 text-left transition-colors hover:bg-[#f5f9f8]',
                    choisi && 'bg-[#e4f1ee] hover:bg-[#e4f1ee]',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'hexagone grid h-[2.5rem] w-[2.25rem] shrink-0 place-items-center',
                      choisi
                        ? 'bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white'
                        : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    <Icone className="size-4" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0">
                    <span className={cn('block font-semibold', choisi && 'text-[#387a70]')}>
                      {LIBELLE_EVENEMENT[t]}
                    </span>
                    <span
                      className={cn(
                        'text-[0.8125rem]',
                        modifie ? 'font-medium text-[#387a70]' : 'text-muted-foreground',
                      )}
                    >
                      {modifie ? 'texte modifié' : 'texte par défaut'}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {ligne ? (
        // La clé remonte l'éditeur à chaque changement d'événement ou de canal :
        // le texte en cours, l'aperçu et le message du dernier enregistrement
        // appartiennent à UN (type, canal), jamais au suivant.
        <Editeur key={`${type}-${canal}`} ligne={ligne} canal={canal} onCanal={setCanal} />
      ) : null}
    </div>
  )
}

function Editeur({
  ligne,
  canal,
  onCanal,
}: {
  ligne: LigneModeleMessageVM
  canal: CanalNotification
  onCanal: (c: CanalNotification) => void
}) {
  // Contrôlés par l'état local, pas par `defaultValue` : la saisie survit
  // d'elle-même à un refus de l'action.
  const [corps, setCorps] = useState(ligne.corps)
  const [sujet, setSujet] = useState(ligne.sujet ?? '')
  const zone = useRef<HTMLTextAreaElement>(null)

  // Un seul état pour les deux boutons : le message affiché est celui du
  // dernier geste. « Revenir au texte par défaut » supprime la ligne en base ;
  // le texte affiché doit suivre, sinon l'écran montrerait encore l'ancien
  // texte sous « texte par défaut ».
  const [etat, action, enCours] = useActionState<EtatModeleMessage, FormData>(async (precedent, donnees) => {
    if (donnees.get('geste') !== 'defaut') return enregistrerModeleMessageAction(precedent, donnees)
    const resultat = await reinitialiserModeleMessageAction(precedent, donnees)
    if (resultat.succes) {
      const defaut = modeleParDefaut(ligne.type, ligne.canal)
      setCorps(defaut.corps)
      setSujet(defaut.sujet ?? '')
    }
    return resultat
  }, {})

  const estEmail = ligne.canal === 'EMAIL'
  const champs = CHAMPS_DISPONIBLES[ligne.type]
  const apercuCorps = useMemo(() => rendreModele(corps, VALEURS_EXEMPLE), [corps])
  const apercuSujet = useMemo(() => (sujet ? rendreModele(sujet, VALEURS_EXEMPLE) : ''), [sujet])
  const segments = useMemo(() => (estEmail ? null : compterSegmentsSms(apercuCorps)), [apercuCorps, estEmail])
  const verdict = useMemo(
    () => validerModele(ligne.type, ligne.canal, corps, estEmail ? sujet : null),
    [ligne.type, ligne.canal, corps, sujet, estEmail],
  )
  const attendReponse = champs.includes('consigne_reponse') && !estEmail
  const defaut = modeleParDefaut(ligne.type, ligne.canal)
  const differeDuDefaut = corps.trim() !== defaut.corps || (estEmail && sujet.trim() !== (defaut.sujet ?? ''))

  function inserer(nom: string) {
    const balise = `{${nom}}`
    const champ = zone.current
    if (!champ) return setCorps((c) => c + balise)
    const debut = champ.selectionStart
    setCorps(corps.slice(0, debut) + balise + corps.slice(champ.selectionEnd))
    requestAnimationFrame(() => {
      champ.focus()
      champ.setSelectionRange(debut + balise.length, debut + balise.length)
    })
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="carte-douce min-w-0 space-y-6 px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-heading text-[1.5rem] leading-tight font-bold">{LIBELLE_EVENEMENT[ligne.type]}</h2>

          <div role="group" aria-label="Canal" className="inline-flex rounded-full bg-secondary p-1">
            {CANAUX.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={c === canal}
                onClick={() => onCanal(c)}
                className={cn(
                  'h-9 min-w-[5.5rem] rounded-full px-5 text-sm',
                  c === canal ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {LIBELLE_CANAL[c]}
              </button>
            ))}
          </div>
        </div>

        <form action={action} className="space-y-6">
          <input type="hidden" name="type" value={ligne.type} />
          <input type="hidden" name="canal" value={ligne.canal} />

          {estEmail ? (
            <div className="space-y-2">
              <label htmlFor="sujet" className="block text-sm font-medium">
                Sujet
              </label>
              <input
                id="sujet"
                name="sujet"
                type="text"
                value={sujet}
                onChange={(e) => setSujet(e.target.value)}
                className="champ rounded-full"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="corps" className="block text-sm font-medium">
              Texte du message
            </label>
            <textarea
              ref={zone}
              id="corps"
              name="corps"
              value={corps}
              onChange={(e) => setCorps(e.target.value)}
              rows={estEmail ? 9 : 5}
              aria-describedby="compteur-modele verdict-modele"
              className="champ min-h-36 rounded-[1.25rem] px-4 py-3"
            />
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
              <div className="space-y-2">
                <p className="text-[0.8125rem] text-muted-foreground">Insérer :</p>
                <div className="flex flex-wrap gap-2">
                  {champs.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => inserer(c)}
                      className="rounded-full bg-[#e4f1ee] px-2.5 py-1 font-mono text-[0.8125rem] text-[#387a70] hover:bg-[#d2ece6]"
                    >{`{${c}}`}</button>
                  ))}
                </div>
              </div>
              <p id="compteur-modele" className="text-[0.8125rem] text-muted-foreground">
                {segments
                  ? `≈ ${segments.longueur} / ${segments.encodage === 'GSM-7' ? 160 : 70} caractères · ${segments.segments} SMS`
                  : `${corps.length} caractères`}
              </p>
            </div>
          </div>

          <p className="text-[0.8125rem] text-muted-foreground">
            Jamais le motif ni le nom du soin dans un message : un SMS se lit sur un écran verrouillé.
          </p>

          <div id="verdict-modele">
            {!verdict.ok ? (
              <Message ton="erreur" role="alert">
                {verdict.erreur}
              </Message>
            ) : verdict.avertissement ? (
              <Message ton="alerte">{verdict.avertissement}</Message>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={enCours || !verdict.ok}
              className="h-11 bouton-principal px-5 font-semibold disabled:pointer-events-none disabled:opacity-60"
            >
              Enregistrer
            </button>
            {differeDuDefaut ? (
              <button
                type="submit"
                name="geste"
                value="defaut"
                disabled={enCours}
                className="h-11 rounded-full border border-[#dde9e6] bg-white px-5 font-semibold hover:bg-[#f5f9f8] disabled:pointer-events-none disabled:opacity-60"
              >
                Revenir au texte par défaut
              </button>
            ) : null}
          </div>

          {etat.erreur ? (
            <Message ton="erreur" role="alert">
              {etat.erreur}
            </Message>
          ) : etat.succes ? (
            <Message ton="succes" role="status">
              {etat.succes}
              {etat.avertissement ? <span className="block">{etat.avertissement}</span> : null}
            </Message>
          ) : null}
        </form>
      </div>

      <aside aria-label="Aperçu" className="w-full max-w-[20rem] space-y-3 xl:max-w-none">
        <p className="text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase">
          Aperçu · valeurs d’exemple
        </p>
        <div
          aria-live="polite"
          className="min-h-[26rem] rounded-[2.25rem] border-8 border-[#24332f] bg-[#eef4f3] px-5 pt-6 pb-8"
        >
          {estEmail ? (
            <div className="rounded-2xl bg-white p-4 text-[0.875rem] shadow-sm">
              <p className="text-xs text-muted-foreground">Cabinet dentaire</p>
              <p className="mt-1 font-semibold">{apercuSujet || '(sans sujet)'}</p>
              <p className="mt-3 whitespace-pre-wrap">{apercuCorps}</p>
            </div>
          ) : (
            <>
              <p className="text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Cabinet dentaire
              </p>
              <p className="mt-1 text-center text-xs text-muted-foreground/80">Aujourd’hui 10:20</p>
              <p className="mt-5 max-w-[92%] rounded-[1.375rem] rounded-bl-md bg-white px-4 py-3 text-[0.875rem] whitespace-pre-wrap shadow-sm">
                {apercuCorps}
              </p>
              {attendReponse ? (
                <>
                  <p className="mt-4 ml-auto w-fit bouton-principal px-5 py-2 text-sm font-semibold">OUI</p>
                  <p className="mt-5 text-[0.8125rem] text-muted-foreground">
                    OUI confirme le rendez-vous. NON l’annule jusqu’à 24 h avant ; au-delà, le patient est invité à
                    appeler le cabinet.
                  </p>
                </>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
