'use client'

import { useActionState } from 'react'

import { Message } from '@/components/ui/message'
import { type EtatAcces, demanderAccesAction, verifierAccesAction } from '@/server/actions/acces-patient'

// Deux temps, comme la réservation : le numéro, puis le code. Le champ du code
// n'apparaît qu'une fois le SMS parti — demander les deux d'un coup donnerait un
// champ que personne ne saurait remplir. Le numéro reste affiché au-dessus
// (maquette du 13/10), pour qu'on voie à quel numéro le code est parti.

const bouton =
  'h-12 shrink-0 bouton-principal px-5 font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-60'

export function AccesParTelephone({ libelleBouton = 'Voir mes rendez-vous' }: { libelleBouton?: string } = {}) {
  const [etat, action, enCours] = useActionState<EtatAcces, FormData>(demanderAccesAction, {})

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        {etat.erreur ? (
          <Message ton="erreur" role="alert">
            {etat.erreur}
          </Message>
        ) : null}
        <div className="space-y-2">
          <label htmlFor="telephone" className="block text-sm font-medium">
            Votre numéro de téléphone
          </label>
          <div className="flex flex-wrap gap-3">
            <input
              id="telephone"
              name="telephone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="06 90 12 34 56"
              defaultValue={etat.telephone ?? ''}
              aria-describedby="aide-telephone"
              className="champ min-w-[13rem] flex-1"
            />
            <button type="submit" disabled={enCours} className={bouton}>
              {enCours ? 'Envoi…' : etat.masque ? 'Renvoyer un code' : 'Recevoir un code'}
            </button>
          </div>
          <p id="aide-telephone" className="text-[0.8125rem] text-muted-foreground">
            Tapez-le comme d’habitude : 0690… ou +590…
          </p>
        </div>
      </form>

      {etat.masque ? (
        // La clé remonte le second formulaire à chaque nouvel envoi : son erreur
        // éventuelle visait l'ancien code.
        <EtapeCode
          key={etat.masque + (etat.telephone ?? '')}
          masque={etat.masque}
          telephone={etat.telephone ?? ''}
          libelleBouton={libelleBouton}
        />
      ) : null}
    </div>
  )
}

function EtapeCode({ masque, telephone, libelleBouton }: { masque: string; telephone: string; libelleBouton: string }) {
  const [etat, action, enCours] = useActionState<EtatAcces, FormData>(verifierAccesAction, {})

  return (
    <form action={action} className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Si ce numéro est connu du cabinet, un code vient de partir au {masque}.
      </p>

      {etat.erreur ? (
        <Message ton="erreur" role="alert">
          {etat.erreur}
        </Message>
      ) : null}

      {/* Le numéro voyage avec le formulaire : sans lui, la vérification ne
          saurait pas quelle demande reprendre. */}
      <input type="hidden" name="telephone" value={telephone} />
      <input type="hidden" name="masque" value={masque} />

      <div className="space-y-2">
        <label htmlFor="code" className="block text-sm font-medium">
          Code à six chiffres
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          className="champ chiffres max-w-[25rem] tracking-wider"
        />
      </div>

      <button type="submit" disabled={enCours} className={`lien-action ${bouton}`}>
        {enCours ? 'Vérification…' : libelleBouton}
      </button>
    </form>
  )
}
