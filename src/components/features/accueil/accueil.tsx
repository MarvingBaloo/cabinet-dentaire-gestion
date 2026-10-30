import { StatutRendezVous } from '@prisma/client'
import { Building2 } from 'lucide-react'
import Link from 'next/link'

import { LigneRendezVous } from '@/components/features/accueil/ligne-rendez-vous'

import { FUSEAU_CABINET, heureCabinet, jourLocal } from '@/lib/dates'
import { LIBELLE_STATUT, TEINTE_STATUT } from '@/lib/statuts'
import { cn } from '@/lib/utils'
import type { CabinetDuJour } from '@/server/queries/accueil'

const jourSemaine = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU_CABINET, weekday: 'long' })
const jourCourt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** « Jeu. 15 oct. · 14:00 » */
export function dateCourte(instant: Date) {
  return `${majuscule(jourCourt.format(instant))} · ${heureCabinet(instant)}`
}

/** « hier 17:40 », « ce matin 07:12 », « le 12/10 à 09:00 ». */
export function quandRelatif(instant: Date, maintenant: Date) {
  const jour = jourLocal(instant)
  const aujourdhui = jourLocal(maintenant)
  const heure = heureCabinet(instant)
  if (jour === aujourdhui) return Number(heure.slice(0, 2)) < 12 ? `ce matin ${heure}` : `aujourd’hui ${heure}`
  const hier = jourLocal(new Date(maintenant.getTime() - 86_400_000))
  if (jour === hier) return `hier ${heure}`
  return `le ${jour.slice(8, 10)}/${jour.slice(5, 7)} à ${heure}`
}

/** Un chiffre du bandeau de l'Accueil : alvéole blanche, libellé en dessous (maquette D2 du 20/10). */
export function Chiffre({
  href,
  valeur,
  libelle,
  detail,
  alerte,
  survol,
}: {
  /** Où mène un clic sur le chiffre (Accueil, Marving, 28/10). */
  href?: string
  /** Cliquable sans lien : le chiffre est dans un `ChiffreCible`. */
  survol?: boolean
  valeur: number
  libelle: string
  detail?: string
  alerte?: boolean
}) {
  const contenu = (
    <>
      <div
        className={cn(
          'hexagone grid h-[6.5rem] w-[5.75rem] place-items-center bg-white sm:h-[7.375rem] sm:w-[6.5rem]',
          (href || survol) && 'transition-transform duration-200 group-hover:-translate-y-1',
        )}
      >
        <span
          className={cn(
            'chiffres font-heading text-[2.25rem] leading-none font-extrabold text-[#387a70] sm:text-[2.625rem]',
            alerte && valeur > 0 && 'text-etat-alerte',
          )}
        >
          {valeur}
        </span>
      </div>
      <p className="mt-3 text-[0.9375rem] leading-snug font-semibold">{libelle}</p>
      {detail ? <p className="mt-0.5 text-[0.8125rem] leading-snug text-encre/75">{detail}</p> : null}
    </>
  )
  if (!href) return <div className="flex flex-col items-center text-center">{contenu}</div>
  return (
    <Link
      href={href}
      className="group flex flex-col items-center rounded-2xl text-center outline-offset-4 focus-visible:outline-2 focus-visible:outline-[#387a70]"
    >
      {contenu}
    </Link>
  )
}

