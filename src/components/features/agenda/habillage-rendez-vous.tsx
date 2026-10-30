import type { NiveauUrgence, StatutRendezVous } from '@prisma/client'
import {
  Armchair,
  Check,
  CheckCheck,
  Clock,
  Hourglass,
  Stethoscope,
  UserX,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'

import { couleurLisibleSurBlanc } from '@/lib/couleurs'
import { NIVEAU_URGENCE } from '@/lib/niveaux-urgence'
import { ESTOMPE, LIBELLE_STATUT, PASSE } from '@/lib/statuts'
import { cn } from '@/lib/utils'

// Habillage d'un rendez-vous dans la grille, jour et semaine (maquette R2 du 23/10,
// docs/maquettes/maquette-rendez-vous.pdf) : un bloc teinté de la couleur du praticien, le nom du patient
// d'abord, l'heure et le motif dessous, le statut en icône dans une alvéole blanche. Le bloc porte un
// conteneur (`@container`) : quand deux rendez-vous se partagent une case, il ne garde que l'heure et le nom.
// Sans hook : rendu côté serveur comme côté client (grilles glissables).

/** L'icône et la couleur de chaque statut, la même partout dans la grille. */
export const ICONE_STATUT: Record<StatutRendezVous, { Icone: LucideIcon; couleur: string }> = {
  A_CONFIRMER: { Icone: Clock, couleur: '#9A6412' },
  CONFIRME: { Icone: Check, couleur: '#2C6B62' },
  SALLE_ATTENTE: { Icone: Armchair, couleur: '#2F6FA3' },
  AU_FAUTEUIL: { Icone: Stethoscope, couleur: '#1F7A4D' },
  TERMINE: { Icone: CheckCheck, couleur: '#5D6A66' },
  EN_CAISSE: { Icone: Wallet, couleur: '#5D6A66' },
  ABSENT: { Icone: UserX, couleur: '#B42318' },
  ANNULE: { Icone: X, couleur: '#B42318' },
  ANNULATION_DEMANDEE: { Icone: Hourglass, couleur: '#B42318' },
}

const teinte = (couleur: string, part: number) => `color-mix(in oklch, ${couleur} ${part}%, white)`

/** Le fond du bloc : dégradé de la couleur du praticien ; rayé quand le rendez-vous est annulé ou manqué. */
export function fondRendezVous(couleur: string, statut: StatutRendezVous): CSSProperties {
  return {
    backgroundImage: ESTOMPE.includes(statut)
      ? `repeating-linear-gradient(135deg, ${teinte(couleur, 10)} 0 6px, ${teinte(couleur, 4)} 6px 12px)`
      : `linear-gradient(135deg, ${teinte(couleur, 26)}, ${teinte(couleur, 14)})`,
  }
}

/** Les classes du bloc lui-même ; la position, les gestes et la sélection restent à l'appelant. */
export function classesRendezVous(statut: StatutRendezVous, urgence: boolean) {
  const estompe = ESTOMPE.includes(statut)
  return cn(
    '@container absolute overflow-hidden rounded-[14px] px-2.5 text-xs leading-tight select-none',
    estompe && 'opacity-60',
    PASSE.includes(statut) && 'opacity-80',
    urgence && !estompe && !PASSE.includes(statut) && 'ring-2 ring-etat-alerte/60',
  )
}

function Alveole({ statut, taille }: { statut: StatutRendezVous; taille: number }) {
  const { Icone, couleur } = ICONE_STATUT[statut]
  return (
    <span
      aria-hidden
      className="hexagone grid shrink-0 place-items-center bg-white"
      style={{ width: taille, height: taille * 1.12, color: couleur }}
    >
      <Icone style={{ width: taille * 0.56, height: taille * 0.56 }} strokeWidth={2.4} />
    </span>
  )
}

/** Le rendez-vous a été posé par l'assistant des urgences (D77). */
function BadgeIA() {
  return (
    <span
      title="Posé par l’assistant des urgences"
      className="hexagone grid shrink-0 place-items-center bg-[#387a70] text-[8px] font-bold text-white"
      style={{ width: 18, height: 20 }}
    >
      IA
    </span>
  )
}

export function ContenuRendezVous({
  debut,
  fin,
  prenom,
  nom,
  motif,
  statut,
  couleur,
  hauteur,
  urgence,
  niveauIA = null,
}: {
  /** « 10:00 », à l'heure du cabinet. */
  debut: string
  fin: string
  prenom: string
  nom: string
  motif: string
  statut: StatutRendezVous
  couleur: string
  hauteur: number
  urgence: boolean
  /** Posé par l'assistant des urgences (D77) : un badge « IA », et son niveau à la place du statut. */
  niveauIA?: NiveauUrgence | null
}) {
  const texte = couleurLisibleSurBlanc(couleur)
  const barre = ESTOMPE.includes(statut) && 'line-through'

  // Un quart d'heure : une seule ligne.
  if (hauteur < 44) {
    return (
      <div className="flex h-full items-center gap-1.5 whitespace-nowrap" style={{ color: texte }}>
        <span className="tabular-nums opacity-85">{debut}</span>
        <span className={cn('min-w-0 flex-1 truncate font-bold', barre)}>
          <span className="@max-[7rem]:hidden">{prenom} </span>
          {nom}
        </span>
        <span className="@max-[5rem]:hidden">
          <Alveole statut={statut} taille={16} />
        </span>
      </div>
    )
  }

  const { couleur: couleurStatut } = ICONE_STATUT[statut]
  return (
    <div className="relative h-full py-1.5" style={{ color: texte }}>
      <span className="absolute top-1.5 right-0 flex items-center gap-1 @max-[5rem]:hidden">
        {niveauIA ? <BadgeIA /> : null}
        <Alveole statut={statut} taille={hauteur >= 64 ? 22 : 18} />
      </span>
      {/* Case partagée : l'heure, puis le nom. */}
      <p className="hidden tabular-nums font-semibold @max-[7rem]:block">{debut}</p>
      <p className={cn('truncate text-[0.8125rem] font-bold @max-[7rem]:pr-0', niveauIA ? 'pr-11' : 'pr-6', barre)}>
        <span className="@max-[7rem]:hidden">{prenom} </span>
        {nom}
      </p>
      <p className="truncate text-[0.71875rem] opacity-85 @max-[7rem]:hidden">
        <span className="tabular-nums">
          {debut} – {fin}
        </span>{' '}
        · {motif}
      </p>
      {hauteur >= 64 ? (
        niveauIA && !ESTOMPE.includes(statut) && !PASSE.includes(statut) ? (
          <p className="mt-1.5 truncate @max-[7rem]:hidden">
            <span
              className="rounded-full px-2 py-0.5 text-[0.6875rem] font-bold text-white"
              style={{ background: NIVEAU_URGENCE[niveauIA].couleur }}
            >
              {NIVEAU_URGENCE[niveauIA].libelle}
            </span>
          </p>
        ) : (
          <p className="mt-1.5 truncate text-[0.6875rem] font-semibold @max-[7rem]:hidden" style={{ color: urgence ? '#B42318' : couleurStatut }}>
            {urgence && !ESTOMPE.includes(statut) && !PASSE.includes(statut) ? 'Urgence' : LIBELLE_STATUT[statut]}
          </p>
        )
      ) : null}
    </div>
  )
}
