'use client'

import { Bell } from 'lucide-react'
import { useActionState, useRef, useState } from 'react'

import { Message } from '@/components/ui/message'
import { type EtatPreferences, enregistrerPreferencesAction } from '@/server/actions/preferences-notifications'

// Préférences de notification, par canal (phase 4, lot 5b, D44) — dans l'accès
// patient. Interrupteurs enregistrés au clic (maquette du 13/10) : pas de bouton
// « Enregistrer » à oublier en quittant la page.

type PreferenceCanal = { rappels: boolean; nonEssentiels: boolean }

type Preferences = {
  sms: PreferenceCanal
  email: (PreferenceCanal & { adresse: string }) | null
}

function Interrupteur({
  name,
  titre,
  detail,
  defaultChecked,
  onChange,
}: {
  name: string
  titre: string
  detail: string
  defaultChecked: boolean
  onChange: (coche: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4">
      <input
        type="checkbox"
        role="switch"
        name={name}
        defaultChecked={defaultChecked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-border transition-colors peer-checked:bg-linear-to-br peer-checked:from-[#4f9a8f] peer-checked:to-[#387a70] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5"
      />
      <span>
        <span className="block text-[0.9375rem] font-medium">{titre}</span>
        <span className="block text-[0.8125rem] text-muted-foreground">{detail}</span>
      </span>
    </label>
  )
}

export function MesPreferencesNotifications({
  preferences,
  inscritListeAttente,
}: {
  preferences: Preferences
  /** Le numéro a au moins une inscription active à la liste d'attente : décocher
   *  « autres messages » côté SMS l'en priverait, d'où l'avertissement. */
  inscritListeAttente: boolean
}) {
  const [etat, action, enCours] = useActionState<EtatPreferences, FormData>(enregistrerPreferencesAction, {})
  const [smsNonEssentiels, setSmsNonEssentiels] = useState(
    etat.saisie?.smsNonEssentiels ?? preferences.sms.nonEssentiels,
  )
  const formulaire = useRef<HTMLFormElement>(null)
  const enregistrer = () => formulaire.current?.requestSubmit()

  return (
    <section aria-labelledby="titre-messages" className="carte-douce px-7 py-7">
      <h2 id="titre-messages" className="flex items-center gap-3 font-heading text-xl font-bold">
        <span className="hexagone grid h-12 w-[2.625rem] shrink-0 place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white">
          <Bell aria-hidden className="size-5" strokeWidth={1.6} />
        </span>
        Messages que vous recevez
      </h2>

      <form ref={formulaire} action={action} className="mt-6 space-y-6">
        <Interrupteur
          name="smsRappels"
          titre="Rappels de rendez-vous"
          detail="(information de soin, recommandé)"
          defaultChecked={etat.saisie?.smsRappels ?? preferences.sms.rappels}
          onChange={enregistrer}
        />
        <Interrupteur
          name="smsNonEssentiels"
          titre="Autres messages"
          detail="(places libérées sur la liste d’attente)"
          defaultChecked={etat.saisie?.smsNonEssentiels ?? preferences.sms.nonEssentiels}
          onChange={(coche) => {
            setSmsNonEssentiels(coche)
            enregistrer()
          }}
        />

        {preferences.email ? (
          <fieldset className="space-y-5 border-t border-border pt-5">
            <legend className="float-left mb-4 w-full text-sm font-medium">
              Par e-mail ({preferences.email.adresse})
            </legend>
            <input type="hidden" name="emailPropose" value="on" />
            <Interrupteur
              name="emailRappels"
              titre="Rappels de rendez-vous"
              detail="(information de soin, recommandé)"
              defaultChecked={etat.saisie?.emailRappels ?? preferences.email.rappels}
              onChange={enregistrer}
            />
            <Interrupteur
              name="emailNonEssentiels"
              titre="Autres messages"
              detail="(places libérées sur la liste d’attente)"
              defaultChecked={etat.saisie?.emailNonEssentiels ?? preferences.email.nonEssentiels}
              onChange={enregistrer}
            />
          </fieldset>
        ) : null}

        {!smsNonEssentiels && inscritListeAttente ? (
          <Message ton="alerte" role="alert">
            Vous êtes inscrit sur une liste d’attente : sans ces messages, vous ne serez plus prévenu par SMS si une
            place se libère.
          </Message>
        ) : null}

        <div aria-live="polite" className="min-h-5 text-[0.8125rem]">
          {enCours ? (
            <span className="text-muted-foreground">Enregistrement…</span>
          ) : etat.erreur ? (
            <span role="alert" className="text-etat-erreur">
              {etat.erreur}
            </span>
          ) : etat.succes ? (
            <span className="text-etat-succes">{etat.succes}</span>
          ) : (
            <span className="text-muted-foreground">
              Confirmations, déplacements et annulations vous sont toujours envoyés.
            </span>
          )}
        </div>
      </form>
    </section>
  )
}
