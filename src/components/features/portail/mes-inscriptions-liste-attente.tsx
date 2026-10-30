'use client'

import { useActionState } from 'react'

import { Message } from '@/components/ui/message'
import { nomCourtCabinet } from '@/lib/jours-publics'
import { type EtatDesinscriptionListeAttente, desinscrireListeAttenteAction } from '@/server/actions/liste-attente'

// Liste des inscriptions du patient, avec désinscription (lot D, D29) — dans
// l'accès patient, comme « mes rendez-vous » (D23).

type InscriptionListeAttente = {
  id: string
  avantLe: Date | null
  motif: { libelle: string }
  site: { nom: string }
  praticien: { nom: string; prenom: string } | null
}

const jourLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Guadeloupe',
})

export function MesInscriptionsListeAttente({ inscriptions }: { inscriptions: InscriptionListeAttente[] }) {
  const [etat, action, enCours] = useActionState<EtatDesinscriptionListeAttente, FormData>(
    desinscrireListeAttenteAction,
    {},
  )

  if (inscriptions.length === 0 && !etat.succes) return null

  return (
    <section
      id="liste-attente"
      aria-labelledby="titre-inscriptions"
      className="carte-douce scroll-mt-8 px-7 py-8"
    >
      <h2 id="titre-inscriptions" className="font-heading text-xl font-semibold">
        Mes inscriptions
      </h2>

      {etat.erreur ? (
        <Message ton="erreur" role="alert" className="mt-4">
          {etat.erreur}
        </Message>
      ) : null}
      {etat.succes ? (
        <Message ton="succes" role="status" className="mt-4">
          {etat.succes}
        </Message>
      ) : null}

      <ul className="mt-2 divide-y divide-border">
        {inscriptions.map((i) => (
          <li key={i.id} className="py-5">
            <p className="font-medium">{i.motif.libelle}</p>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              {nomCourtCabinet(i.site.nom)} ·{' '}
              {i.praticien ? `Dr ${i.praticien.prenom} ${i.praticien.nom}` : 'peu importe le praticien'}
            </p>
            {i.avantLe ? (
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">avant le {jourLong.format(i.avantLe)}</p>
            ) : null}
            <form action={action} className="mt-3">
              <input type="hidden" name="id" value={i.id} />
              <button
                type="submit"
                disabled={enCours}
                className="text-sm text-etat-erreur hover:underline disabled:pointer-events-none disabled:opacity-60"
              >
                Se désinscrire
                <span className="sr-only"> de « {i.motif.libelle} »</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  )
}
