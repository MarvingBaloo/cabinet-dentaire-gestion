'use client'

import { Check } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useState } from 'react'

import { Message } from '@/components/ui/message'
import { euros } from '@/lib/euros'
import { cn } from '@/lib/utils'
import {
  type EtatRetrocession,
  marquerVerseAction,
  reglerPartAction,
  reglerPrixAction,
} from '@/server/actions/retrocession'

// Les écrans de la rétrocession (D81, maquette du 28/10) : le relevé du mois pour l'administrateur, « Ma
// rétrocession » pour un praticien, et les deux réglages. Les montants arrivent en centimes, déjà calculés.

export type SoinVue = { id: string; jour: string; patient: string; acte: string; montantCentimes: number }

export type LigneVue = {
  praticien: { id: string; nom: string; couleur: string }
  part: number
  totalCentimes: number
  aVerserCentimes: number
  soins: SoinVue[]
  sansMontant: number
  versement: { montantCentimes: number; le: string } | null
}

const TH = 'px-4 py-3 text-left text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase sm:px-5'
const TD = 'px-4 py-3.5 sm:px-5'

function Hexagone({ couleur }: { couleur: string }) {
  return <span aria-hidden className="hexagone mr-2.5 inline-block h-[1.4rem] w-[1.2rem] align-middle" style={{ backgroundColor: couleur }} />
}

export function NavigationMois({ precedent, suivant, libelle }: { precedent: string; suivant: string | null; libelle: string }) {
  const bouton = 'grid size-9 place-items-center rounded-full border border-[#dde9e6] bg-white text-lg hover:bg-[#f5f9f8]'
  return (
    <nav aria-label="Mois" className="flex items-center gap-2">
      <Link href={`?mois=${precedent}`} className={bouton} aria-label="Mois précédent">
        ‹
      </Link>
      <span className="min-w-[9.5rem] text-center font-heading text-lg font-semibold">{libelle}</span>
      {suivant ? (
        <Link href={`?mois=${suivant}`} className={bouton} aria-label="Mois suivant">
          ›
        </Link>
      ) : (
        <span className={cn(bouton, 'opacity-40')} aria-hidden>
          ›
        </span>
      )}
    </nav>
  )
}

