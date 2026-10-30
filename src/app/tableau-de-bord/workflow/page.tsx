import { FicheRendezVousProvider } from '@/components/features/agenda/panneau-rendez-vous'
import { LigneWorkflow } from '@/components/features/workflow/ligne-workflow'
import { Message } from '@/components/ui/message'
import { FUSEAU_CABINET, aujourdHuiLocal, bornesDuJour, heureCabinet } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { COLONNES_LIGNE, ETAPES, STATUTS_DU_PARCOURS } from '@/lib/workflow'
import { hasPermission } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { lireCabinetChoisi } from '@/server/cabinet-choisi'
import { listerRendezVous } from '@/server/queries/agenda'

// Le Workflow (Marving, 27/10) : le parcours des patients du jour, dans le cabinet choisi — attendus, salle
// d'attente, au fauteuil, terminé, en caisse. Une ligne par patient, dans l'ordre des heures, matin et après-midi
// séparés (direction B, 30/10, `docs/maquettes/maquette-workflow.pdf`). Chaque ligne avance d'un clic, et chaque
// écran ouvert suit en direct (D61). Le praticien n'y voit que ses patients (filtre de la DAL), la secrétaire tous.

export const metadata = { title: 'Workflow' }

const dateDuJour = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export default async function PageWorkflow() {
  const ctx = await exigerContexte()
  const { choisi } = await lireCabinetChoisi(ctx)
  if (!choisi) {
    return <Message ton="alerte">Votre compte n’est rattaché à aucun cabinet. Voyez un administrateur.</Message>
  }

  const jour = aujourdHuiLocal()
  const tous = await listerRendezVous(ctx, bornesDuJour(jour), { siteId: choisi.id })
  const rendezVous = tous.filter((r) => STATUTS_DU_PARCOURS.includes(r.statut))
  const peutAgir = hasPermission(ctx, 'agenda', 'update')
  const signature = tous.map((r) => `${r.id}:${r.statut}:${r.debut.getTime()}`).join('|')
  const date = dateDuJour.format(bornesDuJour(jour).debut)
  const demiJournees = [
    { titre: 'Matin', liste: rendezVous.filter((r) => heureCabinet(r.debut) < '13:00') },
    { titre: 'Après-midi', liste: rendezVous.filter((r) => heureCabinet(r.debut) >= '13:00') },
  ].filter((d) => d.liste.length > 0)

  return (
    <FicheRendezVousProvider signature={signature}>
      <div className="space-y-6">
        <header>
          <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-bold">Workflow</h1>
          <p className="mt-2 text-muted-foreground">
            {date.charAt(0).toUpperCase() + date.slice(1)} · {choisi.nom}
          </p>
        </header>

        {demiJournees.length === 0 ? (
          <Message ton="info">Aucun patient attendu aujourd’hui dans ce cabinet.</Message>
        ) : (
          <div className="space-y-2">
            {/* Les étapes, nommées une fois au-dessus des fils. */}
            <div aria-hidden className={cn('hidden gap-x-3.5 px-[1.0625rem] lg:grid', COLONNES_LIGNE)}>
              <span className="col-start-4 flex">
                {ETAPES.map((e) => (
                  <span
                    key={e}
                    className="w-[5.25rem] text-center text-[0.6875rem] whitespace-nowrap font-bold text-muted-foreground"
                  >
                    {e}
                  </span>
                ))}
              </span>
            </div>
            {demiJournees.map((d) => (
              <section key={d.titre} aria-label={d.titre} className="space-y-1.5">
                <h2 className="px-1 pt-2 text-[0.75rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                  {d.titre}
                </h2>
                <ul className="space-y-1">
                  {d.liste.map((r) => (
                    <LigneWorkflow
                      key={r.id}
                      id={r.id}
                      statut={r.statut}
                      couleur={r.praticien.couleur}
                      heure={heureCabinet(r.debut)}
                      patient={`${r.patient.prenom} ${r.patient.nom}`}
                      detail={`${r.motif.libelle} · Dr ${r.praticien.nom} · ${r.fauteuil.nom}`}
                      peutAgir={peutAgir}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </FicheRendezVousProvider>
  )
}
