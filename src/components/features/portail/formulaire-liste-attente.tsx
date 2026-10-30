'use client'

import { useActionState } from 'react'

import { Message } from '@/components/ui/message'
import { type EtatInscriptionListeAttente, inscrireListeAttenteAction } from '@/server/actions/liste-attente'

// Confirmation d'inscription à la liste d'attente (lot D, D29). Le motif, le
// cabinet et le praticien arrivent déjà choisis, et s'affichent au-dessus dans
// « Votre demande » : rien à ressaisir.

export function FormulaireListeAttente({
  siteId,
  motifId,
  praticienId,
  avantLeLibelle,
}: {
  siteId: string
  motifId: string
  praticienId?: string
  /** Affichage seulement (D29) : la valeur réellement enregistrée est
   *  recalculée côté serveur au moment de l'inscription. */
  avantLeLibelle?: string | null
}) {
  const [etat, action, enCours] = useActionState<EtatInscriptionListeAttente, FormData>(inscrireListeAttenteAction, {})

  if (etat.succes) {
    return (
      <Message ton="succes" role="status">
        {etat.succes}
      </Message>
    )
  }

  return (
    <form action={action} className="space-y-6">
      {etat.erreur ? (
        <Message ton="erreur" role="alert">
          {etat.erreur}
        </Message>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Votre numéro est vérifié.{' '}
        {avantLeLibelle
          ? `Vous serez prévenu si une place se libère avant le ${avantLeLibelle}.`
          : 'Vous serez prévenu dès qu’une place se libère.'}
      </p>

      <input type="hidden" name="motifId" value={motifId} />
      <input type="hidden" name="siteId" value={siteId} />
      {praticienId ? <input type="hidden" name="praticienId" value={praticienId} /> : null}

      <button
        type="submit"
        disabled={enCours}
        className="lien-action h-12 bouton-principal px-5 font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-60"
      >
        {enCours ? 'Inscription…' : 'M’inscrire en liste d’attente'}
      </button>
    </form>
  )
}
