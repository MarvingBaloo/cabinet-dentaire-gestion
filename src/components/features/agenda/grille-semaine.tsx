import Link from 'next/link'

import { jourLocal } from '@/lib/dates'
import {
  DEBUT_GRILLE,
  FIN_GRILLE,
  HAUTEUR_PAS_SEMAINE,
  PAS,
  type PresenceGrille,
  type PresenceNommee,
} from '@/lib/glisser-agenda'
import { libelleFerie } from '@/lib/jours-feries'
import { cn } from '@/lib/utils'

import { type RendezVousSemaineVue } from './carte-rendez-vous-semaine'
import { GrilleSemaineGlissable } from './grille-semaine-glissable'

export type { RendezVousSemaineVue }

// Vue semaine : une colonne par jour ouvré (lundi→samedi — les deux cabinets
// sont fermés le dimanche), une échelle des heures discrète à gauche, des
// filets verticaux seulement. Un clic sur l'en-tête d'un jour renvoie à sa vue
// détaillée. Les cartes et le glisser-déposer vivent dans
// `GrilleSemaineGlissable` (client), dans une cellule qui couvre toutes les
// colonnes — même montage que la vue jour.

const NOMS_COURTS = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE']

function heures(): number[] {
  const out: number[] = []
  for (let m = DEBUT_GRILLE; m <= FIN_GRILLE; m += 60) out.push(m)
  return out
}

export function GrilleSemaine({
  jours,
  rendezVous,
  consolide = false,
  hrefJour,
  aujourdHui,
  peutDeplacer = false,
  peutCreer = false,
  presences = [],
  occupation = [],
  siteId = null,
  notesParJour,
  ailleurs = {},
}: {
  /** `AAAA-MM-JJ`, dans l'ordre d'affichage — voir `joursSemaineAffiches`. */
  jours: string[]
  rendezVous: RendezVousSemaineVue[]
  /** Ajoute le badge du site sur chaque rendez-vous — jamais la couleur seule (RGAA). */
  consolide?: boolean
  hrefJour: (jour: string) => string
  /** Fourni par la page, qui lit l'horloge via la fonction d'accès : jamais ici. */
  aujourdHui: string
  peutDeplacer?: boolean
  /** Un clic sur une case vide crée le rendez-vous, pré-rempli (19/10). */
  peutCreer?: boolean
  presences?: PresenceGrille[]
  /** Toutes les présences, nommées : ce que le glisser-déposer vérifie pendant le geste. */
  occupation?: PresenceNommee[]
  /** Le cabinet affiché, `null` en vue consolidée. */
  siteId?: string | null
  /** Notes du jour, déjà rendues, sous chaque en-tête — hors du `Link` (un bouton dans un lien est invalide). */
  notesParJour?: Record<string, React.ReactNode>
  /** « Dr Valmy à Guadeloupe » : praticiens consultant ce jour dans un autre
   *  cabinet que celui affiché — seulement si l'appelant voit ce cabinet (D5). */
  ailleurs?: Record<string, string[]>
}) {
  const hauteur = ((FIN_GRILLE - DEBUT_GRILLE) / PAS) * HAUTEUR_PAS_SEMAINE
  const lignesHeures = heures()

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-3xl"
        style={{ gridTemplateColumns: `3.5rem repeat(${jours.length}, minmax(9rem, 1fr))` }}
      >
        <div className="sticky left-0 z-10 bg-background" />
        {jours.map((jour, i) => {
          const ferie = libelleFerie(jour)
          const courant = jour === aujourdHui
          return (
            <Link
              key={jour}
              href={hrefJour(jour)}
              className={cn(
                'border-l border-border/50 px-3 pt-2 pb-4 text-center hover:bg-muted/50',
                courant ? 'bg-[#f2f8f6] text-[#387a70]' : 'text-muted-foreground',
              )}
              aria-current={courant ? 'date' : undefined}
            >
              <span
                className={cn('block font-heading text-[1.75rem] leading-none font-bold tabular-nums', !courant && 'text-foreground')}
              >
                {Number(jour.slice(8, 10))}
              </span>
              <span className="mt-1 block text-xs font-medium tracking-widest">{NOMS_COURTS[i]}</span>
              {ferie ? <span className="block text-[11px] text-etat-alerte">Férié : {ferie}</span> : null}
              {(ailleurs[jour] ?? []).map((a) => (
                <span
                  key={a}
                  className="mt-2 block rounded-sm bg-[#EFEAFB] px-2 py-0.5 text-[0.6875rem] text-[#5B3FB0]"
                >
                  {a}
                </span>
              ))}
            </Link>
          )
        })}

        {notesParJour ? (
          <>
            <div className="sticky left-0 z-10 bg-background" />
            {jours.map((jour) => (
              <div key={jour} className="border-l border-border/50 px-3 pb-2">
                {notesParJour[jour]}
              </div>
            ))}
          </>
        ) : null}

        <div className="sticky left-0 z-10 bg-background" style={{ height: hauteur + 8 }} aria-hidden>
          {lignesHeures.map((m) => (
            <span
              key={m}
              className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
              style={{ top: ((m - DEBUT_GRILLE) / PAS) * HAUTEUR_PAS_SEMAINE }}
            >
              {String(m / 60).padStart(2, '0')}:00
            </span>
          ))}
        </div>

        <div style={{ gridColumn: `2 / span ${jours.length}` }}>
          <GrilleSemaineGlissable
            jours={jours}
            rendezVous={rendezVous.filter((r) => jours.includes(jourLocal(r.debut)))}
            consolide={consolide}
            peutDeplacer={peutDeplacer}
            peutCreer={peutCreer}
            presences={presences}
            occupation={occupation}
            siteId={siteId}
            aujourdHui={aujourdHui}
            hauteur={hauteur}
          />
        </div>
      </div>
    </div>
  )
}
