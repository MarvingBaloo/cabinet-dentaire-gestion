import {
  type ExceptionVue,
  type FauteuilVue,
  type LigneSemaineTypeVue,
  Presences,
  type SiteVue,
} from '@/components/features/presences/presences'
import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { aujourdHuiLocal, decalerJour, formatHeureMinutesISO } from '@/lib/dates'
import { joursFeriesEntre } from '@/lib/jours-feries'
import { exigerContexte } from '@/server/auth/session-courante'
import { listerFauteuils, listerPraticiens } from '@/server/queries/agenda'
import { listerExceptions, listerFauteuilsPraticiens, listerSemaineType } from '@/server/queries/presences'
import { HORIZON_JOURS } from '@/server/queries/public/creneaux'

// Semaine type et exceptions ponctuelles des praticiens (compléments
// d'agenda, lot 1) : jusqu'ici, seul `seed-demo` posait des `PlageDePresence`,
// aucun écran ne le faisait. `PlageDePresence` reste ce que lisent l'agenda et
// le portail ; ce qui change, c'est sa source — calculée ici plutôt que saisie
// directement (`src/server/services/presences.ts`).
//
// Le garde de permission (`presence:read`) vit DANS la DAL (`listerSemaineType`,
// `listerExceptions`), pas ici (D4) : cette page ne fait qu'appeler et laisser
// `PermissionDeniedError` remonter, comme partout ailleurs dans ce dépôt.

export const metadata = { title: 'Présences' }

export default async function PagePresences() {
  const ctx = await exigerContexte()
  const jourDuJour = aujourdHuiLocal()

  const [praticiens, fauteuils, semaineType, exceptions, fauteuilsPraticiens] = await Promise.all([
    listerPraticiens(ctx),
    // Les cabinets proposés au choix sont déduits des fauteuils, seule liste
    // déjà cantonnée à la portée de l'appelant (D5) — même principe que la
    // prise de rendez-vous (src/app/tableau-de-bord/agenda/nouveau/page.tsx).
    listerFauteuils(ctx),
    listerSemaineType(ctx),
    listerExceptions(ctx, { depuis: jourDuJour }),
    listerFauteuilsPraticiens(ctx),
  ])

  const sites: SiteVue[] = [...new Map(fauteuils.map((f) => [f.site.id, f.site])).values()].map((s) => ({
    id: s.id,
    code: s.code,
    nom: s.nom,
  }))

  const fauteuilsVue: FauteuilVue[] = fauteuils.map((f) => ({ id: f.id, nom: f.nom, siteId: f.site.id }))

  const semaineTypeVue: LigneSemaineTypeVue[] = semaineType.map((l) => ({
    praticienId: l.praticienId,
    jourSemaine: l.jourSemaine,
    siteId: l.site.id,
    fauteuilId: l.fauteuil.id,
    heureDebut: formatHeureMinutesISO(l.heureDebut),
    heureFin: formatHeureMinutesISO(l.heureFin),
    pauseDebut: l.pauseDebut != null ? formatHeureMinutesISO(l.pauseDebut) : null,
    pauseFin: l.pauseFin != null ? formatHeureMinutesISO(l.pauseFin) : null,
  }))

  // Fériés à venir sur le même horizon que la génération des plages (Q3,
  // HORIZON_JOURS) : au-delà, ni l'agenda ni le portail ne proposent encore
  // de créneau, autant ne pas encombrer l'écran d'un férié qu'on ne peut pas
  // encore ouvrir.
  const joursFeries = joursFeriesEntre(jourDuJour, decalerJour(jourDuJour, HORIZON_JOURS))

  const exceptionsVue: ExceptionVue[] = exceptions.map((e) => ({
    id: e.id,
    praticienId: e.praticienId,
    date: e.date.toISOString().slice(0, 10),
    type: e.type,
    motif: e.motif,
    siteNom: e.site?.nom ?? null,
    fauteuilNom: e.fauteuil?.nom ?? null,
    heureDebut: e.heureDebut != null ? formatHeureMinutesISO(e.heureDebut) : null,
    heureFin: e.heureFin != null ? formatHeureMinutesISO(e.heureFin) : null,
  }))

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Présences"
        chiffres={[
          { valeur: praticiens.length, libelle: praticiens.length > 1 ? 'praticiens' : 'praticien', cible: 'praticien' },
          {
            valeur: exceptions.length,
            libelle: exceptions.length > 1 ? 'exceptions à venir' : 'exception à venir',
            cible: 'exception',
          },
        ]}
      >
        La semaine type de chaque praticien, et les exceptions ponctuelles qui s’y substituent — congé, jour fermé,
        ouverture exceptionnelle. L’agenda et le portail public en déduisent, sur deux mois glissants, où et quand
        chaque praticien reçoit.
      </BandeauReglages>

      <Presences
        praticiens={praticiens.map((p) => ({
          id: p.id,
          nom: p.nom,
          prenom: p.prenom,
          titre: p.titre,
          couleur: p.couleur,
        }))}
        sites={sites}
        fauteuils={fauteuilsVue}
        fauteuilsPraticiens={fauteuilsPraticiens}
        semaineType={semaineTypeVue}
        exceptions={exceptionsVue}
        joursFeries={joursFeries}
        jourDuJour={jourDuJour}
      />
    </div>
  )
}
