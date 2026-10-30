import { chargerOnglet, EnTeteStatistiques, PAR, type ParamsStatistiques } from '@/components/features/statistiques/commun'
import {
  Barres,
  Carte,
  Colonnes,
  Kpi,
  Kpis,
  Tableau,
  Variation,
  fmtNombre,
  fmtPourcent,
} from '@/components/features/statistiques/graphiques'
import { lireStatistiquesMotifs } from '@/server/queries/statistiques'

export const metadata = { title: 'Statistiques — Motifs' }

export default async function PageMotifs({ searchParams }: { searchParams: ParamsStatistiques }) {
  const lu = await chargerOnglet('Statistiques', searchParams, lireStatistiquesMotifs)
  if (!lu.ok) return lu.ecran
  const { portee, donnees: d } = lu.resultat

  return (
    <div className="max-w-(--largeur-page) space-y-4">
      <EnTeteStatistiques portee={portee} sousTitre="Rendez-vous par motif, absences comprises" />
      <Kpis>
        <Kpi
          libelle="Motif n° 1"
          valeur={d.premier?.libelle ?? '—'}
          texte
          detail={d.premier ? `${fmtPourcent(d.premier.part)} des rendez-vous` : undefined}
        />
        <Kpi
          libelle="En plus forte hausse"
          valeur={d.hausse?.libelle ?? '—'}
          texte
          detail={d.hausse ? <Variation valeur={d.hausse.evolution} /> : 'aucune hausse marquée'}
        />
        <Kpi libelle="Part des urgences" valeur={fmtPourcent(d.partUrgences)} detail="des rendez-vous" />
        <Kpi libelle="Motifs différents" valeur={fmtNombre(d.nombreMotifs)} detail={`sur ${fmtNombre(d.total)} rendez-vous`} />
      </Kpis>
      <Carte titre={`Les motifs ${PAR[portee.fenetre.granularite]}`} aide="Les quatre motifs les plus demandés, puis tous les autres">
        <Colonnes
          colonnes={d.empile.seaux.map((s) => ({ cle: s.cle, libelle: s.libelle, titre: s.titre, valeurs: s.valeurs }))}
          series={d.empile.series}
        />
      </Carte>
      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre="Motifs les plus demandés" aide="Rendez-vous sur la période">
          <Barres valeurs={d.barres} />
        </Carte>
        <Carte titre="Comparés à l’an dernier">
          <Tableau
            entetes={[{ libelle: 'Motif' }, { libelle: 'Période', nombre: true }, { libelle: 'Un an avant', nombre: true }, { libelle: 'Évolution', nombre: true }]}
            lignes={d.tableau.slice(0, 10).map((t) => ({
              cle: t.libelle,
              cellules: [t.libelle, fmtNombre(t.valeur), fmtNombre(t.valeurN1), <Variation key="v" valeur={t.evolution} />],
            }))}
          />
        </Carte>
      </div>
    </div>
  )
}
