'use client'

import type { StatutRendezVous } from '@prisma/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import {
  formatHeureMinutesISO,
  grilleMois,
  heureCabinet,
  jourLocal,
  minutesDepuisMinuit,
  premierJourMois,
} from '@/lib/dates'
import { depasseLeSeuil } from '@/lib/glisser-agenda'
import { estJourFerie, libelleFerie } from '@/lib/jours-feries'
import { DEPLACABLE_PAR_GLISSER, ESTOMPE } from '@/lib/statuts'
import { cn } from '@/lib/utils'
import { type EtatAgenda, deplacerRendezVousAction } from '@/server/actions/agenda'

import { attributsCarte, useFicheRendezVous, useStatutsAJour } from './panneau-rendez-vous'

// Vue mois (maquettes du 13/10) : pour chaque jour, ses premiers rendez-vous
// (« 08:30 Dupont ») et le nombre des autres — comme les vues jour et semaine,
// qui nomment déjà les patients.
//
// Glisser-déposer (demandé par Marving le 19/10, comme le jour et la semaine) :
// on attrape un rendez-vous et on le pose sur un autre jour. Il garde son heure ;
// le serveur choisit le fauteuil (D11) et refuse si le praticien n'est pas là ce
// jour-là dans ce cabinet — le rendez-vous reste alors en place, avec la raison.
// Mêmes règles que les deux autres vues : souris ou stylet (le tactile fait
// défiler), statuts déplaçables seulement, Échap annule.
//
// Tableau sémantique plutôt qu'une grille de `div` : c'est ce qui rend le mois
// lisible au lecteur d'écran (RGAA) — en-têtes de colonnes, une ligne par semaine.

const JOURS_ENTETE = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
const VISIBLES = 3

export type RendezVousMoisVue = {
  id: string
  debut: Date
  statut: StatutRendezVous
  praticien: { couleur: string }
  patient: { nom: string }
}

export type BandeauJour = { texte: string; ton: 'ailleurs' | 'conge' }

type Geste = {
  rdv: RendezVousMoisVue
  jourOrigine: string
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  aFranchiSeuil: boolean
  vise: string | null
}

/** Le jour sous le pointeur, lu sur la cellule (`data-jour`) — `null` hors du calendrier. */
function jourSous(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)
  return el?.closest<HTMLElement>('[data-jour]')?.dataset.jour ?? null
}

