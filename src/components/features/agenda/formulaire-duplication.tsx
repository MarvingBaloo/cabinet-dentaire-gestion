'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Message } from '@/components/ui/message'
import { type EtatAgenda, dupliquerRendezVousAction } from '@/server/actions/agenda'

// Formulaire de duplication (lot 5) : reprendre un rendez-vous existant sur
// une nouvelle date, sans retaper patient, motif ni praticien. Ces trois-là ne
// sont pas des champs ici — pour en changer un seul, on crée un rendez-vous
// normal (le lien « Nouveau rendez-vous » de l'agenda).

export type RendezVousADupliquer = {
  id: string
  patient: { nom: string; prenom: string }
  praticien: { nom: string; prenom: string }
  motif: { libelle: string }
  site: { nom: string }
  /** `null` si le couple praticien × motif n'a plus de durée définie — le
   *  service la refusera alors (`ActeNonPratiqueError`), mais l'affichage ne
   *  doit pas prétendre en connaître une. */
  dureeMinutes: number | null
}

export function FormulaireDuplication({ rdv, jour }: { rdv: RendezVousADupliquer; jour: string }) {
  const [etat, action] = useActionState<EtatAgenda, FormData>(dupliquerRendezVousAction, {})

  return (
    // La clé change à chaque refus, ce qui refait monter le formulaire — même
    // raison que `formulaire-rendez-vous.tsx` : React ne réapplique pas un
    // `defaultValue` à un champ déjà monté.
    <form key={etat.jeton ?? 'vierge'} action={action} className="space-y-6">
      <input type="hidden" name="id" value={rdv.id} />

      {etat.erreur ? (
        <Message ton="erreur" role="alert">
          {etat.erreur}
        </Message>
      ) : null}
      {etat.succes ? (
        <Message ton="succes" role="status">
          {etat.succes}{' '}
          <Link href={`/tableau-de-bord/agenda?jour=${jour}`} className="underline">
            Retour à l’agenda
          </Link>
        </Message>
      ) : null}

      <fieldset className="space-y-1.5 rounded-[var(--radius-sm)] border border-border p-4 text-sm">
        <legend className="px-1 text-sm font-medium">Rendez-vous repris</legend>
        <p className="font-medium">
          {rdv.patient.nom.toUpperCase()} {rdv.patient.prenom}
        </p>
        <p className="text-muted-foreground">{rdv.motif.libelle}</p>
        <p className="text-muted-foreground">
          {rdv.praticien.prenom} {rdv.praticien.nom}
          {' · '}
          {rdv.site.nom}
        </p>
        <p className="text-xs text-muted-foreground">
          Patient, motif et praticien ne se changent pas ici. Pour l’un des trois, créez un nouveau rendez-vous.
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="jour-dup">Date</Label>
          <Input id="jour-dup" name="jour" type="date" required defaultValue={etat.valeurs?.jour || jour} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="heure-dup">Heure</Label>
          {/* `step` en secondes : 60 laisse saisir n'importe quelle minute,
              comme dans le formulaire de création. */}
          <Input id="heure-dup" name="heure" type="time" step={60} required defaultValue={etat.valeurs?.heure} />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {rdv.dureeMinutes
          ? `Durée prévue : ${rdv.dureeMinutes} minutes — celle du praticien pour ce motif aujourd’hui, comme pour une création.`
          : 'La durée dépend du praticien et du motif, relue au moment de l’enregistrement.'}
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit">Dupliquer le rendez-vous</Button>
        <Link href={`/tableau-de-bord/agenda?jour=${jour}`} className="text-sm text-muted-foreground underline">
          Annuler
        </Link>
      </div>
    </form>
  )
}
