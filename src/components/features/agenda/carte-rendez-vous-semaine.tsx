import type { NiveauUrgence, StatutRendezVous } from '@prisma/client'
import type { HTMLAttributes } from 'react'

import { heureCabinet } from '@/lib/dates'
import { niveauRetenu } from '@/lib/niveaux-urgence'
import { badgeSite, couleurSite } from '@/lib/sites'
import { LIBELLE_STATUT } from '@/lib/statuts'
import { cn } from '@/lib/utils'

import { ContenuRendezVous, classesRendezVous, fondRendezVous } from './habillage-rendez-vous'

// Carte d'un rendez-vous de la vue semaine, habillée comme celles de la vue jour
// (maquette R2 du 23/10, `habillage-rendez-vous.tsx`). Sans hook : rendue côté
// serveur (lecture seule) comme côté client (grille glissable).

export type RendezVousSemaineVue = {
  id: string
  debut: Date
  fin: Date
  statut: StatutRendezVous
  /** Urgence sur planning plein, ou hors des horaires : le glisser-déposer laisse le serveur en juger. */
  surbooking?: boolean
  horsHoraire?: boolean
  fauteuil: { id: string; nom: string }
  praticien: { id: string; nom: string; prenom: string; couleur: string }
  motif: { id: string; libelle: string; couleur: string; estUrgence?: boolean }
  patient: { id: string; nom: string; prenom: string }
  /** Présent uniquement pour la vue consolidée — voir `consolide`. */
  site?: { id: string; code: string; nom: string }
  /** Posé par l'assistant des urgences (D77). */
  conversationAssistant?: { niveau: NiveauUrgence | null; niveauCabinet: NiveauUrgence | null } | null
}

export function CarteRendezVousSemaine({
  rdv,
  hauteur,
  consolide,
  className,
  style,
  children,
  ...reste
}: {
  rdv: RendezVousSemaineVue
  /** Hauteur de la carte en pixels : décide du contenu affiché. */
  hauteur: number
  consolide: boolean
} & Omit<HTMLAttributes<HTMLElement>, 'children'> & { children?: React.ReactNode }) {
  const nomComplet = `${rdv.patient.prenom} ${rdv.patient.nom}`
  const urgence = rdv.motif.estUrgence ?? false

  return (
    <article
      {...reste}
      className={cn(classesRendezVous(rdv.statut, urgence), 'px-2', className)}
      style={{ ...style, height: hauteur, ...fondRendezVous(rdv.praticien.couleur, rdv.statut) }}
    >
      <ContenuRendezVous
        debut={heureCabinet(rdv.debut)}
        fin={heureCabinet(rdv.fin)}
        prenom={rdv.patient.prenom}
        nom={rdv.patient.nom}
        motif={rdv.motif.libelle}
        statut={rdv.statut}
        couleur={rdv.praticien.couleur}
        hauteur={hauteur}
        urgence={urgence}
        niveauIA={niveauRetenu(rdv.conversationAssistant)}
      />
      <span className="sr-only">
        {nomComplet} — {rdv.motif.libelle} — {rdv.praticien.prenom} {rdv.praticien.nom} — statut :{' '}
        {LIBELLE_STATUT[rdv.statut]}
        {consolide && rdv.site ? ` — ${rdv.site.nom}` : ''}
      </span>
      {consolide && rdv.site ? (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 px-1 text-[9px] font-semibold text-white"
          style={{ backgroundColor: couleurSite(rdv.site.code) }}
        >
          {badgeSite(rdv.site.code, rdv.site.nom)}
        </span>
      ) : null}
      {children}
    </article>
  )
}
