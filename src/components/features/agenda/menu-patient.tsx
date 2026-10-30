'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  type EtatMotifPatient,
  creerMotifPatientAction,
  modifierMotifPatientAction,
  supprimerMotifPatientAction,
} from '@/server/actions/motifs-patient'

// Le menu que les patients voient sur le portail, réglé par le cabinet
// (maquettes du 13/10) : une carte par entrée, en lecture ; « Modifier » ouvre
// ses formulaires. Chaque entrée porte son propre formulaire : une seule grande
// soumission obligerait à tout réenregistrer pour corriger un libellé, et
// ferait perdre le reste en cas de refus.

export type ActeDisponible = { id: string; libelle: string }

export type EntreeMenu = {
  id: string
  libelle: string
  aide: string | null
  ordre: number
  actif: boolean
  motif: { id: string; libelle: string } | null
}

export type EntreeMenuAvecEnfants = EntreeMenu & { enfants: EntreeMenu[] }

export type EntreeApercu = { id: string; libelle: string; aide: string | null }

/** Change quand le serveur renvoie l'entrée modifiée : la ligne remonte avec ses
 *  nouvelles valeurs, au lieu de champs non contrôlés dont la valeur par défaut
 *  changerait sous eux. */
const empreinte = (e: EntreeMenu) => [e.id, e.libelle, e.aide, e.ordre, e.actif, e.motif?.id].join('|')

const PASTILLE = 'inline-block shrink-0 rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold'

export function MenuPatient({
  entrees,
  actes,
  apercu,
  peutModifier,
}: {
  entrees: EntreeMenuAvecEnfants[]
  actes: ActeDisponible[]
  /** Ce que le portail montre vraiment (`listerMotifsPatient`), premier niveau. */
  apercu: EntreeApercu[]
  peutModifier: boolean
}) {
  const [ajout, setAjout] = useState(false)

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20.5rem] xl:gap-8">
      <div className="space-y-4">
        {entrees.map((e) => (
          <CarteEntree key={e.id} entree={e} actes={actes} peutModifier={peutModifier} />
        ))}

        {peutModifier ? (
          ajout ? (
            <section className="space-y-3 rounded-[1.75rem] border-2 border-dashed border-[#d3e6e1] bg-white/70 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Ajouter une entrée au premier niveau</h2>
                <button
                  type="button"
                  onClick={() => setAjout(false)}
                  className="text-sm font-semibold text-[#387a70] hover:underline"
                >
                  Fermer
                </button>
              </div>
              <Ajout actes={actes} />
            </section>
          ) : (
            <button
              type="button"
              onClick={() => setAjout(true)}
              className="h-11 rounded-full border border-[#dde9e6] bg-white px-5 text-sm font-semibold hover:bg-[#f5f9f8]"
            >
              + Ajouter une entrée
            </button>
          )
        ) : null}
      </div>

      <Apercu entrees={apercu} />
    </div>
  )
}

