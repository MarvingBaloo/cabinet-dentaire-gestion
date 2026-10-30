'use client'

import { useActionState } from 'react'

import { Message } from '@/components/ui/message'
import { type EtatReponseTelephone, repondreDepuisTelephoneAction } from '@/server/actions/auth'

export function RepondreTelephone({ jeton, personne, poste }: { jeton: string; personne: string; poste: string }) {
  const [etat, repondre, enCours] = useActionState<EtatReponseTelephone, FormData>(repondreDepuisTelephoneAction, {})

  if (etat.etat === 'acceptee') {
    return (
      <Message ton="succes" role="status">
        C’est fait : le poste s’ouvre. Vous pouvez ranger votre téléphone.
      </Message>
    )
  }
  if (etat.etat === 'refusee') {
    return (
      <Message ton="alerte" role="status">
        Connexion refusée : le poste reste fermé. Si ce n’était pas vous, prévenez l’administrateur du cabinet.
      </Message>
    )
  }

  return (
    <form action={repondre} className="space-y-5">
      <input type="hidden" name="jeton" value={jeton} />
      {etat.etat === 'perimee' ? (
        <Message ton="alerte" role="alert">
          Ce QR code n’est plus valable. Sur le poste, affichez-en un nouveau.
        </Message>
      ) : etat.etat === 'non_reconnu' ? (
        <Message ton="erreur" role="alert">
          Ce téléphone n’est pas reconnu pour ce compte.
        </Message>
      ) : null}
      <p className="text-base leading-relaxed">
        Connexion de <strong>{personne}</strong> sur le poste <strong>{poste}</strong>.
        <br />
        C’est bien vous ?
      </p>
      <div className="flex flex-col gap-3">
        <button
          type="submit"
          name="reponse"
          value="oui"
          disabled={enCours}
          className="lien-action h-12 w-full justify-center bouton-principal text-base font-semibold disabled:opacity-60"
        >
          Oui, c’est moi
        </button>
        <button
          type="submit"
          name="reponse"
          value="non"
          disabled={enCours}
          className="h-12 w-full rounded-full border border-border bg-white text-base font-semibold text-etat-erreur disabled:opacity-60"
        >
          Non, ce n’est pas moi
        </button>
      </div>
    </form>
  )
}
