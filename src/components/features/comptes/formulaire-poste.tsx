'use client'

import { Monitor } from 'lucide-react'
import { useActionState, useState } from 'react'

import { Message } from '@/components/ui/message'
import { cn } from '@/lib/utils'
import { nommerPosteAction, type EtatCompte } from '@/server/actions/comptes'

type Site = { id: string; code: string; nom: string }

const court = (nom: string) => nom.replace(/^Cabinet (de |d’|d')/, '')

/** Alvéole du poste : vert d'eau quand il est rattaché à un site, orangée sinon. */
export function IconePoste({ rattache }: { rattache: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'hexagone grid h-[2.75rem] w-[2.375rem] shrink-0 place-items-center',
        rattache ? 'bg-[#e4f1ee] text-[#387a70]' : 'bg-etat-alerte-fond text-etat-alerte',
      )}
    >
      <Monitor className="size-[1.125rem]" strokeWidth={1.8} />
    </span>
  )
}

/**
 * Une ligne du tableau des postes, modifiable sur place (maquette du 13/10).
 * Un `<form>` ne peut pas envelopper une ligne de tableau : les champs s'y
 * rattachent par l'attribut `form`.
 */
export function LignePoste({
  poste,
  sites,
  vuLe,
}: {
  poste: { id: string; nom: string; siteId: string | null }
  sites: Site[]
  vuLe: string
}) {
  const [etat, action, enCours] = useActionState<EtatCompte, FormData>(nommerPosteAction, {})
  // Contrôlés : React vide un formulaire après chaque action, et un `select`
  // non contrôlé revenait à « non rattaché » juste après avoir enregistré un site.
  const [nom, setNom] = useState(poste.nom)
  const [siteId, setSiteId] = useState(poste.siteId ?? '')
  const idForm = `poste-${poste.id}`
  const guadeloupe = sites.find((s) => s.id === siteId)?.code === 'GUADELOUPE'

  return (
    <>
      <tr
        data-cible={siteId ? 'poste-actif' : 'poste-actif sans-site'}
        className={cn(!(etat.erreur || etat.succes) && 'border-b border-[#eef2f2] last:border-0')}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <IconePoste rattache={!!siteId} />
            <input
              form={idForm}
              name="nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              required
              maxLength={80}
              aria-label="Nom du poste"
              className="champ max-w-72 rounded-full"
            />
          </div>
        </td>
        <td className="px-4 py-3">
          {/* `select` natif : il fonctionne sans JavaScript, sur un poste
              d'accueil dont le navigateur aurait désactivé les scripts. */}
          <select
            form={idForm}
            name="siteId"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            aria-label={`Site de ${poste.nom}`}
            className={cn(
              'champ max-w-60 rounded-full',
              guadeloupe && 'text-[#5B3FB0]',
              !siteId && 'border-[#f0d9a8] bg-[#fffaf0] text-etat-alerte',
            )}
          >
            <option value="">— non rattaché —</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {court(s.nom)}
              </option>
            ))}
          </select>
        </td>
        <td className="px-4 py-3">
          <span className="rounded-full bg-etat-succes-fond px-2.5 py-0.5 text-[0.8125rem] font-semibold text-etat-succes">
            Actif
          </span>
        </td>
        <td className="px-4 py-3">{vuLe}</td>
        <td className="px-4 py-3 text-right">
          <form id={idForm} action={action}>
            <input type="hidden" name="id" value={poste.id} />
            <button
              type="submit"
              disabled={enCours}
              className="h-9 rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8] disabled:pointer-events-none disabled:opacity-60"
            >
              Enregistrer
              <span className="sr-only"> {poste.nom}</span>
            </button>
          </form>
        </td>
      </tr>
      {etat.erreur || etat.succes ? (
        <tr className="border-b border-[#eef2f2]">
          <td colSpan={5} className="px-4 pb-3">
            {etat.erreur ? (
              <Message ton="erreur" role="alert">
                {etat.erreur}
              </Message>
            ) : (
              <Message ton="succes" role="status">
                {etat.succes}
              </Message>
            )}
          </td>
        </tr>
      ) : null}
    </>
  )
}
