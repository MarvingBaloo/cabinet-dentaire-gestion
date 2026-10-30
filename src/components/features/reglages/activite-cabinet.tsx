'use client'

import { useActionState } from 'react'

import { Message } from '@/components/ui/message'
import { changerActiviteCabinetAction, type EtatActiviteCabinet } from '@/server/actions/cabinet'

/** Le bouton qui coche ou décoche « En activité » sur un cabinet (D74), avec le retour du serveur. */
export function ActiviteCabinet({ id, nom, actif }: { id: string; nom: string; actif: boolean }) {
  const [etat, action, enCours] = useActionState<EtatActiviteCabinet, FormData>(changerActiviteCabinetAction, {})

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="cabinet" value={id} />
      <input type="hidden" name="actif" value={actif ? 'non' : 'oui'} />
      <button
        type="submit"
        disabled={enCours}
        className={
          actif
            ? 'inline-flex h-10 items-center rounded-full border border-[#dde9e6] bg-white px-5 text-sm font-semibold hover:bg-[#f5f9f8]'
            : 'bouton-principal inline-flex h-10 items-center px-5 text-sm font-semibold'
        }
      >
        {enCours ? 'Enregistrement…' : actif ? `Retirer ${nom}` : `Remettre ${nom} en activité`}
      </button>
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
    </form>
  )
}
