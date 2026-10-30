'use client'

import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useState } from 'react'

import { TitreAlveole } from '@/components/features/patients/alveoles'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FUSEAU_CABINET, heureCabinet, jourLocal } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
  type EtatIndisponibilite,
  creerIndisponibiliteAction,
  supprimerIndisponibiliteAction,
} from '@/server/actions/indisponibilites'

// Écran des congés, fermetures et maintenances (compléments d'agenda, lot 2 ;
// maquettes du 13/10). La garde anti-orphelin (Q5) est entièrement côté service
// — cet écran se contente d'afficher la liste des rendez-vous concernés quand
// elle refuse, même principe que `presences.tsx`.

export type PraticienVue = { id: string; nom: string; prenom: string }
export type SiteVue = { id: string; nom: string }

export type IndisponibiliteVue = {
  id: string
  type: string
  /** ISO — instant, pas un jour civil : une indisponibilité peut tenir en heures. */
  debut: string
  fin: string
  motif: string | null
  siteNom: string | null
  praticienNom: string | null
}

type Teinte = { libelle: string; classes: string }

const TYPES: Record<string, Teinte> = {
  CONGE: { libelle: 'Congé', classes: 'bg-etat-alerte-fond text-etat-alerte' },
  FERMETURE: { libelle: 'Fermeture', classes: 'bg-etat-erreur-fond text-etat-erreur' },
  AUTRE: { libelle: 'Maintenance', classes: 'bg-secondary text-foreground' },
  // Valeurs existantes mais hors de la portée de cet écran (voir
  // validation/indisponibilites.ts) — affichées si jamais une ligne plus
  // ancienne en portait une, plutôt que de rendre `undefined`.
  PAUSE: { libelle: 'Pause', classes: 'bg-secondary text-foreground' },
  RESERVE_URGENCE: { libelle: 'Réservé aux urgences', classes: 'bg-primary/10 text-primary' },
  FERIE: { libelle: 'Jour férié', classes: 'bg-secondary text-foreground' },
}