function CarteEntree({
  entree,
  actes,
  peutModifier,
}: {
  entree: EntreeMenuAvecEnfants
  actes: ActeDisponible[]
  peutModifier: boolean
}) {
  const [edition, setEdition] = useState(false)
  const estMenu = entree.enfants.length > 0

  return (
    <section
      data-cible={!estMenu && entree.actif && !entree.motif ? 'entree sans-acte' : 'entree'}
      className="carte-douce px-6 py-5 sm:px-7"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className={cn('font-heading text-xl font-bold', !entree.actif && 'text-muted-foreground')}>
            {entree.libelle}
          </h2>
          {entree.aide ? <p className="mt-0.5 text-sm text-muted-foreground">{entree.aide}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {!entree.actif ? (
            <span className={cn(PASTILLE, 'bg-secondary text-muted-foreground')}>masquée du site</span>
          ) : null}
          {estMenu ? null : entree.motif ? (
            <span className={cn(PASTILLE, 'bg-etat-succes-fond text-etat-succes')}>acte : {entree.motif.libelle}</span>
          ) : (
            <span className={cn(PASTILLE, 'bg-etat-alerte-fond text-etat-alerte')}>
              aucun acte rattaché · non proposé
            </span>
          )}
          {peutModifier ? (
            <button
              type="button"
              aria-expanded={edition}
              onClick={() => setEdition((v) => !v)}
              className="text-sm font-semibold text-[#387a70] underline-offset-4 hover:underline"
            >
              {edition ? 'Terminer' : 'Modifier'}
            </button>
          ) : null}
        </div>
      </div>

      {edition ? (
        <div className="mt-5 space-y-5 border-t border-border pt-5">
          <Ligne key={empreinte(entree)} entree={entree} actes={actes} estMenu={estMenu} />
          {entree.enfants.map((c) => (
            <div key={c.id} className="border-l-2 border-[#d3e6e1] pl-4">
              <Ligne key={empreinte(c)} entree={c} actes={actes} estMenu={false} />
            </div>
          ))}
          <details className="pl-4">
            <summary className="cursor-pointer text-sm font-semibold text-[#387a70]">
              + Ajouter un choix sous « {entree.libelle} »
              {entree.motif && !estMenu ? ' — l’entrée deviendra une liste, son acte ne servira plus' : ''}
            </summary>
            <div className="mt-3">
              <Ajout parentId={entree.id} actes={actes} />
            </div>
          </details>
        </div>
      ) : estMenu ? (
        <ul className="mt-3">
          {entree.enfants.map((c) => (
            <li
              key={c.id}
              data-cible={c.actif && !c.motif ? 'sans-acte' : undefined}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 border-t border-border py-2.5 text-[0.9375rem] sm:grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)]"
            >
              <span aria-hidden className="text-muted-foreground">
                └
              </span>
              <span className={cn('font-medium', !c.actif && 'text-muted-foreground')}>{c.libelle}</span>
              {/* Sur téléphone, l'acte passe sous le libellé : à trois colonnes il s'écrasait mot par mot. */}
              <span className="col-start-2 text-sm text-muted-foreground sm:col-start-auto">
                {!c.actif ? (
                  <span className={cn(PASTILLE, 'bg-secondary text-muted-foreground')}>masqué du site</span>
                ) : c.motif ? (
                  <>→ {c.motif.libelle}</>
                ) : (
                  <span className={cn(PASTILLE, 'bg-etat-alerte-fond text-etat-alerte')}>
                    aucun acte rattaché · non proposé
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** Aperçu de ce que lit le patient sur un téléphone : le premier écran du parcours. */
function Apercu({ entrees }: { entrees: EntreeApercu[] }) {
  return (
    <aside aria-label="Aperçu patient" className="self-start xl:sticky xl:top-8">
      <p className="text-center text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        Aperçu patient
      </p>
      <div className="mt-4 rounded-[2.5rem] border-[12px] border-marine bg-background px-4 pt-10 pb-12">
        <p className="px-1 font-heading text-[1.375rem] leading-tight font-semibold">Prendre rendez-vous</p>
        <p className="mt-1 px-1 text-[0.8125rem] text-muted-foreground">Pour quelle raison venez-vous ?</p>
        <ul className="mt-5 space-y-3">
          {entrees.map((e) => (
            <li key={e.id} className="rounded-2xl border border-[#e0ebe8] bg-white px-4 py-3">
              <p className="text-[0.9375rem] font-semibold">{e.libelle}</p>
              {e.aide ? <p className="mt-1 text-xs text-muted-foreground">{e.aide}</p> : null}
            </li>
          ))}
          {entrees.length === 0 ? (
            <li className="text-sm text-muted-foreground">Aucune entrée proposée pour l’instant.</li>
          ) : null}
        </ul>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Les entrées sans acte rattaché n’apparaissent pas ici.
      </p>
    </aside>
  )
}

function Message({ etat }: { etat: EtatMotifPatient }) {
  if (etat.erreur) {
    return (
      <p role="alert" className="text-sm text-etat-erreur">
        {etat.erreur}
      </p>
    )
  }
  if (etat.succes) {
    return (
      <p role="status" className="text-sm text-etat-succes">
        {etat.succes}
      </p>
    )
  }
  return null
}

function ChoixActe({
  actes,
  defaut,
  id,
}: {
  actes: ActeDisponible[]
  /** `undefined` est ici une valeur possible, pas une absence de propriété. */
  defaut?: string | undefined
  id: string
}) {
  return (
    <select id={id} name="motifId" defaultValue={defaut ?? ''} className="champ rounded-full">
      {/* Sans acte, pas de durée : l'entrée existe mais le portail ne la montre
          pas. C'est ce que dit l'option, plutôt qu'un « — » muet. */}
      <option value="">Aucun — ouvre une liste, ou reste masqué</option>
      {actes.map((a) => (
        <option key={a.id} value={a.id}>
          {a.libelle}
        </option>
      ))}
    </select>
  )
}

function Ligne({ entree, actes, estMenu }: { entree: EntreeMenu; actes: ActeDisponible[]; estMenu: boolean }) {
  const [etat, action] = useActionState<EtatMotifPatient, FormData>(modifierMotifPatientAction, {})
  const [etatSuppression, actionSuppression] = useActionState<EtatMotifPatient, FormData>(
    supprimerMotifPatientAction,
    {},
  )

  return (
    <div className="space-y-2">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_5rem]">
        <input type="hidden" name="id" value={entree.id} />

        <div className="space-y-1.5">
          <Label htmlFor={`libelle-${entree.id}`}>Ce que le patient lit</Label>
          <Input id={`libelle-${entree.id}`} name="libelle" defaultValue={entree.libelle} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`acte-${entree.id}`}>Acte à l’agenda</Label>
          <ChoixActe id={`acte-${entree.id}`} actes={actes} defaut={entree.motif?.id} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`ordre-${entree.id}`}>Ordre</Label>
          <Input id={`ordre-${entree.id}`} name="ordre" type="number" min={0} step={10} defaultValue={entree.ordre} />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`aide-${entree.id}`}>Précision sous le libellé (facultatif)</Label>
          <Input
            id={`aide-${entree.id}`}
            name="aide"
            defaultValue={entree.aide ?? ''}
            maxLength={200}
            placeholder="Douleur, dent cassée, gonflement."
          />
        </div>

        <div className="flex items-end">
          <input type="hidden" name="actif" value={entree.actif ? 'oui' : 'non'} />
          <Button type="submit" variant="secondary">
            Enregistrer
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <form action={action} className="contents">
          <input type="hidden" name="id" value={entree.id} />
          <input type="hidden" name="actif" value={entree.actif ? 'non' : 'oui'} />
          <button type="submit" className="text-muted-foreground underline hover:text-foreground">
            {entree.actif ? 'Masquer du site' : 'Remettre sur le site'}
          </button>
        </form>

        {estMenu ? null : (
          <form action={actionSuppression} className="contents">
            <input type="hidden" name="id" value={entree.id} />
            <button type="submit" className="text-muted-foreground underline hover:text-etat-erreur">
              Retirer
            </button>
          </form>
        )}
      </div>

      <Message etat={etat} />
      <Message etat={etatSuppression} />
    </div>
  )
}

function Ajout({ parentId, actes }: { parentId?: string; actes: ActeDisponible[] }) {
  const [etat, action] = useActionState<EtatMotifPatient, FormData>(creerMotifPatientAction, {})
  const cle = `${parentId ?? 'racine'}-${etat.succes ?? ''}`

  return (
    <form key={cle} action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_5rem_auto] sm:items-end">
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor={`nouveau-libelle-${cle}`}>Ce que le patient lira</Label>
        <Input id={`nouveau-libelle-${cle}`} name="libelle" required placeholder="Une dent" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`nouvel-acte-${cle}`}>Acte à l’agenda</Label>
        <ChoixActe id={`nouvel-acte-${cle}`} actes={actes} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`nouvel-ordre-${cle}`}>Ordre</Label>
        <Input id={`nouvel-ordre-${cle}`} name="ordre" type="number" min={0} step={10} defaultValue={0} />
      </div>

      <Button type="submit">Ajouter</Button>

      <div className="sm:col-span-4">
        <Message etat={etat} />
      </div>
    </form>
  )
}
