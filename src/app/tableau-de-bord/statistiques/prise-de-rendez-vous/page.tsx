import { chargerOnglet, EnTeteStatistiques, PAR, type ParamsStatistiques } from '@/components/features/statistiques/commun'
import {
  Anneau,
  Barres,
  Carte,
  Colonnes,
  Kpi,
  Kpis,
  Variation,
  fmtNombre,
  fmtPourcent,
} from '@/components/features/statistiques/graphiques'
import { lirePrise } from '@/server/queries/statistiques'

export const metadata = { title: 'Statistiques — Prise de rendez-vous' }

const jours = (v: number | null) => (v === null ? '—' : `${fmtNombre(Math.round(v))} j`)

export default async function PagePrise({ searchParams }: { searchParams: ParamsStatistiques }) {
  const lu = await chargerOnglet('Statistiques', searchParams, lirePrise)
  if (!lu.ok) return lu.ecran
  const { portee, donnees: d } = lu.resultat
  const ecartEnLigne = d.partEnLigne !== null && d.partEnLigneN1 !== null ? d.partEnLigne - d.partEnLigneN1 : null
  const ecartDelai = d.delaiMedian !== null && d.delaiMedianN1 !== null ? Math.round(d.delaiMedian - d.delaiMedianN1) : null

  return (
    <div className="max-w-(--largeur-page) space-y-4">
      <EnTeteStatistiques portee={portee} sousTitre="Rendez-vous pris pendant la période, quelle que soit leur date" />
      <Kpis>
        <Kpi libelle="Pris en ligne" valeur={fmtPourcent(d.partEnLigne)} detail={<Variation valeur={ecartEnLigne} enPoints />} />
        <Kpi
          libelle="Délai pour avoir un rendez-vous"
          valeur={jours(d.delaiMedian)}
          detail={
            ecartDelai === null ? 'la moitié des patients attend moins' : ecartDelai === 0 ? 'comme l’an dernier' : `${ecartDelai > 0 ? '+' : '−'}${Math.abs(ecartDelai)} j sur un an`
          }
        />
        <Kpi libelle="Pris pour le jour même" valeur={fmtNombre(d.memeJour)} detail="urgences et dépannages" />
        <Kpi libelle="Liste d’attente" valeur={fmtNombre(d.proposesListeAttente)} detail="créneaux libérés proposés" />
      </Kpis>
      <Carte titre={`Rendez-vous pris ${PAR[portee.fenetre.granularite]}`} aide="En ligne sur le site, ou par le secrétariat">
        <Colonnes
          colonnes={d.empile.seaux.map((s) => ({ cle: s.cle, libelle: s.libelle, titre: s.titre, valeurs: s.valeurs }))}
          series={d.empile.series}
        />
      </Carte>
      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre="En ligne ou par le secrétariat">
          <Anneau
            valeurs={[
              { libelle: 'En ligne', valeur: d.enLigne },
              { libelle: 'Secrétariat', valeur: d.parSecretariat },
            ]}
            centre={fmtNombre(d.pris)}
            sousCentre="rendez-vous"
          />
        </Carte>
        <Carte titre="Délai d’attente par motif" aide="La moitié des patients attend moins que ce délai">
          <Barres valeurs={d.delaiParMotif} unite="j" />
        </Carte>
      </div>
    </div>
  )
}
