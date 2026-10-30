'use client'

import { useActionState } from 'react'

import { BoutonEnvoi } from './bouton-envoi'
import { ChampErreur } from './champ-erreur'
import { SaisieCode } from './saisie-code'
import { Message } from '@/components/ui/message'
import {
  renvoyerCodeAction,
  secondFacteurAction,
  type EtatFormulaire,
} from '@/server/actions/auth'

export function FormulaireSecondFacteur({ masque }: { masque?: string }) {
  const [etat, action] = useActionState<EtatFormulaire, FormData>(secondFacteurAction, {})
  const [etatRenvoi, renvoyer, renvoiEnCours] = useActionState<EtatFormulaire, FormData>(
    renvoyerCodeAction,
    {},
  )

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
      <ChampErreur id="erreur-code" message={etat.erreur ?? etatRenvoi.erreur} />

      {etatRenvoi.succes ? (
        <Message ton="succes" role="status">
          {etatRenvoi.succes}
        </Message>
      ) : null}

      <div>
        <p id="libelle-code" className="etiquette">
          Code à 6 chiffres
        </p>
        <SaisieCode
          name="code"
          idLibelle="libelle-code"
          decritPar={etat.erreur ? 'erreur-code' : 'aide-code'}
        />
        <p id="aide-code" className="mt-1.5 text-sm text-muted-foreground">
          {masque
            ? `Nous venons de l’envoyer par SMS au ${masque}.`
            : 'Nous venons de vous l’envoyer par SMS.'}{' '}
          Il est valable dix minutes.
        </p>
      </div>

      <BoutonEnvoi>Valider</BoutonEnvoi>
    </form>
      <form action={renvoyer}>
        <button
          type="submit"
          disabled={renvoiEnCours}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
        >
          {renvoiEnCours ? 'Envoi…' : 'Je n’ai rien reçu — renvoyer un code'}
        </button>
      </form>
    </div>
  )
}
