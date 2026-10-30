import { type NiveauUrgence, StatutRendezVous } from '@prisma/client'

import { GrilleJourGlissable } from '@/components/features/agenda/grille-jour-glissable'
import {
  DEBUT_GRILLE,
  FIN_GRILLE,
  HAUTEUR_LIGNE,
  MINUTES_PAR_LIGNE,
  type PresenceGrille,
  type PresenceNommee,
} from '@/lib/glisser-agenda'
import { badgeSite, couleurSite } from '@/lib/sites'

// Grille d'une journée : une colonne par fauteuil, une ligne par demi-heure.
// C'est la vue de travail du cabinet — celle qu'on regarde toute la journée.
//
// Composant serveur, sans état : les colonnes de fauteuils sont déléguées à
// `GrilleJourGlissable` (lot 6, glisser-déposer), dans une cellule qui les
// couvre toutes (`gridColumn: 2 / span n`) — l'en-tête et la colonne des
// heures, eux, ne bougent jamais et restent rendus ici. `DEBUT_GRILLE`,
// `FIN_GRILLE`, `MINUTES_PAR_LIGNE` et `HAUTEUR_LIGNE` viennent de `@/lib/glisser-agenda` :
// une seule source pour le pas de la grille, que la lecture ET le geste
// respectent.

export type FauteuilVue = {
  id: string
  nom: string
  site: { id: string; code: string; nom: string }
}

export type RendezVousVue = {
  id: string
  debut: Date
  fin: Date
  statut: StatutRendezVous
  surbooking: boolean
  horsHoraire: boolean
  fauteuil: { id: string; nom: string }
  praticien: { id: string; nom: string; prenom: string; couleur: string }
  motif: { id: string; libelle: string; couleur: string; estUrgence: boolean }
  patient: { id: string; nom: string; prenom: string; telephone: string }
  /** Absent des lectures cantonnées à un seul site : seule la vue consolidée
   *  (lot 4) en a besoin, pour distinguer les deux cabinets à l'écran. */
  site?: { id: string; code: string; nom: string }
  /** Posé par l'assistant des urgences (D77). */
  conversationAssistant?: { niveau: NiveauUrgence | null; niveauCabinet: NiveauUrgence | null } | null
}

function creneaux(): number[] {
  const out: number[] = []
  for (let m = DEBUT_GRILLE; m <= FIN_GRILLE; m += MINUTES_PAR_LIGNE) out.push(m)
  return out
}

function etiquetteHeure(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function GrilleJour({
  jour,
  fauteuils,
  rendezVous,
  consolide = false,
  peutDeplacer = false,
  peutCreer = false,
  presences = [],
  occupation = [],
  presents = {},
}: {
  jour: string
  fauteuils: FauteuilVue[]
  rendezVous: RendezVousVue[]
  /** `hasPermission(ctx, 'agenda', 'create')` : un clic sur une case vide crée le rendez-vous. */
  peutCreer?: boolean
  /** Plages de présence, pour pré-remplir le praticien de la case cliquée. */
  presences?: PresenceGrille[]
  /** Toutes les présences, nommées : ce que le glisser-déposer vérifie pendant le geste. */
  occupation?: PresenceNommee[]
  /** Praticiens présents ce jour, par fauteuil (plages de présence). */
  presents?: Record<string, { nom: string; couleur: string }[]>
  /** Vue consolidée des deux cabinets (lot 4) : marque chaque en-tête de
   *  fauteuil de la couleur ET du badge textuel de son site — jamais la
   *  couleur seule (RGAA). N'affecte rien d'autre : les rendez-vous restent
   *  colorés par motif, comme dans la vue d'un seul site. */
  consolide?: boolean
  /** `hasPermission(ctx, 'agenda', 'update')`, lu par l'appelant (page.tsx) —
   *  jamais deviné ici. Faux par défaut : les rares appelants qui n'ont pas
   *  encore ce contexte (aucun aujourd'hui) obtiennent une grille lecture
   *  seule plutôt qu'un geste hasardeux. */
  peutDeplacer?: boolean
}) {
  const lignes = creneaux()
  const hauteur = ((FIN_GRILLE - DEBUT_GRILLE) / MINUTES_PAR_LIGNE) * HAUTEUR_LIGNE

  if (fauteuils.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
        Aucun fauteuil dans votre périmètre. Rapprochez-vous d’un administrateur si vous devriez voir un cabinet.
      </p>
    )
  }

  return (
    // La grille déborde horizontalement quand les fauteuils sont nombreux : le
    // défilement appartient au conteneur, jamais à la page.
    <div className="overflow-x-auto">
      <div
        className="grid min-w-xl gap-x-px bg-border/60"
        style={{ gridTemplateColumns: `4.5rem repeat(${fauteuils.length}, minmax(11rem, 1fr))` }}
      >
        {/* En-tête */}
        <div className="sticky left-0 z-10 bg-background" />
        {fauteuils.map((f) => (
          <div
            key={f.id}
            className="bg-background px-4 pt-5 pb-6"
            style={consolide ? { borderTop: `3px solid ${couleurSite(f.site.code)}` } : undefined}
          >
            <p className="font-heading text-[1.375rem] font-semibold">{f.nom}</p>
            <div className="mt-1.5 space-y-0.5 text-[0.8125rem] text-muted-foreground">
              {(presents[f.id] ?? []).map((p) => (
                <p key={p.nom} className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: p.couleur }} />
                  Dr {p.nom}
                </p>
              ))}
              {consolide ? (
                <p>
                  {f.site.nom}
                  <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold tabular-nums">
                    {badgeSite(f.site.code, f.site.nom)}
                  </span>
                </p>
              ) : null}
            </div>
          </div>
        ))}

        {/* Colonne des heures */}
        <div className="sticky left-0 z-10 bg-background" style={{ height: hauteur }}>
          {lignes.slice(0, -1).map((m) => (
            <div
              key={m}
              className="relative border-t border-border/60 pr-2 text-right"
              style={{ height: HAUTEUR_LIGNE }}
            >
              <span className="absolute -top-2 right-2 bg-background px-1 text-xs tabular-nums text-muted-foreground">
                {etiquetteHeure(m)}
              </span>
            </div>
          ))}
        </div>

        {/* Colonnes de fauteuils : une seule cellule de grille qui les couvre
            toutes, pour que le composant interactif (lot 6) puisse mesurer et
            repositionner sans désaligner l'en-tête ni la colonne des heures
            ci-dessus, qui restent rendus ici et ne bougent jamais. */}
        <div style={{ gridColumn: `2 / span ${fauteuils.length}` }}>
          <GrilleJourGlissable
            jour={jour}
            fauteuils={fauteuils}
            rendezVous={rendezVous}
            hauteur={hauteur}
            lignes={lignes}
            peutDeplacer={peutDeplacer}
            peutCreer={peutCreer}
            presences={presences}
            occupation={occupation}
          />
        </div>
      </div>
    </div>
  )
}