export function CalendrierMois({
  jour,
  aujourdHui,
  rendezVous: rendezVousRecus,
  bandeaux,
  liens,
  peutDeplacer = false,
}: {
  /** N'importe quel jour du mois affiché — sert d'ancre, pas de sélection. */
  jour: string
  aujourdHui: string
  rendezVous: RendezVousMoisVue[]
  bandeaux: Record<string, BandeauJour[]>
  /** L'adresse de la vue jour de chaque jour affiché (calculée côté serveur). */
  liens: Record<string, string>
  peutDeplacer?: boolean
}) {
  const router = useRouter()
  const { ouvrir, selection } = useFicheRendezVous()
  const rendezVous = useStatutsAJour(rendezVousRecus)
  const gesteRef = useRef<Geste | null>(null)
  const [geste, setGeste] = useState<Geste | null>(null)
  const [enVol, setEnVol] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  // Un lâcher, même sur le jour d'origine, reste un geste : le clic qui suit ne
  // doit pas ouvrir la vue jour comme un clic ordinaire.
  const clicAIgnorer = useRef(false)

  const definir = (g: Geste | null) => {
    gesteRef.current = g
    setGeste(g)
  }

  const aFranchiSeuil = geste?.aFranchiSeuil ?? false
  useEffect(() => {
    if (!aFranchiSeuil) return
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clicAIgnorer.current = true
        gesteRef.current = null
        setGeste(null)
      }
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [aFranchiSeuil])

  useEffect(() => {
    if (!erreur) return
    const t = setTimeout(() => setErreur(null), 8000)
    return () => clearTimeout(t)
  }, [erreur])

  const moisAffiche = premierJourMois(jour).slice(0, 7)
  const parJour = new Map<string, RendezVousMoisVue[]>()
  for (const r of rendezVous) {
    const j = jourLocal(r.debut)
    parJour.set(j, [...(parJour.get(j) ?? []), r])
  }
  // Le cabinet ne reçoit pas le dimanche : la colonne n'apparaît que si un
  // dimanche du mois porte un rendez-vous.
  const semaines = grilleMois(jour)
  const avecDimanche = semaines.some((s) => (parJour.get(s[6]!)?.length ?? 0) > 0)
  const colonnes = avecDimanche ? 7 : 6

  function demarrer(e: React.PointerEvent<HTMLElement>, rdv: RendezVousMoisVue, jourOrigine: string) {
    if (gesteRef.current || enVol) return
    if (!peutDeplacer || !DEPLACABLE_PAR_GLISSER.includes(rdv.statut)) return
    if (e.pointerType === 'touch') return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setErreur(null)
    definir({
      rdv,
      jourOrigine,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      aFranchiSeuil: false,
      vise: jourOrigine,
    })
  }

  function bouger(e: React.PointerEvent<HTMLElement>) {
    const g = gesteRef.current
    if (!g || g.pointerId !== e.pointerId) return
    if (!g.aFranchiSeuil && !depasseLeSeuil(e.clientX - g.startX, e.clientY - g.startY)) return
    e.preventDefault()
    definir({ ...g, aFranchiSeuil: true, x: e.clientX, y: e.clientY, vise: jourSous(e.clientX, e.clientY) })
  }

  async function lacher(e: React.PointerEvent<HTMLElement>) {
    const g = gesteRef.current
    if (!g || g.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    definir(null)
    if (!g.aFranchiSeuil) return
    clicAIgnorer.current = true
    // Hors du calendrier ou sur le même jour : rien ne bouge.
    if (!g.vise || g.vise === g.jourOrigine) return

    const donnees = new FormData()
    donnees.set('id', g.rdv.id)
    donnees.set('jour', g.vise)
    donnees.set('heure', formatHeureMinutesISO(minutesDepuisMinuit(g.rdv.debut, g.jourOrigine)))
    setEnVol(g.rdv.id)
    try {
      const resultat = await deplacerRendezVousAction({} as EtatAgenda, donnees)
      if (resultat.erreur) setErreur(resultat.erreur)
      else router.refresh()
    } catch {
      setErreur('Le déplacement a échoué. Réessayez.')
    } finally {
      setEnVol(null)
    }
  }

  const glisse = geste?.aFranchiSeuil ? geste : null

  return (
    <div className="overflow-x-auto">
      {erreur ? (
        <p
          role="alert"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-sm border border-etat-erreur/30 bg-etat-erreur-fond px-3 py-2 text-sm text-etat-erreur shadow-lg"
        >
          {erreur}
        </p>
      ) : null}

      {glisse ? (
        // L'étiquette suit le pointeur : on voit ce qu'on transporte, et l'heure qu'il garde.
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rounded-sm border border-primary bg-card px-2 py-1 text-[0.8125rem] shadow-lg"
          style={{ left: glisse.x + 12, top: glisse.y + 12 }}
        >
          <span className="tabular-nums">{heureCabinet(glisse.rdv.debut)}</span> {glisse.rdv.patient.nom}
        </div>
      ) : null}

      <table className="w-full min-w-3xl table-fixed border-collapse text-[0.8125rem]">
        <thead>
          <tr>
            {JOURS_ENTETE.slice(0, colonnes).map((j) => (
              <th
                key={j}
                scope="col"
                className="px-3 pb-3 text-left text-xs font-medium tracking-[0.12em] text-muted-foreground"
              >
                {j}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semaines.map((semaine) => (
            <tr key={semaine[0]}>
              {semaine.slice(0, colonnes).map((j) => {
                const horsMois = !j.startsWith(moisAffiche)
                const ferie = libelleFerie(j)
                const du = parJour.get(j) ?? []
                const reste = du.length - VISIBLES
                const cible = glisse !== null && glisse.vise === j && j !== glisse.jourOrigine
                return (
                  <td
                    key={j}
                    data-jour={j}
                    className={cn(
                      'h-[10.75rem] border border-border align-top',
                      horsMois && 'bg-secondary/70',
                      cible && 'bg-primary/10 outline-2 -outline-offset-2 outline-primary outline-dashed',
                    )}
                  >
                    {/* La case entière mène à la vue jour, sauf un clic sur un rendez-vous, qui
                        ouvre sa fiche. Le lien accessible est le numéro du jour : un bouton de
                        rendez-vous ne peut pas vivre à l'intérieur d'un lien. */}
                    <div
                      onClick={() => {
                        if (clicAIgnorer.current) {
                          clicAIgnorer.current = false
                          return
                        }
                        const lien = liens[j]
                        if (lien) router.push(lien)
                      }}
                      className="flex h-full cursor-pointer flex-col gap-1.5 p-3 hover:bg-muted/40"
                    >
                      <Link
                        href={liens[j] ?? '#'}
                        // Un lien se glisse nativement (vers la barre d'adresse) : ce glisser-là
                        // coupe les événements du pointeur et le rendez-vous ne bougerait jamais.
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Voir le ${j}, ${du.length} rendez-vous${estJourFerie(j) ? `, jour férié : ${ferie}` : ''}`}
                        className={cn(
                          'flex size-7 items-center justify-center rounded-sm text-base tabular-nums hover:underline',
                          horsMois && 'text-muted-foreground/60',
                          j === aujourdHui && 'choix-actif font-semibold',
                        )}
                      >
                        {Number(j.slice(8, 10))}
                      </Link>
                      {ferie ? (
                        <span className="rounded-sm bg-etat-alerte-fond px-1.5 py-0.5 text-[0.6875rem] text-etat-alerte">
                          Férié : {ferie}
                        </span>
                      ) : null}
                      {(bandeaux[j] ?? []).map((b) => (
                        <span
                          key={b.texte}
                          className={cn(
                            'truncate rounded-sm px-1.5 py-0.5 text-[0.6875rem]',
                            b.ton === 'ailleurs' ? 'bg-[#EFEAFB] text-[#5B3FB0]' : 'bg-secondary text-muted-foreground',
                          )}
                        >
                          {b.texte}
                        </span>
                      ))}
                      {du.slice(0, VISIBLES).map((r) => {
                        const eligible = peutDeplacer && DEPLACABLE_PAR_GLISSER.includes(r.statut)
                        return (
                          <span
                            key={r.id}
                            data-rendez-vous={r.id}
                            // Le clic ouvre la fiche au lieu de suivre le lien de la case ; après un
                            // glisser, le lien est déjà neutralisé par `clicAIgnorer`.
                            {...attributsCarte(r.id, ouvrir)}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (clicAIgnorer.current) {
                                clicAIgnorer.current = false
                                return
                              }
                              ouvrir(r.id)
                            }}
                            onPointerDown={eligible ? (e) => demarrer(e, r, j) : undefined}
                            onPointerMove={eligible ? bouger : undefined}
                            onPointerUp={eligible ? (e) => void lacher(e) : undefined}
                            onPointerCancel={eligible ? () => definir(null) : undefined}
                            className={cn(
                              '-mx-1 flex min-w-0 items-center gap-1.5 rounded-sm px-1',
                              eligible ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                              'hover:bg-background focus-visible:outline-2 focus-visible:outline-ring',
                              selection === r.id && 'bg-background ring-2 ring-primary',
                              (glisse?.rdv.id === r.id || enVol === r.id) && 'opacity-40',
                            )}
                          >
                            <span
                              aria-hidden
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: r.praticien.couleur }}
                            />
                            <span
                              className={cn(
                                'truncate',
                                ESTOMPE.includes(r.statut) && 'text-muted-foreground line-through',
                              )}
                            >
                              <span className="tabular-nums">{heureCabinet(r.debut)}</span> {r.patient.nom}
                            </span>
                          </span>
                        )
                      })}
                      {reste > 0 ? (
                        <span className="pl-3 text-primary">
                          + {reste} {reste > 1 ? 'autres' : 'autre'}
                        </span>
                      ) : null}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