export function Carte({
  id,
  titre,
  lien,
  children,
  className,
}: {
  id?: string
  titre: string
  lien?: { href: string; libelle: string }
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('carte-douce scroll-mt-6 px-5 py-6 sm:px-7', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-xl font-bold">{titre}</h2>
        {lien ? (
          <Link
            href={lien.href}
            className="shrink-0 text-sm font-semibold whitespace-nowrap text-[#387a70] underline-offset-4 hover:underline"
          >
            {lien.libelle} →
          </Link>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Pastille({ ton, children }: { ton: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-block rounded-full px-3 py-0.5 text-[0.8125rem] font-semibold whitespace-nowrap', ton)}>
      {children}
    </span>
  )
}

export type RendezVousAccueil = {
  id: string
  debut: Date
  statut: StatutRendezVous
  createdAt: Date
  fauteuil: { nom: string }
  praticien: { nom: string; couleur: string }
  motif: { libelle: string }
  patient: { nom: string; prenom: string }
}

/** Badge d'une ligne : « Ajouté ce matin » tant que le patient n'est pas arrivé. */
function badge(r: RendezVousAccueil, maintenant: Date) {
  const pasArrive = r.statut === StatutRendezVous.A_CONFIRMER || r.statut === StatutRendezVous.CONFIRME
  if (pasArrive && jourLocal(r.createdAt) === jourLocal(maintenant)) {
    return (
      <Pastille ton="bg-secondary text-muted-foreground">
        {Number(heureCabinet(r.createdAt).slice(0, 2)) < 12 ? 'Ajouté ce matin' : 'Ajouté aujourd’hui'}
      </Pastille>
    )
  }
  return <Pastille ton={TEINTE_STATUT[r.statut]}>{LIBELLE_STATUT[r.statut]}</Pastille>
}

export function ProchainsRendezVous({
  rendezVous,
  vuDuPraticien,
  maintenant,
}: {
  rendezVous: RendezVousAccueil[]
  vuDuPraticien: boolean
  maintenant: Date
}) {
  return (
    <Carte titre="Prochains rendez-vous" lien={{ href: '/tableau-de-bord/agenda', libelle: 'Voir l’agenda' }}>
      {rendezVous.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">Plus aucun rendez-vous aujourd’hui.</p>
      ) : (
        <ul className="space-y-3">
          {rendezVous.map((r) => (
            <LigneRendezVous
              key={r.id}
              id={r.id}
              statut={r.statut}
              couleur={r.praticien.couleur}
              heure={heureCabinet(r.debut)}
            >
              {/* Sur téléphone, le nom prend toute la ligne ; statut et geste passent dessous. */}
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <p className="font-semibold">
                  {r.patient.prenom} {r.patient.nom}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {r.motif.libelle} · {vuDuPraticien ? r.fauteuil.nom : `Dr ${r.praticien.nom}`}
                </p>
              </div>
              {badge(r, maintenant)}
            </LigneRendezVous>
          ))}
        </ul>
      )}
    </Carte>
  )
}

export function CarteCabinets({ cabinets }: { cabinets: CabinetDuJour[] }) {
  return (
    <Carte titre="Cabinets">
      <ul className="divide-y divide-[#eef2f2]">
        {cabinets.map((c) => {
          const ouvert = c.praticiens.length > 0
          const fauteuils = `${c.fauteuils} fauteuil${c.fauteuils > 1 ? 's' : ''}`
          return (
            <li key={c.id} className="flex gap-3.5 py-5 first:pt-0 last:pb-0">
              <span
                aria-hidden
                className={cn(
                  'hexagone grid h-[3.25rem] w-[2.875rem] shrink-0 place-items-center',
                  ouvert ? 'bg-[#e4f1ee] text-[#387a70]' : 'bg-secondary text-muted-foreground',
                )}
              >
                <Building2 className="size-5" strokeWidth={1.7} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold">{c.nom}</p>
                  <Pastille
                    ton={ouvert ? 'bg-etat-succes-fond text-etat-succes' : 'bg-secondary text-muted-foreground'}
                  >
                    {ouvert ? 'Ouvert' : 'Fermé'}
                  </Pastille>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {ouvert
                    ? `${c.praticiens.join(', ')} · ${fauteuils}`
                    : c.prochainJour
                      ? `Ouvert ${jourSemaine.format(new Date(`${c.prochainJour}T16:00:00Z`))} · ${fauteuils}`
                      : fauteuils}
                </p>
                {c.adresse ? (
                  <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{c.adresse}</p>
                ) : (
                  <p className="mt-0.5 text-[0.8125rem] text-etat-alerte">Adresse à renseigner</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Carte>
  )
}

export function DemandesTransmises({
  demandes,
  moi,
  maintenant,
}: {
  demandes: {
    id: string
    debut: Date
    annulationDemandeeLe: Date | null
    annulationDemandeeParId: string | null
    annulationDemandeePar: { prenom: string; nom: string } | null
    praticien: { nom: string }
    patient: { nom: string; prenom: string }
    motif: { libelle: string }
  }[]
  moi: string
  maintenant: Date
}) {
  return (
    <Carte id="annulations" titre="Demandes d’annulation transmises">
      {demandes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune demande en attente.</p>
      ) : (
        <ul className="divide-y divide-[#eef2f2]">
          {demandes.map((d) => (
            <li key={d.id} className="py-4 first:pt-0 last:pb-0">
              <p className="chiffres font-semibold">{dateCourte(d.debut)}</p>
              <p className="text-[0.9375rem]">
                {d.patient.prenom} {d.patient.nom} · {d.motif.libelle}
              </p>
              <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
                {d.annulationDemandeeParId === moi
                  ? 'Transmise par vous'
                  : d.annulationDemandeePar
                    ? `Transmise par ${d.annulationDemandeePar.prenom} ${d.annulationDemandeePar.nom}`
                    : 'Demandée en ligne par le patient'}
                {d.annulationDemandeeLe ? `, ${quandRelatif(d.annulationDemandeeLe, maintenant)}` : ''}
              </p>
              <div className="mt-2">
                <Pastille ton="bg-etat-alerte-fond text-etat-alerte">En attente du Dr {d.praticien.nom}</Pastille>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Carte>
  )
}

export function CarteSecurite({
  lignes,
}: {
  lignes: { valeur: number; libelle: string; ton?: 'erreur' | 'alerte' }[]
}) {
  return (
    <Carte titre="Sécurité · dernières 24 h">
      <ul className="space-y-3">
        {lignes.map((l) => (
          <li
            key={l.libelle}
            className={cn(
              'flex items-baseline gap-4 text-[0.9375rem]',
              l.valeur > 0 && l.ton === 'erreur' && 'text-etat-erreur',
              l.valeur > 0 && l.ton === 'alerte' && 'text-etat-alerte',
            )}
          >
            <span className="chiffres w-6 text-right font-heading text-lg font-semibold">{l.valeur}</span>
            {l.libelle}
          </li>
        ))}
      </ul>
    </Carte>
  )
}
