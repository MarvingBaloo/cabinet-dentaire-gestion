import Link from 'next/link'

import { FormulaireDuplication } from '@/components/features/agenda/formulaire-duplication'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { EtatVide } from '@/components/ui/etat-vide'
import { aujourdHuiLocal, jourLocal } from '@/lib/dates'
import { exigerContexte } from '@/server/auth/session-courante'
import { dureePour, lireRendezVous } from '@/server/queries/agenda'

// Page à part, comme « nouveau » : l'adresse porte l'identifiant de la source,
// reste partageable et fonctionne sans JavaScript. Le garde est dans le layout
// et dans la DAL (`lireRendezVous` applique déjà `filtreSite`, D5) — cette page
// ne protège rien elle-même.

export const metadata = { title: 'Dupliquer un rendez-vous' }

function jourDemande(brut: string | undefined): string | null {
  if (brut && /^\d{4}-\d{2}-\d{2}$/.test(brut) && !Number.isNaN(Date.parse(brut))) return brut
  return null
}

export default async function PageDupliquerRendezVous({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ jour?: string }>
}) {
  const ctx = await exigerContexte()
  const { id } = await params
  const { jour: brut } = await searchParams

  // `lireRendezVous` applique déjà `filtreSite` (D5) : une source hors de la
  // portée de l'appelant est introuvable ici, pas trouvée puis masquée — même
  // logique que la lecture dans `dupliquerRendezVous` côté service.
  const source = await lireRendezVous(ctx, id)

  if (!source) {
    const retour = jourDemande(brut) ?? aujourdHuiLocal()
    return (
      <div className="max-w-3xl space-y-6">
        <Link
          href={`/tableau-de-bord/agenda?jour=${retour}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          <span aria-hidden>←</span> Agenda
        </Link>
        <EtatVide
          variante="erreur"
          titre="Rendez-vous introuvable"
          texte="Il est peut-être hors de votre périmètre."
        />
      </div>
    )
  }

  // La date par défaut du formulaire est celle de la SOURCE, pas « aujourd'hui » :
  // dupliquer part de ce qui existe. `jour` en query (posé par le lien
  // « Dupliquer » de l'agenda) prévaut quand il est valide, pour revenir à la
  // bonne vue une fois fini.
  const jour = jourDemande(brut) ?? jourLocal(source.debut)

  const dureeMinutes = await dureePour(ctx, source.praticien.id, source.motif.id)

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href={`/tableau-de-bord/agenda?jour=${jour}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        <span aria-hidden>←</span> Agenda
      </Link>

      <EnTetePage
        titre="Dupliquer un rendez-vous"
        description="Choisissez une nouvelle date et heure — patient, motif et praticien restent ceux du rendez-vous repris."
      />

      <FormulaireDuplication
        rdv={{
          id: source.id,
          patient: source.patient,
          praticien: source.praticien,
          motif: source.motif,
          site: source.site,
          dureeMinutes,
        }}
        jour={jour}
      />
    </div>
  )
}
