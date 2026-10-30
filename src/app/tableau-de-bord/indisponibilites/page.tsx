import {
  type IndisponibiliteVue,
  type PraticienVue,
  type SiteVue,
  Indisponibilites,
} from '@/components/features/indisponibilites/indisponibilites'
import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { aujourdHuiLocal, bornesDuJour, decalerJour } from '@/lib/dates'
import { exigerContexte } from '@/server/auth/session-courante'
import { listerFauteuils, listerIndisponibilites, listerPraticiens } from '@/server/queries/agenda'

// Congés, fermetures et maintenances (compléments d'agenda, lot 2) : jusqu'ici,
// `Indisponibilite` n'avait qu'un lecteur (l'agenda et le portail public, pour
// refuser un créneau) et aucun écrivain — cette page est le premier.
//
// Le garde de permission (`presence:read`, réutilisé — voir README du service)
// vit DANS la DAL (`listerIndisponibilites`, src/server/queries/agenda.ts,
// garde `agenda:read`), pas ici (D4).

export const metadata = { title: 'Congés et fermetures' }

// Fenêtre d'affichage des indisponibilités « à venir » : large (un an), les
// congés se posent parfois loin à l'avance. Sans rapport avec l'horizon de
// deux mois du portail public (Q3) — celui-ci borne ce qu'un PATIENT peut
// réserver, pas ce que le personnel peut lire.
const HORIZON_AFFICHAGE_JOURS = 366

export default async function PageIndisponibilites() {
  const ctx = await exigerContexte()
  const jourDuJour = aujourdHuiLocal()

  const [praticiens, fauteuils, indisponibilites] = await Promise.all([
    listerPraticiens(ctx),
    listerFauteuils(ctx),
    listerIndisponibilites(ctx, {
      debut: bornesDuJour(jourDuJour).debut,
      fin: bornesDuJour(decalerJour(jourDuJour, HORIZON_AFFICHAGE_JOURS)).fin,
    }),
  ])

  const sites: SiteVue[] = [...new Map(fauteuils.map((f) => [f.site.id, f.site])).values()].map((s) => ({
    id: s.id,
    nom: s.nom,
  }))

  const praticiensVue: PraticienVue[] = praticiens.map((p) => ({ id: p.id, nom: p.nom, prenom: p.prenom }))

  const indisponibilitesVue: IndisponibiliteVue[] = indisponibilites.map((i) => ({
    id: i.id,
    type: i.type,
    debut: i.debut.toISOString(),
    fin: i.fin.toISOString(),
    motif: i.motif,
    siteNom: sites.find((s) => s.id === i.site?.id)?.nom ?? null,
    praticienNom: i.praticien ? `${i.praticien.prenom} ${i.praticien.nom}` : null,
  }))

  const fermetures = indisponibilites.filter((i) => i.type === 'FERMETURE').length

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Congés et fermetures"
        chiffres={[
          { valeur: indisponibilites.length, libelle: 'à venir', cible: 'indisponibilite' },
          {
            valeur: fermetures,
            libelle: fermetures > 1 ? 'fermetures de cabinet' : 'fermeture de cabinet',
            cible: 'fermeture',
          },
        ]}
      >
        Congé d’un praticien, fermeture d’un cabinet, ou maintenance ponctuelle. L’agenda et le portail public n’en
        proposent plus les créneaux ; un rendez-vous déjà posé sur la période bloque l’enregistrement, à déplacer ou
        annuler d’abord.
      </BandeauReglages>

      <Indisponibilites
        praticiens={praticiensVue}
        sites={sites}
        indisponibilites={indisponibilitesVue}
        jourDuJour={jourDuJour}
      />
    </div>
  )
}
