'use client'

import type { NiveauUrgence } from '@prisma/client'
import { Phone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { NIVEAU_URGENCE } from '@/lib/niveaux-urgence'
import { marquerDemandeUrgenceTraiteeAction } from '@/server/actions/agenda'

export type DemandeUrgenceVue = {
  id: string
  niveau: NiveauUrgence | null
  patient: string
  telephone: string
  telephoneLien: string
  quand: string
  resume: string[]
}

/**
 * En tête de l'accueil (D79) : les patients que l'assistant des urgences n'a pas pu placer dans le délai. Le cabinet
 * les rappelle ; le praticien peut prendre une urgence par-dessus un planning plein (Q19).
 */
export function DemandesUrgence({ demandes, peutTraiter }: { demandes: DemandeUrgenceVue[]; peutTraiter: boolean }) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [erreur, setErreur] = useState<string | null>(null)
  if (demandes.length === 0) return null
  return (
    <section
      aria-label="Urgences à rappeler"
      className="rounded-[1.75rem] border-[1.5px] border-[#f3c9a8] bg-[#fff7f0] px-5 py-5 sm:px-8 sm:py-6"
    >
      <h2 className="flex items-center gap-2.5 font-heading text-xl font-bold text-[#9a3412]">
        <span aria-hidden className="hexagone grid size-[26px] place-items-center bg-[#c2410c] text-xs text-white">
          IA
        </span>
        Urgences à rappeler · {demandes.length}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        L’assistant n’a trouvé aucune place dans le délai : il a promis que le cabinet rappellerait dès l’ouverture.
      </p>
      <ul className="mt-4 grid gap-3 lg:grid-cols-2">
        {demandes.map((d) => {
          const n = d.niveau ? NIVEAU_URGENCE[d.niveau] : null
          return (
            <li key={d.id} className="rounded-2xl border border-[#f1dccb] bg-white px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{d.patient}</p>
                {n ? (
                  <span className="rounded-full px-2 py-0.5 text-[0.6875rem] font-bold text-white" style={{ background: n.couleur }}>
                    {n.libelle}
                    {n.delai ? ` · ${n.delai}` : ''}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">transmise {d.quand}</span>
              </div>
              {d.resume.length ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[0.875rem]">
                  {d.resume.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <a href={`tel:${d.telephoneLien}`} className="inline-flex items-center gap-2 font-semibold text-[#387a70] hover:underline">
                  <Phone aria-hidden className="size-4" />
                  <span className="chiffres">{d.telephone}</span>
                </a>
                {peutTraiter ? (
                  <button
                    type="button"
                    disabled={enCours}
                    onClick={() =>
                      demarrer(async () => {
                        const r = await marquerDemandeUrgenceTraiteeAction(d.id)
                        if (r.erreur) setErreur(r.erreur)
                        else router.refresh()
                      })
                    }
                    className="ml-auto rounded-full border border-border px-3.5 py-1.5 text-sm font-semibold hover:border-[#387a70]"
                  >
                    Rappelé ✓
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {erreur ? (
        <p role="alert" className="mt-3 text-sm text-etat-erreur">
          {erreur}
        </p>
      ) : null}
    </section>
  )
}
