import { MessageCircleMore } from 'lucide-react'

import { EtatVide } from '@/components/ui/etat-vide'
import { cn } from '@/lib/utils'
import { exigerContexte } from '@/server/auth/session-courante'
import { lireListeAttente } from '@/server/queries/agenda'

const jour = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Guadeloupe',
})
const jourCourt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'America/Guadeloupe' })

// Vue en lecture seule pour le personnel (lot D, D29 ; maquette L3 du 20/10) : qui
// attend quoi, une colonne par motif, dans l'ordre d'inscription — sans pouvoir
// agir depuis cet écran : inscrire ou désinscrire reste un geste du patient,
// depuis son accès personnel (D23).
export default async function PageListeAttente() {
  const ctx = await exigerContexte()
  const inscriptions = await lireListeAttente(ctx)

  // `lireListeAttente` rend les inscriptions de la plus ancienne à la plus récente : l'ordre se garde dans chaque motif.
  const parMotif = new Map<string, typeof inscriptions>()
  for (const i of inscriptions) parMotif.set(i.motif.libelle, [...(parMotif.get(i.motif.libelle) ?? []), i])

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <header>
        <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-extrabold">
          Liste d’attente
        </h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Les patients inscrits sont prévenus par SMS dès qu’un créneau correspondant se libère. Rien à faire ici :
          l’inscription et la désinscription se font depuis l’accès patient.
        </p>
      </header>

      <aside className="carte-douce flex items-center gap-4 px-5 py-5 text-[0.9375rem] sm:px-7">
        <span
          aria-hidden
          className="hexagone grid h-[3.25rem] w-[2.875rem] shrink-0 place-items-center bg-[#e4f1ee] text-[#387a70]"
        >
          <MessageCircleMore className="size-5" strokeWidth={1.7} />
        </span>
        <p>
          Quand un créneau se libère, les cinq premiers inscrits compatibles reçoivent un SMS avec un lien : le premier
          qui réserve l’obtient. Aucun SMS ne part entre 21 h et 8 h ; ils partent à 8 h si le créneau est encore libre.
        </p>
      </aside>

      {inscriptions.length === 0 ? (
        <EtatVide
          variante="jamais-rempli"
          titre="Personne n’attend de créneau"
          texte="Dès qu’un patient s’inscrit sur un motif complet, il apparaît ici."
        />
      ) : (
        <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[...parMotif].map(([motif, liste]) => (
            <section key={motif} aria-label={motif} className="carte-douce overflow-hidden">
              <div className="fond-v2-uni flex items-center justify-between gap-3 px-5 py-4">
                <h2 className="font-heading text-xl font-extrabold">{motif}</h2>
                <span className="rounded-full bg-white/60 px-3 py-0.5 text-[0.8125rem] font-semibold whitespace-nowrap">
                  {liste.length} en attente
                </span>
              </div>
              <ol className="divide-y divide-[#eef2f2] px-5 pt-2 pb-3">
                {liste.map((i, rang) => (
                  <li key={i.id} className="flex gap-3.5 py-3.5">
                    <span
                      aria-label={`${rang + 1}ᵉ inscrit`}
                      className={cn(
                        'hexagone grid h-[2.375rem] w-[2.125rem] shrink-0 place-items-center font-heading text-[0.9375rem] font-extrabold',
                        rang === 0
                          ? 'bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white'
                          : 'bg-[#e4f1ee] text-[#387a70]',
                      )}
                    >
                      {rang + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        {i.patients.length > 0 ? (
                          <p className="font-semibold">{i.patients.join(' / ')}</p>
                        ) : (
                          <p className="text-muted-foreground">Sans fiche au cabinet</p>
                        )}
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold whitespace-nowrap',
                            i.site.code === 'GUADELOUPE'
                              ? 'bg-[#EFEAFB] text-[#5B3FB0]'
                              : 'bg-[#e4f1ee] text-[#387a70]',
                          )}
                        >
                          {i.site.nom.replace(/^Cabinet (de |d’|d')/, '')}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {i.praticien ? `Dr ${i.praticien.prenom} ${i.praticien.nom}` : 'Peu importe le praticien'}
                      </p>
                      <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
                        Inscrit le {jourCourt.format(i.createdAt)}
                        {i.avantLe ? (
                          <>
                            {' · '}
                            <span className="font-semibold text-etat-alerte">avant le {jour.format(i.avantLe)}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
