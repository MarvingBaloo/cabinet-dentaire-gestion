import Link from 'next/link'

import { FormulaireRendezVous, type SiteVue } from '@/components/features/agenda/formulaire-rendez-vous'
import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { EtatVide } from '@/components/ui/etat-vide'
import { aujourdHuiLocal, jourEnToutesLettres } from '@/lib/dates'
import { exigerContexte } from '@/server/auth/session-courante'
import { lireCabinetChoisi } from '@/server/cabinet-choisi'
import { listerFauteuils, listerMotifs, listerPraticiens } from '@/server/queries/agenda'
import { lireIdentite } from '@/server/queries/identite'
import { rechercherPatients } from '@/server/queries/patients'

// Page à part plutôt que fenêtre par-dessus l'agenda : la recherche d'un patient
// passe par l'adresse, chaque saisie en cours reste donc partageable et
// rejouable, et le formulaire fonctionne sans JavaScript comme le reste du
// tableau de bord. Le garde est dans le layout et dans la DAL — cette page ne
// protège rien elle-même.

export const metadata = { title: 'Nouveau rendez-vous' }

function jourDemande(brut: string | undefined): string {
  if (brut && /^\d{4}-\d{2}-\d{2}$/.test(brut) && !Number.isNaN(Date.parse(brut))) return brut
  return aujourdHuiLocal()
}

export default async function PageNouveauRendezVous({
  searchParams,
}: {
  searchParams: Promise<{ jour?: string; q?: string; heure?: string; praticien?: string; site?: string }>
}) {
  const ctx = await exigerContexte()
  // `heure`, `praticien` et `site` arrivent d'un clic sur une case vide de
  // l'agenda : on pré-remplit, on ne décide rien — le formulaire et le service
  // revérifient tout, et une valeur inconnue est simplement ignorée.
  const { jour: brut, q, heure: heureBrute, praticien: praticienDemande, site: siteDemande } = await searchParams
  const jour = jourDemande(brut)
  const recherche = q?.trim() ?? ''

  const [praticiens, motifs, fauteuils, patients, identite, { choisi }] = await Promise.all([
    listerPraticiens(ctx),
    listerMotifs(ctx),
    // Les sites sont déduits des fauteuils, seule liste déjà cantonnée à la
    // portée de l'appelant (D5) : `listerSites` rend les deux cabinets quel que
    // soit le rattachement, et proposerait ici un site où l'on ne peut rien poser.
    listerFauteuils(ctx),
    rechercherPatients(ctx, recherche),
    lireIdentite(ctx),
    lireCabinetChoisi(ctx),
  ])

  const sites: SiteVue[] = [...new Map(fauteuils.map((f) => [f.site.id, f.site])).values()].map((s) => ({
    id: s.id,
    nom: s.nom,
  }))

  const estPraticien = ctx.roles.includes('PRATICIEN')
  const heure = heureBrute && /^([01]\d|2[0-3]):[0-5]\d$/.test(heureBrute) ? heureBrute : null
  const praticienCase = praticienDemande && praticiens.some((p) => p.id === praticienDemande) ? praticienDemande : null
  const siteCase = siteDemande && sites.some((s) => s.id === siteDemande) ? siteDemande : null

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <div className="space-y-4">
        <Link
          href={`/tableau-de-bord/agenda?date=${jour}`}
          className="text-sm font-semibold text-[#387a70] underline-offset-4 hover:underline"
        >
          <span aria-hidden>←</span> Retour à l’agenda
        </Link>
        <BandeauReglages titre="Nouveau rendez-vous">
          {choisi ? `${choisi.nom} · ` : ''}
          {jourEnToutesLettres(jour).replace(/ \d{4}$/, '')}
        </BandeauReglages>
      </div>

      {sites.length === 0 ? (
        <EtatVide
          variante="erreur"
          titre="Aucun cabinet dans votre périmètre"
          texte="Rapprochez-vous d’un administrateur."
        />
      ) : (
        <FormulaireRendezVous
          jour={jour}
          aujourdHui={aujourdHuiLocal()}
          recherche={recherche}
          patients={patients}
          praticiens={praticiens}
          motifs={motifs}
          sites={sites}
          monPraticienId={estPraticien ? identite.praticienId : null}
          praticienParDefaut={praticienCase ?? (estPraticien ? identite.praticienId : null)}
          siteParDefaut={siteCase ?? (choisi && sites.some((s) => s.id === choisi.id) ? choisi.id : null)}
          heureParDefaut={heure}
        />
      )}
    </div>
  )
}
