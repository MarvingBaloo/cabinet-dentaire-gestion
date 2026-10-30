import { chargerOnglet, EnTeteStatistiques, PAR, type ParamsStatistiques } from '@/components/features/statistiques/commun'
import {
  Carte,
  CarteChaleur,
  Colonnes,
  Courbe,
  Kpi,
  Kpis,
  SAUGE_PROFOND,
  Tableau,
  Variation,
  fmtNombre,
  fmtPourcent,
} from '@/components/features/statistiques/graphiques'
import { JOURS_OUVRES, TRANCHES } from '@/server/domaine/statistiques'
import { lireRemplissage } from '@/server/queries/statistiques'

export const metadata = { title: 'Statistiques — Remplissage' }

export default async function PageRemplissage({ searchParams }: { searchParams: ParamsStatistiques }) {
  const lu = await chargerOnglet('Statistiques', searchParams, lireRemplissage)
  if (!lu.ok) return lu.ecran
  const { portee, donnees: d } = lu.resultat
  const ecart = d.taux !== null && d.tauxN1 !== null ? d.taux - d.tauxN1 : null
  const travailles = d.parJour.filter((j) => j.valeur !== null)

  return (
    <div className="max-w-(--largeur-page) space-y-4">
      <EnTeteStatistiques portee={portee} sousTitre="Heures de présence occupées par un rendez-vous" />
      <Kpis>
        <Kpi libelle="Taux de remplissage" valeur={fmtPourcent(d.taux)} detail={<Variation valeur={ecart} enPoints />} />
        <Kpi libelle="Heures de présence" valeur={`${fmtNombre(d.heuresPresence)} h`} detail="au fauteuil" />
        <Kpi libelle="Heures restées libres" valeur={`${fmtNombre(d.heuresLibres)} h`} detail="sans rendez-vous" />
        <Kpi
          libelle="Jour le plus creux"
          valeur={d.plusCreux?.libelle.replace('.', '') ?? '—'}
          detail={d.plusCreux ? `${fmtPourcent(d.plusCreux.valeur)} rempli` : undefined}
        />
      </Kpis>
      <Carte titre={`Taux de remplissage ${PAR[portee.fenetre.granularite]}`}>
        <Courbe points={d.courbe} format="pourcent" />
      </Carte>
      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre="Les heures creuses" aide="Part des heures de présence occupées, par jour et par heure">
          <CarteChaleur
            lignes={JOURS_OUVRES}
            colonnes={TRANCHES}
            cases={d.chaleur}
            bornes={[0.4, 1]}
            couleur={SAUGE_PROFOND}
            effectifMin={2}
            unite="heures de présence"
          />
        </Carte>
        <div className="space-y-4">
          <Carte titre="Par jour de la semaine">
            <Colonnes
              colonnes={travailles.map((j) => ({ cle: j.libelle, libelle: j.libelle, valeurs: [j.valeur] }))}
              format="pourcent"
              valeursAuDessus
              hauteur={180}
            />
          </Carte>
          <Carte titre="Par fauteuil">
            <Tableau
              entetes={[{ libelle: 'Fauteuil' }, { libelle: 'Présence', nombre: true }, { libelle: 'Occupé', nombre: true }, { libelle: 'Taux', nombre: true }]}
              lignes={d.parFauteuil.map((f) => ({
                cle: f.libelle,
                cellules: [f.libelle, `${fmtNombre(f.heuresPresence)} h`, `${fmtNombre(f.heuresOccupees)} h`, fmtPourcent(f.taux)],
              }))}
            />
          </Carte>
        </div>
      </div>
    </div>
  )
}
