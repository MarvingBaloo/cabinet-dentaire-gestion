import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { AccesParTelephone } from '@/components/features/portail/acces-par-telephone'
import { FormulaireListeAttente } from '@/components/features/portail/formulaire-liste-attente'
import { MesInscriptionsListeAttente } from '@/components/features/portail/mes-inscriptions-liste-attente'
import { EnTetePublic } from '@/components/features/vitrine/en-tete-public'
import { PiedDePage } from '@/components/features/vitrine/pied-de-page'
import { EtatVide } from '@/components/ui/etat-vide'
import { heureCabinet } from '@/lib/dates'
import { listerMotifsPatient, listerPraticiensPublics, listerSitesPublics } from '@/server/queries/public/catalogue'
import { creneauxDisponibles } from '@/server/queries/public/creneaux'
import { NOM_COOKIE_ACCES } from '@/server/services/acces-patient'
import { inscriptionsDuPatient } from '@/server/services/inscription-liste-attente'

// Inscription à la liste d'attente (lot D, D29 ; maquette du 13/10). Le motif,
// le cabinet et le praticien arrivent en paramètres — c'est le lien posé par
// `/rendez-vous` quand aucun créneau ne convient, avec exactement ce que le
// patient vient de choisir. « Modifier » y renvoie : le choix du motif ne se
// ressaisit pas deux fois, il se fait au même endroit que pour réserver.

// Page personnelle (jeton d'accès patient) : jamais indexée (lot F, D36).
export const metadata: Metadata = { title: 'Liste d’attente', robots: { index: false } }

// La page lit un cookie (le jeton d'accès patient) : elle ne peut pas être
// rendue à l'avance.
export const dynamic = 'force-dynamic'

type Params = { site?: string; motif?: string; praticien?: string }

const jourLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Guadeloupe',
})

/** Même recherche que sur `/rendez-vous` : le libellé que le patient a lu à
 *  l'écran, pas le nom technique de l'acte (D20). */
function libelleDuMotif(
  menu: { libelle: string; motifId: string | null; enfants: { libelle: string; motifId: string }[] }[],
  motifId: string,
): string | null {
  for (const entree of menu) {
    if (entree.motifId === motifId) return entree.libelle
    const enfant = entree.enfants.find((c) => c.motifId === motifId)
    if (enfant) return enfant.libelle
  }
  return null
}

export default async function PageListeAttente({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams

  const [sites, menu, praticiens] = await Promise.all([
    listerSitesPublics(),
    listerMotifsPatient(),
    listerPraticiensPublics(),
  ])

  const site = sites.find((s) => s.id === p.site)
  const motifLibelle = p.motif ? libelleDuMotif(menu, p.motif) : null
  const praticien = p.praticien ? praticiens.find((pr) => pr.id === p.praticien) : undefined
  const jeton = (await cookies()).get(NOM_COOKIE_ACCES)?.value
  const inscriptions = jeton ? await inscriptionsDuPatient(jeton, new Date()) : null

  if (!site || !p.motif || !motifLibelle) {
    return (
      <Cadre inscriptions={inscriptions}>
        <EtatVide
          variante="filtre"
          titre="Choisissez d’abord un cabinet et un motif"
          texte="La liste d’attente se rattache à un motif précis, dans un cabinet précis."
          action={
            <Link href="/rendez-vous" className="lien-action inline-flex text-sm text-primary">
              Prendre rendez-vous
            </Link>
          }
        />
      </Cadre>
    )
  }

  // Affichage seulement (D29) : la date butoir réellement enregistrée est
  // recalculée par la Server Action au moment de l'inscription, avec les
  // mêmes paramètres — jamais celle-ci, envoyée depuis le rendu.
  let avantLeLibelle: string | null = null
  if (inscriptions) {
    const creneaux = await creneauxDisponibles({
      motifId: p.motif,
      siteId: site.id,
      ...(praticien ? { praticienId: praticien.id } : {}),
    })
    const avantLe = creneaux[0]?.debut
    avantLeLibelle = avantLe ? `${jourLong.format(avantLe)} à ${heureCabinet(avantLe)}` : null
  }

  const modifier = `/rendez-vous?site=${site.id}&motif=${p.motif}${praticien ? `&praticien=${praticien.id}` : ''}#etape-2`

  return (
    <Cadre inscriptions={inscriptions}>
      {/* L2 de maquette-liste-attente.pdf (19/10) : la demande et le numéro dans une même carte. */}
      <section aria-labelledby="titre-demande" className="carte-douce overflow-hidden">
        <div className="flex items-start justify-between gap-4 bg-[#edf6f3] px-6 py-5 sm:px-7">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">Votre demande</p>
            <h2 id="titre-demande" className="mt-1.5 font-heading text-[1.75rem] leading-tight font-extrabold">
              {motifLibelle}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {site.nom} · {praticien ? `Dr ${praticien.prenom} ${praticien.nom}` : 'peu importe le praticien'}
            </p>
          </div>
          <Link href={modifier} className="shrink-0 text-sm font-semibold text-primary hover:underline">
            Modifier
          </Link>
        </div>
        <div className="px-6 pt-5 pb-7 sm:px-7">
          <h3 className="mb-4 font-heading text-lg font-bold">Pour vous prévenir par SMS</h3>
          {jeton ? (
            <FormulaireListeAttente
              siteId={site.id}
              motifId={p.motif}
              avantLeLibelle={avantLeLibelle}
              {...(praticien ? { praticienId: praticien.id } : {})}
            />
          ) : (
            <AccesParTelephone libelleBouton="M’inscrire en liste d’attente" />
          )}
        </div>
      </section>
    </Cadre>
  )
}

const ETAPES = [
  'Votre demande : motif et cabinet',
  'Votre numéro, vérifié par un code',
  'Un SMS dès qu’une place se libère',
]

function Cadre({
  children,
  inscriptions,
}: {
  children: React.ReactNode
  inscriptions: Awaited<ReturnType<typeof inscriptionsDuPatient>> | null
}) {
  return (
    <>
      <section className="fond-v2-hexagones relative isolate">
        <EnTetePublic surCouleur />
        <div className="mx-auto max-w-[90rem] px-6 pt-36 pb-12 lg:px-20 lg:pt-40">
          <h1 className="font-heading text-[length:var(--texte-titre-2)] leading-none font-extrabold tracking-tight">
            Liste d’attente
          </h1>
          <p className="mt-3 text-encre/85">
            Un SMS vous préviendra si une place se libère pour ce motif, dans ce cabinet.
          </p>
        </div>
      </section>

      <main className="fond-hexagones">
        <div className="mx-auto max-w-[68.75rem] space-y-5 px-4 py-12 sm:px-6 lg:py-16">
          <ol className="carte-douce grid gap-4 px-6 py-5 sm:grid-cols-3 sm:px-7">
            {ETAPES.map((e, i) => (
              <li key={e} className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="hexagone grid h-8 w-7 shrink-0 place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] font-heading text-xs font-bold text-white">
                  {i + 1}
                </span>
                {e}
              </li>
            ))}
          </ol>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
            <div className="space-y-5">{children}</div>
            <aside className="space-y-5">
              {inscriptions ? <MesInscriptionsListeAttente inscriptions={inscriptions} /> : null}
              <Link href="/rendez-vous" className="lien-action inline-flex text-[0.9375rem] text-primary">
                Prendre rendez-vous
              </Link>
            </aside>
          </div>
        </div>
      </main>
      <PiedDePage simple />
    </>
  )
}
