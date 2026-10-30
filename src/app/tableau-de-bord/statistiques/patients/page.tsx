import { chargerOnglet, EnTeteStatistiques, PAR, type ParamsStatistiques } from '@/components/features/statistiques/commun'
import {
  Barres,
  Carte,
  Courbe,
  Kpi,
  Kpis,
  Variation,
  fmtNombre,
  fmtPourcent,
} from '@/components/features/statistiques/graphiques'
import { evolution } from '@/server/domaine/statistiques'
import { lirePatients } from '@/server/queries/statistiques'

export const metadata = { title: 'Statistiques — Patients' }

export default async function PagePatients({ searchParams }: { searchParams: ParamsStatistiques }) {
  const lu = await chargerOnglet('Statistiques', searchParams, lirePatients)
  if (!lu.ok) return lu.ecran
  const { portee, donnees: d } = lu.resultat

  return (
    <div className="max-w-(--largeur-page) space-y-4">
      <EnTeteStatistiques portee={portee} sousTitre="Patients reçus, nouveaux et perdus de vue" />
      <Kpis>
        <Kpi libelle="Patients reçus" valeur={fmtNombre(d.recus)} detail={<Variation valeur={evolution(d.recus, d.recusN1)} />} />
        <Kpi
          libelle="Nouveaux patients"
          valeur={fmtNombre(d.nouveaux)}
          detail={<Variation valeur={evolution(d.nouveaux, d.nouveauxN1)} />}
        />
        <Kpi
          libelle="Venus plusieurs fois"
          valeur={fmtPourcent(d.recus ? d.revenus / d.recus : null)}
          detail={`${fmtNombre(d.revenus)} patients sur la période`}
        />
        <Kpi libelle="Perdus de vue" valeur={fmtNombre(d.perdusDeVue)} detail="sans rendez-vous depuis plus d’un an" />
      </Kpis>
      <Carte titre={`Nouveaux patients ${PAR[portee.fenetre.granularite]}`} aide="Fiches créées, pour des patients reçus au moins une fois">
        <Courbe points={d.courbe} />
      </Carte>
      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre="Visites par patient" aide="Rendez-vous honorés de chaque patient reçu sur la période">
          <Barres valeurs={d.frequence} />
        </Carte>
        <Carte
          titre="Âge des patients reçus"
          aide={d.ageInconnu ? `${fmtNombre(d.ageInconnu)} sans date de naissance, non comptés` : 'À la date d’aujourd’hui'}
        >
          <Barres valeurs={d.ages} />
        </Carte>
      </div>
    </div>
  )
}
