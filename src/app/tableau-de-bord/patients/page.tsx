import Link from 'next/link'

import { Initiales } from '@/components/features/patients/alveoles'
import { RecherchePatients } from '@/components/features/patients/recherche-patients'
import { EtatVide } from '@/components/ui/etat-vide'
import { aujourdHuiLocal, bornesDuJour, heureCabinet } from '@/lib/dates'
import { afficherTelephone } from '@/lib/telephone'
import { exigerContexte } from '@/server/auth/session-courante'
import { patientsAttendus, rechercherPatients } from '@/server/queries/patients'

// Le fichier patients (19/10) : chercher une personne par nom, prénom ou
// téléphone, et ouvrir sa fiche. Sans recherche, les patients attendus
// aujourd'hui — ce dont on a besoin au comptoir.

export const metadata = { title: 'Patients' }

const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const dateVisite = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Guadeloupe',
})

const PASTILLE = 'rounded-full px-2.5 py-0.5 text-[0.75rem] font-semibold whitespace-nowrap'

type Ligne = {
  id: string
  prenom: string
  nom: string
  telephone: string
  dateNaissance: Date | null
  profilComplet: boolean
  reservationBloquee: boolean
  colonne: string
}

export default async function PagePatients({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await exigerContexte()
  const q = ((await searchParams).q ?? '').trim()

  const lignes: Ligne[] = q
    ? (await rechercherPatients(ctx, q)).map((p) => ({
        ...p,
        colonne: p.derniereVisite ? dateVisite.format(p.derniereVisite) : '—',
      }))
    : (await patientsAttendus(ctx, bornesDuJour(aujourdHuiLocal()))).map((p) => ({
        ...p,
        colonne: heureCabinet(p.prochain),
      }))

  return (
    <div className="max-w-(--largeur-page) space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-bold">Patients</h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            Cherchez un patient pour ouvrir sa fiche : coordonnées, rendez-vous, absences et liste d’attente.
          </p>
        </div>
        <Link
          href="/tableau-de-bord/agenda/nouveau"
          className="inline-flex h-11 items-center bouton-principal px-5 font-medium"
        >
          + Nouveau rendez-vous
        </Link>
      </header>

      <RecherchePatients valeur={q} />

      <section aria-labelledby="titre-liste" className="carte-douce px-4 py-6 sm:px-7">
        <h2 id="titre-liste" className="font-heading text-xl font-bold">
          {q
            ? `${lignes.length} patient${lignes.length > 1 ? 's' : ''} trouvé${lignes.length > 1 ? 's' : ''}`
            : 'Attendus aujourd’hui'}
        </h2>

        {lignes.length === 0 ? (
          <div className="mt-4">
            <EtatVide
              variante={q ? 'filtre' : 'jamais-rempli'}
              titre={q ? 'Aucune fiche ne correspond' : 'Personne n’est attendu aujourd’hui'}
              texte={
                q
                  ? 'Vérifiez l’orthographe, ou cherchez par numéro de téléphone.'
                  : 'Cherchez un patient ci-dessus pour ouvrir sa fiche.'
              }
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-3xl text-[0.9375rem]">
              <thead>
                <tr className="border-b border-[#eef2f2] text-left text-xs tracking-[0.1em] text-muted-foreground uppercase">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Patient
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Téléphone
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Date de naissance
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {q ? 'Dernière visite' : 'Rendez-vous'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((p) => (
                  // Safari ne fait pas d'une ligne « relative » le cadre du lien étendu : sans `translateZ`, le lien de la
                  // dernière ligne couvrait toute la page — chaque clic ouvrait ce patient, onglets compris (20/10).
                  <tr
                    key={p.id}
                    className="relative border-b border-[#eef2f2] [transform:translateZ(0)] last:border-0 hover:bg-[#f5f9f8]"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3.5">
                        <Initiales prenom={p.prenom} nom={p.nom} />
                        <div>
                          {/* Toute la ligne ouvre la fiche : le lien s'étend sur la ligne entière. */}
                          <Link
                            href={`/tableau-de-bord/patients/${p.id}`}
                            className="font-semibold after:absolute after:inset-0 hover:text-[#387a70] hover:underline"
                          >
                            {p.prenom} {p.nom}
                          </Link>
                          <span className="mt-1 flex flex-wrap gap-2 empty:hidden">
                            {p.profilComplet ? null : (
                              <span className={`${PASTILLE} bg-etat-alerte-fond text-etat-alerte`}>
                                fiche à compléter
                              </span>
                            )}
                            {p.reservationBloquee ? (
                              <span className={`${PASTILLE} bg-etat-erreur-fond text-etat-erreur`}>
                                réservation en ligne bloquée
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="chiffres px-4 py-4">{afficherTelephone(p.telephone)}</td>
                    <td className="px-4 py-4">
                      {p.dateNaissance ? (
                        date.format(p.dateNaissance)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="chiffres px-4 py-4">{p.colonne}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