const jourCourt = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU_CABINET, weekday: 'short', day: 'numeric' })
const jourMois = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const court = (nom: string) => nom.replace(/^Cabinet (de |d’|d')/, '')

/** « Lun. 26 → ven. 30 oct. », « Ven. 13 nov. », « Lun. 12 oct. · 13:00 – 14:00 ». */
function periode(debutIso: string, finIso: string): string {
  const debut = new Date(debutIso)
  const fin = new Date(finIso)
  // Jours entiers : de minuit à minuit, heure du cabinet (`calculerPeriode`).
  if (heureCabinet(debut) === '00:00' && heureCabinet(fin) === '00:00') {
    const dernier = new Date(fin.getTime() - 1)
    if (jourLocal(debut) === jourLocal(dernier)) return majuscule(jourMois.format(debut))
    const memeMois = jourLocal(debut).slice(0, 7) === jourLocal(dernier).slice(0, 7)
    return `${majuscule((memeMois ? jourCourt : jourMois).format(debut))} → ${jourMois.format(dernier)}`
  }
  return `${majuscule(jourMois.format(debut))} · ${heureCabinet(debut)} – ${heureCabinet(fin)}`
}

function Refus({ etat }: { etat: EtatIndisponibilite }) {
  if (!etat.erreur) return null
  const rdv = etat.rendezVousConcernes ?? []
  return (
    <div role="alert" className="rounded-2xl border-l-4 border-etat-erreur bg-etat-erreur-fond px-5 py-4 text-sm">
      <p className="font-semibold text-etat-erreur">
        {rdv.length > 0
          ? `${rdv.length} rendez-vous ${rdv.length > 1 ? 'sont' : 'est'} déjà posé${rdv.length > 1 ? 's' : ''} sur cette période.`
          : etat.erreur}
      </p>
      {rdv.length > 0 ? (
        <>
          <ul className="mt-3 space-y-1 text-foreground">
            {rdv.map((r) => (
              <li key={r.id}>
                • {majuscule(jourCourt.format(new Date(r.debut)))} · {heureCabinet(new Date(r.debut))} — {r.patient}
              </li>
            ))}
          </ul>
          <Link
            href={`/tableau-de-bord/agenda?date=${jourLocal(new Date(rdv[0]!.debut))}`}
            className="mt-2 inline-block text-etat-erreur underline-offset-4 hover:underline"
          >
            À déplacer ou annuler d’abord →
          </Link>
        </>
      ) : null}
    </div>
  )
}

export function Indisponibilites({
  praticiens,
  sites,
  indisponibilites,
  jourDuJour,
}: {
  praticiens: PraticienVue[]
  sites: SiteVue[]
  indisponibilites: IndisponibiliteVue[]
  /** Aujourd'hui, heure du cabinet — vient de la fonction d'accès qui a chargé
   *  la page, jamais lu ici : un composant ne lit pas l'horloge à son rendu. */
  jourDuJour: string
}) {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <section className="carte-douce px-5 py-6 sm:px-7">
        <h2 className="font-heading text-xl font-bold">À venir</h2>
        {indisponibilites.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Aucun congé ni fermeture à venir.</p>
        ) : (
          <table className="mt-4 w-full text-[0.9375rem]">
            <thead>
              <tr className="border-b border-[#eef2f2] text-left text-xs tracking-[0.1em] text-muted-foreground uppercase">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Type
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Qui ou quoi
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Période
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {indisponibilites.map((i) => (
                <LigneIndisponibilite key={i.id} indisponibilite={i} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <NouvelleIndisponibilite praticiens={praticiens} sites={sites} jourDuJour={jourDuJour} />
    </div>
  )
}

function LigneIndisponibilite({ indisponibilite: i }: { indisponibilite: IndisponibiliteVue }) {
  const [etat, action] = useActionState<EtatIndisponibilite, FormData>(supprimerIndisponibiliteAction, {})
  const type = TYPES[i.type] ?? { libelle: i.type, classes: 'bg-secondary text-foreground' }
  const qui = [i.praticienNom ? `Dr ${i.praticienNom}` : null, i.siteNom ? court(i.siteNom) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <tr
        data-cible={i.type === 'FERMETURE' ? 'indisponibilite fermeture' : 'indisponibilite'}
        className="border-b border-[#eef2f2]"
      >
        <td className="px-4 py-4 align-top">
          <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[0.8125rem] font-medium', type.classes)}>
            {type.libelle}
          </span>
        </td>
        <td className="px-4 py-4 align-top">
          <p className="font-medium">{i.type === 'FERMETURE' && i.siteNom ? i.siteNom : qui || '—'}</p>
          {i.motif ? <p className="text-[0.8125rem] text-muted-foreground">{i.motif}</p> : null}
        </td>
        <td className="px-4 py-4 align-top tabular-nums">{periode(i.debut, i.fin)}</td>
        <td className="px-4 py-4 text-right align-top">
          <form action={action}>
            <input type="hidden" name="id" value={i.id} />
            <button type="submit" className="text-sm text-etat-erreur underline-offset-4 hover:underline">
              Supprimer
            </button>
          </form>
        </td>
      </tr>
      {etat.erreur || etat.succes ? (
        <tr>
          <td colSpan={4} className="px-4 pb-4">
            {etat.erreur ? (
              <Refus etat={etat} />
            ) : (
              <p role="status" className="text-sm text-etat-succes">
                {etat.succes}
              </p>
            )}
          </td>
        </tr>
      ) : null}
    </>
  )
}

const CHOIX_TYPES = [
  { valeur: 'CONGE', libelle: 'Congé d’un praticien' },
  { valeur: 'FERMETURE', libelle: 'Fermeture d’un cabinet' },
  { valeur: 'AUTRE', libelle: 'Maintenance / autre' },
] as const

type TypeSaisi = (typeof CHOIX_TYPES)[number]['valeur']

function NouvelleIndisponibilite({
  praticiens,
  sites,
  jourDuJour,
}: {
  praticiens: PraticienVue[]
  sites: SiteVue[]
  jourDuJour: string
}) {
  const [etat, action] = useActionState<EtatIndisponibilite, FormData>(creerIndisponibiliteAction, {})

  const typeInitial = CHOIX_TYPES.find((t) => t.valeur === etat.saisie?.type)?.valeur ?? 'CONGE'
  const [type, setType] = useState<TypeSaisi>(typeInitial)
  const [joursEntiers, setJoursEntiers] = useState(etat.saisie ? etat.saisie.joursEntiers === 'on' : true)

  const afficherPraticien = type === 'CONGE' || type === 'AUTRE'
  const afficherSite = type === 'FERMETURE' || type === 'AUTRE'

  return (
    <form key={etat.jeton ?? 'vierge'} action={action} className="carte-douce space-y-5 self-start px-6 py-6 sm:px-7">
      <TitreAlveole id="titre-ajout" icone={Plus}>
        Ajouter
      </TitreAlveole>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Type</legend>
        <div className="space-y-2.5">
          {CHOIX_TYPES.map((t) => (
            <label key={t.valeur} className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="type"
                value={t.valeur}
                checked={type === t.valeur}
                onChange={() => setType(t.valeur)}
                className="size-[1.125rem] accent-[#387a70]"
              />
              {t.libelle}
            </label>
          ))}
        </div>
      </fieldset>

      {afficherPraticien ? (
        <div className="space-y-1.5">
          <Label htmlFor="indispo-praticien">Praticien{type === 'AUTRE' ? ' (facultatif)' : ''}</Label>
          <select
            id="indispo-praticien"
            name="praticienId"
            required={type === 'CONGE'}
            defaultValue={etat.saisie?.praticienId ?? ''}
            className="champ rounded-full"
          >
            <option value="">Choisir…</option>
            {praticiens.map((p) => (
              <option key={p.id} value={p.id}>
                Dr {p.prenom} {p.nom}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {afficherSite ? (
        <div className="space-y-1.5">
          <Label htmlFor="indispo-site">Cabinet{type === 'AUTRE' ? ' (facultatif)' : ''}</Label>
          <select
            id="indispo-site"
            name="siteId"
            required={type === 'FERMETURE'}
            defaultValue={etat.saisie?.siteId ?? ''}
            className="champ rounded-full"
          >
            <option value="">Choisir…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          name="joursEntiers"
          checked={joursEntiers}
          onChange={(e) => setJoursEntiers(e.currentTarget.checked)}
          className="size-[1.125rem] accent-[#387a70]"
        />
        Jour(s) entier(s)
      </label>

      {joursEntiers ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="indispo-date-debut">Du</Label>
            <Input
              id="indispo-date-debut"
              name="dateDebut"
              type="date"
              required
              min={jourDuJour}
              defaultValue={etat.saisie?.dateDebut}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="indispo-date-fin">Au</Label>
            <Input
              id="indispo-date-fin"
              name="dateFin"
              type="date"
              required
              min={jourDuJour}
              defaultValue={etat.saisie?.dateFin}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="indispo-date">Date</Label>
            <Input
              id="indispo-date"
              name="dateDebut"
              type="date"
              required
              min={jourDuJour}
              defaultValue={etat.saisie?.dateDebut}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="indispo-heure-debut">Début</Label>
            <Input
              id="indispo-heure-debut"
              name="heureDebut"
              type="time"
              step={60}
              required
              defaultValue={etat.saisie?.heureDebut}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="indispo-heure-fin">Fin</Label>
            <Input
              id="indispo-heure-fin"
              name="heureFin"
              type="time"
              step={60}
              required
              defaultValue={etat.saisie?.heureFin}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="indispo-motif">Motif{type === 'AUTRE' ? '' : ' (facultatif)'}</Label>
        <Input
          id="indispo-motif"
          name="motif"
          required={type === 'AUTRE'}
          defaultValue={etat.saisie?.motif}
          maxLength={300}
        />
      </div>

      <Refus etat={etat} />
      {etat.succes ? (
        <p role="status" className="text-sm text-etat-succes">
          {etat.succes}
        </p>
      ) : null}

      <button type="submit" className="h-11 bouton-principal px-5 text-sm font-semibold">
        Ajouter
      </button>
    </form>
  )
}
