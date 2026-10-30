'use client'

import { useActionState } from 'react'

import { BoutonEnvoi } from './bouton-envoi'
import { ChampErreur } from './champ-erreur'
import { connexionAction, type EtatFormulaire } from '@/server/actions/auth'

export function FormulaireConnexion() {
  const [etat, action] = useActionState<EtatFormulaire, FormData>(connexionAction, {})

  return (
    <form action={action} className="space-y-4">
      <ChampErreur id="erreur-connexion" message={etat.erreur} />

      <div>
        <label htmlFor="email" className="etiquette">
          Adresse professionnelle
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          // Rendue par l'action après un refus : seul le mot de passe est à retaper.
          defaultValue={etat.email}
          key={etat.email}
          aria-describedby={etat.erreur ? 'erreur-connexion' : undefined}
          className="champ"
        />
      </div>

      <div>
        <label htmlFor="motDePasse" className="etiquette">
          Mot de passe
        </label>
        <input
          id="motDePasse"
          name="motDePasse"
          type="password"
          required
          autoComplete="current-password"
          aria-describedby={etat.erreur ? 'erreur-connexion' : undefined}
          className="champ"
        />
      </div>

      <BoutonEnvoi>Se connecter</BoutonEnvoi>
    </form>
  )
}