function ListeSoins({ ligne }: { ligne: LigneVue }) {
  return (
    <div className="bg-[#FBFAF7] px-4 py-2 sm:px-5">
      {ligne.soins.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Aucun soin passé en caisse ce mois-ci.</p>
      ) : (
        <ul className="divide-y divide-[#eef2f2] text-[0.875rem]">
          {ligne.soins.map((s) => (
            <li key={s.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] gap-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <span className="text-muted-foreground">{s.jour}</span>
              <span className="min-w-0 truncate">{s.patient}</span>
              <span className="hidden min-w-0 truncate sm:block">{s.acte}</span>
              <span className="chiffres text-right">{euros(s.montantCentimes)}</span>
            </li>
          ))}
        </ul>
      )}
      {ligne.sansMontant > 0 ? (
        <p className="py-2 text-[0.8125rem] text-etat-alerte">
          {ligne.sansMontant} passage{ligne.sansMontant > 1 ? 's' : ''} en caisse sans montant : à corriger dans la fiche du
          rendez-vous, {ligne.sansMontant > 1 ? 'ils ne comptent' : 'il ne compte'} pas.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Le relevé du mois, vu par l'administrateur : une ligne par praticien qui a une part. Un tableau à l'écran
 * large ; au téléphone, chaque praticien devient un bloc où ses chiffres s'empilent, tous lisibles sans défiler.
 */
export function ReleveCabinet({ lignes, mois }: { lignes: LigneVue[]; mois: string }) {
  const [ouvert, setOuvert] = useState<string | null>(null)
  const total = lignes.reduce((t, l) => t + (l.versement?.montantCentimes ?? l.aVerserCentimes), 0)
  const reste = lignes.filter((l) => !l.versement).reduce((t, l) => t + l.aVerserCentimes, 0)
  const COLONNES = 'sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_5rem_8rem_15rem] sm:items-center sm:gap-4'
  const ETIQUETTE = 'text-[0.8125rem] text-muted-foreground sm:hidden'

  return (
    <div className="carte-douce overflow-hidden">
      <div aria-hidden className={cn('hidden border-b border-[#eef2f2] px-5 py-3 text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase', COLONNES)}>
        <span>Praticien</span>
        <span className="text-right">Soins du mois</span>
        <span className="text-right">Sa part</span>
        <span className="text-right">À lui verser</span>
        <span />
      </div>
      <ul>
        {lignes.map((l) => {
          const aVerser = l.versement?.montantCentimes ?? l.aVerserCentimes
          return (
            <li key={l.praticien.id} aria-label={l.praticien.nom} className="border-b border-[#eef2f2]">
              <div className={cn('space-y-2.5 px-4 py-4 sm:space-y-0 sm:px-5', COLONNES)}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold">
                    <Hexagone couleur={l.praticien.couleur} />
                    {l.praticien.nom}
                  </span>
                  <button
                    type="button"
                    aria-expanded={ouvert === l.praticien.id}
                    onClick={() => setOuvert((o) => (o === l.praticien.id ? null : l.praticien.id))}
                    className="text-[0.8125rem] text-muted-foreground hover:text-foreground"
                  >
                    {ouvert === l.praticien.id ? '▴ masquer' : '▾ détail'}
                  </button>
                </div>
                <div className="flex items-baseline justify-between sm:block sm:text-right">
                  <span className={ETIQUETTE}>Soins du mois</span>
                  <span className="chiffres">{euros(l.totalCentimes)}</span>
                </div>
                <div className="flex items-baseline justify-between sm:block sm:text-right">
                  <span className={ETIQUETTE}>Sa part</span>
                  <span className="chiffres">{l.part} %</span>
                </div>
                <div className="flex items-baseline justify-between sm:block sm:text-right">
                  <span className={ETIQUETTE}>À lui verser</span>
                  <span className="chiffres font-heading text-lg font-bold">{euros(aVerser)}</span>
                </div>
                <div className="sm:text-right">
                  {l.versement ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-etat-succes-fond px-3 py-1 text-[0.8125rem] font-semibold text-etat-succes">
                      <Check aria-hidden className="size-3.5" strokeWidth={3} /> Versé le {l.versement.le}
                    </span>
                  ) : (
                    <MarquerVerse praticienId={l.praticien.id} mois={mois} nom={l.praticien.nom} />
                  )}
                </div>
              </div>
              {ouvert === l.praticien.id ? <ListeSoins ligne={l} /> : null}
            </li>
          )
        })}
      </ul>
      <div className={cn('flex flex-wrap items-baseline justify-between gap-2 px-4 py-4 sm:px-5', COLONNES)}>
        <span className="font-semibold sm:col-span-3">Total à verser ce mois</span>
        <span className="chiffres text-right font-heading text-lg font-bold">{euros(total)}</span>
        <span className="w-full text-[0.8125rem] text-muted-foreground sm:w-auto sm:text-right">
          {reste > 0 ? `dont ${euros(reste)} à verser` : 'tout est versé'}
        </span>
      </div>
    </div>
  )
}

function MarquerVerse({ praticienId, mois, nom }: { praticienId: string; mois: string; nom: string }) {
  const [etat, action, enCours] = useActionState<EtatRetrocession, FormData>(marquerVerseAction, {})
  return (
    <form action={action} className="inline-flex flex-col gap-1 sm:items-end">
      <input type="hidden" name="praticienId" value={praticienId} />
      <input type="hidden" name="mois" value={mois} />
      <button
        type="submit"
        disabled={enCours}
        aria-label={`Marquer comme versé — ${nom}`}
        className="h-9 bouton-principal px-4 text-[0.8125rem] font-semibold whitespace-nowrap disabled:opacity-60"
      >
        Marquer comme versé
      </button>
      {etat.erreur ? (
        <span role="alert" className="text-[0.8125rem] text-etat-erreur">
          {etat.erreur}
        </span>
      ) : null}
    </form>
  )
}

export type MoisVue = { mois: string; libelle: string; totalCentimes: number; aVerserCentimes: number; verse: boolean }

/** « Ma rétrocession » : les mois du praticien connecté, et le détail de celui qu'il ouvre. */
export function MaRetrocession({
  part,
  historique,
  choisi,
  detail,
}: {
  part: number | null
  historique: MoisVue[]
  choisi: string
  detail: LigneVue
}) {
  if (part === null) {
    return (
      <Message ton="info" role="status">
        Votre part n’est pas encore réglée par l’administrateur du cabinet.
      </Message>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Votre part : <span className="font-semibold text-foreground">{part} %</span> des soins passés en caisse.
      </p>
      <div className="carte-douce overflow-x-auto">
        <table className="w-full min-w-[30rem] text-[0.9375rem]">
          <thead>
            <tr className="border-b border-[#eef2f2]">
              <th scope="col" className={TH}>
                Mois
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Soins
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Pour moi
              </th>
              <th scope="col" className={TH}>
                <span className="sr-only">État</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {historique.filter((m, i) => i === 0 || m.totalCentimes > 0 || m.verse || m.mois === choisi).map((m) => (
              <tr key={m.mois} className={cn('border-b border-[#eef2f2]', m.mois === choisi && 'bg-[#f2f8f6]')}>
                <th scope="row" className={cn(TD, 'text-left font-normal')}>
                  <Link href={`?mois=${m.mois}`} aria-current={m.mois === choisi ? 'true' : undefined} className="font-semibold hover:underline">
                    {m.libelle}
                  </Link>
                </th>
                <td className={cn(TD, 'chiffres text-right')}>{euros(m.totalCentimes)}</td>
                <td className={cn(TD, 'chiffres text-right font-heading font-bold')}>{euros(m.aVerserCentimes)}</td>
                <td className={TD}>
                  {m.verse ? (
                    <span className="rounded-full bg-etat-succes-fond px-2.5 py-0.5 text-[0.8125rem] font-semibold text-etat-succes">Versé</span>
                  ) : m.totalCentimes > 0 ? (
                    <span className="rounded-full bg-etat-alerte-fond px-2.5 py-0.5 text-[0.8125rem] font-semibold text-etat-alerte">À venir</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-label="Soins du mois" className="carte-douce overflow-hidden">
        <h2 className="px-4 pt-4 font-heading text-base font-semibold sm:px-5">
          Mes soins — {historique.find((m) => m.mois === choisi)?.libelle ?? choisi}
        </h2>
        <div className="mt-2">
          <ListeSoins ligne={detail} />
        </div>
      </section>
    </div>
  )
}

/** Réglages : la part de chaque praticien, le prix de chaque soin. Une ligne, un formulaire. */
export function ReglagePart({ praticien }: { praticien: { id: string; nom: string; couleur: string; part: number | null; titulaire: boolean } }) {
  const [etat, action, enCours] = useActionState<EtatRetrocession, FormData>(reglerPartAction, {})
  const id = `part-${praticien.id}`
  return (
    <form
      action={action}
      data-cible={praticien.part !== null ? 'avec-part' : undefined}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-[#eef2f2] py-3 last:border-0"
    >
      <input type="hidden" name="praticienId" value={praticien.id} />
      <label htmlFor={id} className="min-w-0 font-medium">
        <Hexagone couleur={praticien.couleur} />
        {praticien.nom}
        {praticien.titulaire ? <span className="ml-2 text-[0.8125rem] font-normal text-muted-foreground">titulaire</span> : null}
      </label>
      <span className="flex items-center gap-2">
        <input
          id={id}
          name="part"
          inputMode="numeric"
          defaultValue={praticien.part ?? ''}
          placeholder="—"
          className="champ chiffres h-9 w-20 rounded-full py-1 text-right"
        />
        <span>%</span>
        <button type="submit" disabled={enCours} className="h-9 rounded-full border border-[#dde9e6] bg-white px-3.5 text-sm font-semibold hover:bg-[#f5f9f8] disabled:opacity-60">
          Enregistrer
        </button>
      </span>
      <Retour etat={etat} />
    </form>
  )
}

export function ReglagePrix({ motif }: { motif: { id: string; libelle: string; prix: string } }) {
  const [etat, action, enCours] = useActionState<EtatRetrocession, FormData>(reglerPrixAction, {})
  const id = `prix-${motif.id}`
  return (
    <form
      action={action}
      data-cible={motif.prix === '' ? 'sans-prix' : undefined}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-[#eef2f2] py-2.5 last:border-0"
    >
      <input type="hidden" name="motifId" value={motif.id} />
      <label htmlFor={id} className="min-w-0">
        {motif.libelle}
      </label>
      <span className="flex items-center gap-2">
        <input
          id={id}
          name="prix"
          inputMode="decimal"
          defaultValue={motif.prix}
          placeholder="—"
          className="champ chiffres h-9 w-24 rounded-full py-1 text-right"
        />
        <span>€</span>
        <button type="submit" disabled={enCours} className="h-9 rounded-full border border-[#dde9e6] bg-white px-3.5 text-sm font-semibold hover:bg-[#f5f9f8] disabled:opacity-60">
          Enregistrer
        </button>
      </span>
      <Retour etat={etat} />
    </form>
  )
}

function Retour({ etat }: { etat: EtatRetrocession }) {
  if (etat.erreur)
    return (
      <p role="alert" className="col-span-2 text-[0.8125rem] text-etat-erreur">
        {etat.erreur}
      </p>
    )
  if (etat.succes)
    return (
      <p role="status" className="col-span-2 text-[0.8125rem] text-etat-succes">
        {etat.succes}
      </p>
    )
  return null
}
