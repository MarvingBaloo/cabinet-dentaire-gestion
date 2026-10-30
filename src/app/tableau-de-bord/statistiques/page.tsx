import { chargerOnglet, EnTeteStatistiques, PAR, type ParamsStatistiques } from '@/components/features/statistiques/commun'
import {
  Anneau,
  Barres,
  Carte,
  Colonnes,
  Courbe,
  Kpi,
  Kpis,
  Variation,
  fmtNombre,
} from '@/components/features/statistiques/graphiques'
import { evolution, type Granularite } from '@/server/domaine/statistiques'
import { lireActivite } from '@/server/queries/statistiques'

export const metadata = { title: 'Statistiques — Activité' }

const MEILLEUR: Record<Granularite, string> = { jour: 'Meilleur jour', semaine: 'Meilleure semaine', mois: 'Meilleur mois' }

export default async function PageActivite({ searchParams }: { searchParams: ParamsStatistiques }) {
  const lu = await chargerOnglet('Statistiques', searchParams, lireActivite)
  if (!lu.ok) return lu.ecran
  const { portee, donnees: d } = lu.resultat
  const g = portee.fenetre.granularite

  // Seulement les jours où l'on a travaillé : un praticien du vendredi et du samedi n'a pas de lundi.
  const jours = d.parJour.filter((j) => j.valeur > 0)
  const parJour = (
    <Carte titre="Par jour de la semaine" aide="Rendez-vous honorés en moyenne, un jour travaillé">
      <Colonnes
        colonnes={jours.map((j) => ({ cle: j.libelle, libelle: j.libelle, valeurs: [j.valeur] }))}
        valeursAuDessus
        enAvant={jours.reduce((m, j, i, t) => (j.valeur > t[m]!.valeur ? i : m), 0)}
        hauteur={200}
      />
    </Carte>
  )
  const cartes = [
    d.parPraticien.length > 1 ? (
      <Carte key="praticiens" titre="Par praticien" aide="Rendez-vous honorés sur la période">
        <Barres valeurs={d.parPraticien} />
      </Carte>
    ) : (
      <div key="jours">{parJour}</div>
    ),
    d.parSite.length > 1 ? (
      <Carte key="cabinets" titre="Par cabinet" aide="Rendez-vous honorés sur la période">
        <Anneau valeurs={d.parSite} centre={fmtNombre(d.honores)} sousCentre="rendez-vous" />
      </Carte>
    ) : d.parPraticien.length > 1 ? (
      <div key="jours">{parJour}</div>
    ) : null,
  ].filter(Boolean)

  return (
    <div className="max-w-(--largeur-page) space-y-4">
      <EnTeteStatistiques portee={portee} sousTitre="Rendez-vous honorés" />
      <Kpis>
        <Kpi
          libelle="Rendez-vous honorés"
          valeur={fmtNombre(d.honores)}
          detail={<Variation valeur={evolution(d.honores, d.honoresN1)} />}
        />
        <Kpi libelle="Heures de soins" valeur={`${fmtNombre(d.heures)} h`} detail={<Variation valeur={evolution(d.heures, d.heuresN1)} />} />
        <Kpi
          libelle="Moyenne par jour travaillé"
          valeur={d.moyenneParJour === null ? '—' : fmtNombre(Math.round(d.moyenneParJour * 10) / 10)}
          detail="rendez-vous"
        />
        <Kpi
          libelle={MEILLEUR[g]}
          valeur={d.meilleur ? d.meilleur.libelle.replace(/^./, (c) => c.toUpperCase()) : '—'}
          detail={d.meilleur ? `${fmtNombre(d.meilleur.valeur ?? 0)} rendez-vous` : undefined}
        />
      </Kpis>
      <Carte titre={`Rendez-vous honorés ${PAR[g]}`}>
        <Courbe points={d.courbe} />
      </Carte>
      {cartes.length ? <div className={cartes.length > 1 ? 'grid gap-4 lg:grid-cols-2' : ''}>{cartes}</div> : null}
    </div>
  )
}
