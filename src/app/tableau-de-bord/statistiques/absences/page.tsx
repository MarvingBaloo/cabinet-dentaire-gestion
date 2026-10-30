import { chargerOnglet, EnTeteStatistiques, PAR, type ParamsStatistiques } from '@/components/features/statistiques/commun'
import {
  Carte,
  CarteChaleur,
  Courbe,
  Kpi,
  Kpis,
  SABLE,
  Tableau,
  Variation,
  fmtNombre,
  fmtPourcent,
} from '@/components/features/statistiques/graphiques'
import { JOURS_OUVRES, TRANCHES } from '@/server/domaine/statistiques'
import { lireAbsences } from '@/server/queries/statistiques'

export const metadata = { title: 'Statistiques — Absences' }

export default async function PageAbsences({ searchParams }: { searchParams: ParamsStatistiques }) {
  const lu = await chargerOnglet('Statistiques', searchParams, lireAbsences)
  if (!lu.ok) return lu.ecran
  const { portee, donnees: d } = lu.resultat
  const ecart = d.taux !== null && d.tauxN1 !== null ? d.taux - d.tauxN1 : null

  return (
    <div className="max-w-(--largeur-page) space-y-4">
      <EnTeteStatistiques portee={portee} sousTitre="Rendez-vous non honorés et annulations" />
      <Kpis>
        <Kpi
          libelle="Taux d’absence"
          valeur={fmtPourcent(d.taux, 1)}
          detail={<Variation valeur={ecart} sens="baisse" enPoints />}
        />
        <Kpi libelle="Absences" valeur={fmtNombre(d.absences)} detail="créneaux perdus" />
        <Kpi
          libelle="Annulations"
          valeur={fmtNombre(d.annulesParPatient + d.annulesParCabinet)}
          detail={`${fmtNombre(d.annulesParPatient)} par le patient, ${fmtNombre(d.annulesParCabinet)} par le cabinet`}
        />
        <Kpi libelle="Réservation bloquée" valeur={fmtNombre(d.patientsBloques)} detail="patients, après 3 manquements" />
      </Kpis>
      <Carte titre={`Taux d’absence ${PAR[portee.fenetre.granularite]}`}>
        <Courbe points={d.courbe} format="pourcent" couleur={SABLE} />
      </Carte>
      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre="Par jour et par heure" aide="Part des rendez-vous non honorés">
          <CarteChaleur lignes={JOURS_OUVRES} colonnes={TRANCHES} cases={d.chaleur} bornes={[0.03, 0.15]} unite="rendez-vous" />
        </Carte>
        <Carte titre="Par motif" aide="Du plus manqué au moins manqué">
          <Tableau
            entetes={[{ libelle: 'Motif' }, { libelle: 'Rendez-vous', nombre: true }, { libelle: 'Absences', nombre: true }, { libelle: 'Taux', nombre: true }]}
            lignes={d.parMotif.slice(0, 10).map((m) => ({
              cle: m.libelle,
              cellules: [m.libelle, fmtNombre(m.rendezVous), fmtNombre(m.absences), fmtPourcent(m.taux, 1)],
            }))}
          />
        </Carte>
      </div>
    </div>
  )
}
