'use client'

import { useActionState, useEffect, useRef } from 'react'

import { Message } from '@/components/ui/message'
import { changerTelephoneAction, type EtatTelephone } from '@/server/actions/comptes'

/**
 * « Changer le numéro » d'un compte (21/10) : téléphone changé, ou nouveau numéro après une réinitialisation. Sans
 * ce geste, un compte sans numéro ne pouvait plus recevoir de code de connexion, et seul un accès direct à la base
 * le débloquait.
 */
export function ChangerTelephone({ id, nom }: { id: string; nom: string }) {
  const [etat, action, enCours] = useActionState<EtatTelephone, FormData>(changerTelephoneAction, {})
  const fenetre = useRef<HTMLDetailsElement>(null)

  // Numéro enregistré : la fenêtre se referme d'elle-même. Restée ouverte, elle recouvrait « Désactiver », placé
  // sous ce bouton quand les gestes passent à la ligne.
  useEffect(() => {
    if (etat.succes && fenetre.current) fenetre.current.open = false
  }, [etat])

  return (
    <div className="flex flex-col items-end">
      <details ref={fenetre} className="relative">
        <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-full whitespace-nowrap border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8] [&::-webkit-details-marker]:hidden">
          Changer le numéro<span className="sr-only"> de {nom}</span>
        </summary>
        <form
          action={action}
          className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-2xl border border-border bg-background p-4 text-left whitespace-normal shadow-md"
        >
          <input type="hidden" name="id" value={id} />
          <label htmlFor={`telephone-${id}`} className="block text-sm font-medium">
            Nouveau mobile de {nom}
          </label>
          <input
            id={`telephone-${id}`}
            name="telephone"
            type="tel"
            required
            placeholder="06 90 12 34 56"
            defaultValue={etat.telephone}
            key={etat.telephone ?? ''}
            className="champ rounded-full"
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            Ses sessions ouvertes se ferment ; son prochain code part vers ce numéro.
          </p>
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
          <button type="submit" disabled={enCours} className="h-10 bouton-principal w-full text-sm font-semibold">
            {enCours ? 'Enregistrement…' : 'Enregistrer le numéro'}
          </button>
        </form>
      </details>
      {etat.succes ? (
        <p role="status" className="mt-1 text-[0.75rem] font-semibold text-etat-succes">
          Numéro enregistré
        </p>
      ) : null}
    </div>
  )
}
