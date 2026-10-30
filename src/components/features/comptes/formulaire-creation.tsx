'use client'

import { RoleName } from '@prisma/client'
import { useActionState, useState } from 'react'

import { Message } from '@/components/ui/message'
import { LIBELLE_ROLE, ORDRE_ROLES } from '@/lib/roles'
import { creerCompteAction, type EtatCompte } from '@/server/actions/comptes'

// Teintes proposées (maquette du 13/10) : assez distinctes entre elles pour se
// reconnaître sur le planning, et toutes lisibles sous un texte blanc.
const COULEURS = ['#387a70', '#7c5cd6', '#15803d', '#c2410c', '#b91c1c', '#0e7490']

type Site = { id: string; nom: string }

// Cases NATIVES et non le composant de la bibliothèque : ce dernier s'appuie sur
// un champ caché pour alimenter FormData et ne fonctionne pas sans JavaScript.
// Sur un formulaire de gestion des comptes utilisé depuis un poste d'accueil, la
// robustesse prime sur l'uniformité visuelle.
function CaseACocher({
  name,
  value,
  defaultChecked,
  onChange,
  children,
}: {
  name: string
  value: string
  defaultChecked?: boolean
  onChange?: React.ChangeEventHandler<HTMLInputElement>
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-40 items-center gap-3 text-[0.9375rem]">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        onChange={onChange}
        className="size-[1.125rem] accent-[#387a70] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      {children}
    </label>
  )
}

export function FormulaireCreation({ sites, siteChoisi }: { sites: Site[]; siteChoisi: string | null }) {
  const [etat, action, enCours] = useActionState<EtatCompte, FormData>(creerCompteAction, {})
  const saisie = etat.saisie
  // Les champs de la fiche d'agenda n'ont de sens que pour un praticien.
  const [estPraticien, setEstPraticien] = useState(false)

  return (
    <form action={action} className="space-y-6">
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

      <div className="grid max-w-[47rem] gap-x-4 gap-y-5 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="prenom" className="block text-sm font-medium">
            Prénom
          </label>
          <input
            id="prenom"
            name="prenom"
            required
            autoComplete="off"
            defaultValue={saisie?.prenom}
            className="champ rounded-full"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="nom" className="block text-sm font-medium">
            Nom
          </label>
          <input
            id="nom"
            name="nom"
            required
            autoComplete="off"
            defaultValue={saisie?.nom}
            className="champ rounded-full"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <label htmlFor="email" className="block text-sm font-medium">
            Adresse professionnelle
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
            defaultValue={saisie?.email}
            className="champ rounded-full"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="telephoneMobile" className="block text-sm font-medium">
            Téléphone mobile
          </label>
          <input
            id="telephoneMobile"
            name="telephoneMobile"
            type="tel"
            required
            autoComplete="off"
            placeholder="06 90 12 34 56"
            aria-describedby="aide-mobile"
            defaultValue={saisie?.telephoneMobile}
            className="champ rounded-full"
          />
          <p id="aide-mobile" className="text-[0.8125rem] text-muted-foreground">
            Il reçoit le code de connexion par SMS.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="motDePasse" className="block text-sm font-medium">
            Mot de passe provisoire
          </label>
          <input
            id="motDePasse"
            name="motDePasse"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            aria-describedby="aide-mdp"
            className="champ rounded-full"
          />
          <p id="aide-mdp" className="text-[0.8125rem] text-muted-foreground">
            12 caractères minimum. À communiquer de vive voix, jamais par e-mail.
          </p>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Rôles{' '}
          <span className="ml-2 text-[0.8125rem] font-normal text-muted-foreground">
            Cumulables : les droits s’additionnent.
          </span>
        </legend>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {ORDRE_ROLES.map((role) => (
            <CaseACocher
              key={role}
              name="roles"
              value={role}
              defaultChecked={saisie?.roles.includes(role) ?? false}
              {...(role === RoleName.PRATICIEN ? { onChange: (e) => setEstPraticien(e.currentTarget.checked) } : {})}
            >
              {LIBELLE_ROLE[role]}
            </CaseACocher>
          ))}
        </div>
      </fieldset>

      {/* Un compte permet de se connecter ; c'est la fiche ci-dessous qui fait
          apparaître quelqu'un dans l'agenda. Sans elle, la personne se connecte
          mais reste introuvable au moment de lui poser un rendez-vous. */}
      {estPraticien ? (
        <div role="group" aria-labelledby="titre-fiche" className="space-y-5 border-t border-border pt-6">
          <h3 id="titre-fiche" className="font-heading text-xl font-semibold">
            Fiche dans l’agenda
          </h3>
          <div className="grid max-w-[47rem] gap-x-4 gap-y-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="titrePraticien" className="block text-sm font-medium">
                Titre affiché aux patients
              </label>
              <input
                id="titrePraticien"
                name="titrePraticien"
                type="text"
                defaultValue={saisie?.titrePraticien || 'Chirurgien-dentiste'}
                maxLength={100}
                className="champ rounded-full"
              />
            </div>
            <div
              role="radiogroup"
              aria-labelledby="libelle-couleur"
              aria-describedby="aide-couleur"
              className="space-y-2"
            >
              <p id="libelle-couleur" className="text-sm font-medium">
                Couleur dans l’agenda
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                {COULEURS.map((c, i) => (
                  <label key={c} className="relative cursor-pointer">
                    <input
                      type="radio"
                      name="couleurPraticien"
                      value={c}
                      defaultChecked={saisie?.couleurPraticien ? saisie.couleurPraticien === c : i === 0}
                      className="peer sr-only"
                    />
                    <span className="sr-only">Couleur {i + 1}</span>
                    <span
                      aria-hidden
                      style={{ backgroundColor: c }}
                      className="block size-8 rounded-full ring-offset-2 peer-checked:ring-[3px] peer-checked:ring-marine peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
                    />
                  </label>
                ))}
              </div>
              <p id="aide-couleur" className="text-[0.8125rem] text-muted-foreground">
                Sert à distinguer les praticiens d’un coup d’œil sur le planning.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Sites de rattachement</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {sites.map((site) => (
            <CaseACocher
              key={site.id}
              name="siteIds"
              value={site.id}
              defaultChecked={saisie ? saisie.siteIds.includes(site.id) : site.id === siteChoisi}
            >
              {site.nom.replace(/^Cabinet (de |d’|d')/, '')}
            </CaseACocher>
          ))}
        </div>
        <p className="text-[0.8125rem] text-muted-foreground">La personne ne voit que l’agenda des cabinets cochés.</p>
      </fieldset>

      <button
        type="submit"
        disabled={enCours}
        className="h-11 bouton-principal px-5 font-medium disabled:pointer-events-none disabled:opacity-60"
      >
        {enCours ? 'Création…' : 'Créer le compte'}
      </button>
    </form>
  )
}
