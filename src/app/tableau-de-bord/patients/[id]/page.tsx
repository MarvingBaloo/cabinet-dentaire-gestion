import { Globe, Hourglass, Phone } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { heureCabinet, jourLocal } from '@/lib/dates'
import { Initiales, TitreAlveole } from '@/components/features/patients/alveoles'
import { CoordonneesPatient } from '@/components/features/patients/coordonnees-patient'
import { LIBELLE_STATUT, TEINTE_STATUT } from '@/lib/statuts'
import { cn } from '@/lib/utils'
import { exigerContexte } from '@/server/auth/session-courante'
import { SEUIL_MANQUEMENTS } from '@/server/domaine/agenda'
import { lireFichePatient } from '@/server/queries/patients'

// La fiche d'un patient (19/10) : ce que la secrétaire doit pouvoir dire au
// téléphone — quand est son prochain rendez-vous, quand est-il venu, combien de
// fois il a manqué — et d'où elle peut lui poser le suivant. Ses rendez-vous
// sont ceux des cabinets de l'appelant (D5).

const FUSEAU = 'America/Guadeloupe'
const jourLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: FUSEAU })
const jourCourt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: FUSEAU,
})
const dateNaissance = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const nomCourt = (nom: string) => nom.replace(/^Cabinet (de |d’|d')/, '')

const PASTILLE = 'rounded-full px-3 py-0.5 text-[0.8125rem] font-semibold whitespace-nowrap'

function age(naissance: Date, aujourdHui: string): number {
  const [a, m, j] = aujourdHui.split('-').map(Number) as [number, number, number]
  let ans = a - naissance.getUTCFullYear()
  if (m < naissance.getUTCMonth() + 1 || (m === naissance.getUTCMonth() + 1 && j < naissance.getUTCDate())) ans -= 1
  return ans
}

export async function generateMetadata() {
  return { title: 'Fiche patient' }
}

export default async function PageFichePatient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const ctx = await exigerContexte()
  const fiche = await lireFichePatient(ctx, id)
  if (!fiche) notFound()

  const { patient, rendezVous, inscriptions } = fiche
  const maintenant = new Date()
  // À venir : pas encore fini ET pas déjà soldé — un soin terminé ce matin à 8 h appartient à l'historique.
  const aVenir = rendezVous
    .filter((r) => r.fin >= maintenant && !['ANNULE', 'ABSENT', 'TERMINE', 'EN_CAISSE'].includes(r.statut))
    .reverse()
  const passes = rendezVous.filter((r) => !aVenir.includes(r))
  const venus = passes.filter((r) => r.statut === 'TERMINE' || r.statut === 'EN_CAISSE')
  const peutDebloquer = ctx.permissions.has('patient:debloquer')

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <div>
        <Link href="/tableau-de-bord/patients" className="text-sm font-semibold text-[#387a70] hover:underline">
          ← Patients
        </Link>
        <header className="mt-4 carte-douce flex flex-wrap items-center justify-between gap-6 px-6 py-6 sm:px-8">
          <div className="flex items-center gap-5 sm:gap-6">
            <Initiales prenom={patient.prenom} nom={patient.nom} grand />
            <div>
              <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-extrabold">
                {patient.prenom} {patient.nom}
              </h1>
              <p className="mt-2 text-muted-foreground">
                {patient.dateNaissance
                  ? `${age(patient.dateNaissance, jourLocal(maintenant))} ans · né(e) le ${dateNaissance.format(patient.dateNaissance)}`
                  : 'Date de naissance à renseigner'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {patient.profilComplet ? null : (
                  <span className={`${PASTILLE} bg-etat-alerte-fond text-etat-alerte`}>Fiche à compléter</span>
                )}
                {patient.reservationBloquee ? (
                  <span className={`${PASTILLE} bg-etat-erreur-fond text-etat-erreur`}>
                    Réservation en ligne bloquée
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={`tel:${patient.telephone.replace(/\s/g, '')}`}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[#dde9e6] bg-white px-5 font-semibold hover:bg-[#f5f9f8]"
            >
              <Phone aria-hidden className="size-4" /> Appeler
            </a>
            <Link
              href={`/tableau-de-bord/agenda/nouveau?q=${encodeURIComponent(patient.telephone)}`}
              className="inline-flex h-11 items-center bouton-principal px-5 font-semibold"
            >
              + Nouveau rendez-vous
            </Link>
          </div>
        </header>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23.75rem]">
        {/* min-w-0 : sans lui, le tableau de l'historique élargit la colonne sur téléphone. */}
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="titre-a-venir" className="carte-douce px-5 py-6 sm:px-7">
            <h2 id="titre-a-venir" className="font-heading text-xl font-bold">
              Rendez-vous à venir
            </h2>
            {aVenir.length === 0 ? (
              <p className="mt-3 text-muted-foreground">Aucun rendez-vous à venir.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {aVenir.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/tableau-de-bord/agenda?date=${jourLocal(r.debut)}&rdv=${r.id}`}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-l-4 px-5 py-4 hover:brightness-[0.98]"
                      style={{
                        borderColor: r.praticien.couleur,
                        backgroundColor: `color-mix(in oklch, ${r.praticien.couleur} 7%, white)`,
                      }}
                    >
                      <span>
                        <span className="block font-heading text-lg font-bold">
                          {majuscule(jourLong.format(r.debut))} · {heureCabinet(r.debut)}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {r.motif.libelle} · Dr {r.praticien.prenom} {r.praticien.nom} · {nomCourt(r.site.nom)}
                        </span>
                      </span>
                      <span className={cn(PASTILLE, TEINTE_STATUT[r.statut])}>{LIBELLE_STATUT[r.statut]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="titre-historique" className="carte-douce px-5 py-6 sm:px-7">
            <h2 id="titre-historique" className="font-heading text-xl font-bold">
              Historique
              <span className="ml-3 text-sm font-normal text-muted-foreground">
                {venus.length} visite{venus.length > 1 ? 's' : ''}
              </span>
            </h2>
            {passes.length === 0 ? (
              <p className="mt-3 text-muted-foreground">Aucun rendez-vous passé dans vos cabinets.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-2xl text-[0.9375rem]">
                  <thead>
                    <tr className="border-b border-[#eef2f2] text-left text-xs tracking-[0.1em] text-muted-foreground uppercase">
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Date
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Acte
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Praticien
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Statut
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {passes.map((r) => (
                      <tr key={r.id} className="border-b border-[#eef2f2] last:border-0">
                        <td className="chiffres px-4 py-3 whitespace-nowrap">
                          {jourCourt.format(r.debut)} · {heureCabinet(r.debut)}
                        </td>
                        <td className="px-4 py-3">{r.motif.libelle}</td>
                        <td className="px-4 py-3 text-muted-foreground">Dr {r.praticien.nom}</td>
                        <td className="px-4 py-3">
                          <span className={cn(PASTILLE, TEINTE_STATUT[r.statut])}>{LIBELLE_STATUT[r.statut]}</span>
                          {r.manquementCompte ? (
                            <span className="ml-2 text-[0.8125rem] text-etat-alerte">compté</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <CoordonneesPatient
            peutModifier={ctx.permissions.has('patient:update')}
            patient={{
              id: patient.id,
              nom: patient.nom,
              prenom: patient.prenom,
              telephone: patient.telephone,
              dateNaissance: patient.dateNaissance ? patient.dateNaissance.toISOString().slice(0, 10) : '',
              email: patient.email ?? '',
              representantLegal: patient.representantLegal ?? '',
              telephoneRepresentant: patient.telephoneRepresentant ?? '',
              creeLe: jourCourt.format(patient.createdAt),
            }}
          />

          <section aria-labelledby="titre-reservation" className="carte-douce px-6 py-6 sm:px-7">
            <div className="flex items-center justify-between gap-3">
              <TitreAlveole id="titre-reservation" icone={Globe}>
                Réservation en ligne
              </TitreAlveole>
              <span
                className={cn(
                  PASTILLE,
                  patient.reservationBloquee
                    ? 'bg-etat-erreur-fond text-etat-erreur'
                    : 'bg-etat-succes-fond text-etat-succes',
                )}
              >
                {patient.reservationBloquee ? 'Bloquée' : 'Ouverte'}
              </span>
            </div>
            {patient.reservationBloquee ? (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  {patient.manquements} absences ou annulations : à partir de {SEUIL_MANQUEMENTS}, le site ne propose
                  plus de créneaux. Au comptoir et au téléphone, le rendez-vous reste possible.
                </p>
                {peutDebloquer ? (
                  <Link
                    href="/tableau-de-bord/patients/bloques"
                    className="lien-action mt-3 inline-flex text-sm text-[#387a70]"
                  >
                    Débloquer
                  </Link>
                ) : null}
              </>
            ) : (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  {patient.manquements === 0
                    ? 'Aucune absence ni annulation comptée.'
                    : `${patient.manquements} absence${patient.manquements > 1 ? 's' : ''} ou annulation${patient.manquements > 1 ? 's' : ''} comptée${patient.manquements > 1 ? 's' : ''} sur ${SEUIL_MANQUEMENTS} avant blocage.`}
                </p>
              </>
            )}
          </section>

          <section aria-labelledby="titre-attente" className="carte-douce px-6 py-6 sm:px-7">
            <TitreAlveole id="titre-attente" icone={Hourglass}>
              Liste d’attente
            </TitreAlveole>
            {inscriptions.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">Aucune inscription.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[#eef2f2]">
                {inscriptions.map((i) => (
                  <li key={i.id} className="py-3 text-sm">
                    <p className="font-semibold">{i.motif.libelle}</p>
                    <p className="text-muted-foreground">
                      {nomCourt(i.site.nom)} · {i.praticien ? `Dr ${i.praticien.nom}` : 'peu importe le praticien'}
                      {i.avantLe ? ` · avant le ${jourCourt.format(i.avantLe)}` : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
