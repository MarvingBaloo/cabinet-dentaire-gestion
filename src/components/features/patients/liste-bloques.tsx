'use client'

import { Info } from 'lucide-react'
import { useActionState } from 'react'

import { Message } from '@/components/ui/message'
import { EtatVide } from '@/components/ui/etat-vide'
import { type EtatPatient, debloquerPatientAction } from '@/server/actions/patients'

// ⚠ L'état vit ICI et non sur chaque bouton, et ce n'est pas un détail de
// structure : débloquer fait disparaître la ligne de la liste (la page est
// revalidée), donc un message porté par le bouton serait démonté à la seconde
// où il aurait quelque chose à dire. L'administrateur voyait la ligne s'évaporer
// sans la moindre confirmation. Constaté au navigateur, jamais par les tests.

type Bloque = {
  id: string
  nom: string
  prenom: string
  telephone: string
  absences: number
  annulations: number
  dernier: { debut: Date; statut: string } | null
  bloqueDepuis: Date | null
}

const jourMois = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'America/Guadeloupe' })
const jourComplet = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Guadeloupe',
})

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

function manquements(p: Bloque): string {
  return [
    p.absences ? pluriel(p.absences, 'absence') : null,
    p.annulations ? pluriel(p.annulations, 'annulation') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function dernier(p: Bloque): string | null {
  if (!p.dernier) return null
  const date = jourMois.format(p.dernier.debut)
  return p.dernier.statut === 'ABSENT'
    ? `dernier : absent le ${date}`
    : `dernière : annulation du rendez-vous du ${date}`
}

export function ListeBloques({ patients, peutDebloquer }: { patients: Bloque[]; peutDebloquer: boolean }) {
  const [etat, action, enCours] = useActionState<EtatPatient, FormData>(debloquerPatientAction, {})
  const n = patients.length

  return (
    <div className="max-w-(--largeur-page) space-y-8">
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

      {n === 0 ? (
        <EtatVide
          variante="jamais-rempli"
          titre="Aucun patient bloqué"
          texte="Trois rendez-vous annulés ou non honorés bloquent la réservation en ligne — personne n’est concerné pour l’instant."
        />
      ) : (
        <section className="carte-douce px-5 py-6 sm:px-7">
          <h2 className="font-heading text-xl font-bold">
            {n} patient{n > 1 ? 's bloqués' : ' bloqué'}
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-3xl text-[0.9375rem]">
              <thead>
                <tr className="border-b border-[#eef2f2] text-left text-xs tracking-[0.1em] text-muted-foreground uppercase">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Patient
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Manquements
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Bloqué depuis
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => (
                  <tr key={p.id} data-cible="bloque" className="border-b border-[#eef2f2]">
                    <td className="px-4 py-4 align-top">
                      <p className="font-medium">
                        {p.prenom} {p.nom}
                      </p>
                      <p className="text-[0.8125rem] text-muted-foreground">{p.telephone}</p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <p>{manquements(p) || '—'}</p>
                      {dernier(p) ? <p className="text-[0.8125rem] text-muted-foreground">{dernier(p)}</p> : null}
                    </td>
                    <td className="px-4 py-4 align-top">
                      {p.bloqueDepuis ? (
                        jourComplet.format(p.bloqueDepuis)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4 align-top">
                      {peutDebloquer ? (
                        <form action={action}>
                          <input type="hidden" name="id" value={p.id} />
                          <button
                            type="submit"
                            disabled={enCours}
                            className="h-9 rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8] disabled:pointer-events-none disabled:opacity-60"
                          >
                            {enCours ? 'Déblocage…' : 'Débloquer'}
                            <span className="sr-only">
                              {' '}
                              {p.prenom} {p.nom}
                            </span>
                          </button>
                        </form>
                      ) : (
                        // Le bouton est absent, pas désactivé : un bouton grisé laisse
                        // croire que le geste viendra, alors qu'il ne viendra jamais pour
                        // ce rôle. Le service refuserait de toute façon (D4).
                        <p className="pt-1.5 text-sm text-muted-foreground">Déblocage par un administrateur</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <aside className="carte-douce flex items-center gap-4 px-5 py-5 text-[0.9375rem] sm:px-6">
        <span
          aria-hidden
          className="hexagone grid h-[2.75rem] w-[2.375rem] shrink-0 place-items-center bg-[#e4f1ee] text-[#387a70]"
        >
          <Info className="size-[1.125rem]" strokeWidth={1.8} />
        </span>
        <p>
          Une annulation faite par le patient, même prévenante, compte autant qu’une absence ; celle faite par le
          cabinet ne compte pas. Le compteur ne se remet à zéro qu’en débloquant.
        </p>
      </aside>
    </div>
  )
}
