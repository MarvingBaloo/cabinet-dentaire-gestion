'use client'

import { useActionState, useState } from 'react'

import { Message } from '@/components/ui/message'
import { type EtatAgenda, refuserAnnulationAction, validerAnnulationAction } from '@/server/actions/agenda'

export type DemandeAValider = {
  id: string
  quand: string
  patient: string
  demandeur: string
}

/** Encart du praticien (maquette du 13/10) : il tranche, l'accueil a demandé (D17). */
export function DemandesAValider({ demandes }: { demandes: DemandeAValider[] }) {
  // La ligne tranchée disparaît aussitôt : le message vit donc ici, au-dessus de la liste (tour du 20/10).
  const [dernier, setDernier] = useState<string | null>(null)
  return (
    <>
      {dernier ? (
        <Message ton="succes" role="status" className="mb-4">
          {dernier}
        </Message>
      ) : null}
      {demandes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune demande à valider.</p>
      ) : (
        <ul className="divide-y divide-[#eef2f2]">
          {demandes.map((d) => (
            <Ligne key={d.id} demande={d} onTranchee={setDernier} />
          ))}
        </ul>
      )}
    </>
  )
}

function Ligne({ demande, onTranchee }: { demande: DemandeAValider; onTranchee: (message: string) => void }) {
  const [etatAccepter, accepter, acceptation] = useActionState<EtatAgenda, FormData>(async (p, d) => {
    const r = await validerAnnulationAction(p, d)
    if (r.succes)
      onTranchee(
        `Rendez-vous de ${demande.patient} annulé. Le patient est prévenu par SMS et le créneau est proposé à la liste d’attente.`,
      )
    return r
  }, {})
  const [etatRefuser, refuser, refus] = useActionState<EtatAgenda, FormData>(async (p, d) => {
    const r = await refuserAnnulationAction(p, d)
    if (r.succes) onTranchee(`Demande refusée : le rendez-vous de ${demande.patient} est maintenu.`)
    return r
  }, {})
  const erreur = etatAccepter.erreur ?? etatRefuser.erreur

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <p className="chiffres font-semibold">{demande.quand}</p>
      <p className="text-[0.9375rem]">{demande.patient}</p>
      <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{demande.demandeur}</p>
      <div className="mt-3 flex gap-2">
        <form action={accepter}>
          <input type="hidden" name="id" value={demande.id} />
          <button
            type="submit"
            disabled={acceptation || refus}
            className="h-9 bouton-principal px-4 text-sm font-semibold disabled:opacity-60"
          >
            {acceptation ? 'Annulation…' : 'Valider l’annulation'}
          </button>
        </form>
        <form action={refuser}>
          <input type="hidden" name="id" value={demande.id} />
          <button
            type="submit"
            disabled={acceptation || refus}
            className="h-9 rounded-full border border-border bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            {refus ? 'Refus…' : 'Refuser'}
          </button>
        </form>
      </div>
      {erreur ? (
        <Message ton="erreur" role="alert" className="mt-2">
          {erreur}
        </Message>
      ) : null}
    </li>
  )
}
