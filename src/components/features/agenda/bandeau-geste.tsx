'use client'

import type { StatutRendezVous } from '@prisma/client'
import { Check, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { depasseLeSeuil } from '@/lib/glisser-agenda'
import { RAISON_FIGE } from '@/lib/statuts'
import { cn } from '@/lib/utils'

// Ce qui accompagne un glisser-déposer dans la grille (23/10) : le bandeau qui confirme — avec « Annuler » — ou qui
// dit pourquoi la place est refusée, et l'appui long qui lance le geste au doigt, sur tablette.

export type Bandeau = {
  ton: 'info' | 'erreur'
  message: string
  action?: { libelle: string; faire: () => void }
  /** Reste affiché jusqu'à ce qu'on le remplace : le mode d'emploi du déplacement au clavier, le temps qu'il dure. */
  persistant?: boolean
}

export function BandeauGeste({ bandeau, fermer }: { bandeau: Bandeau | null; fermer: () => void }) {
  // Il s'efface seul : dix secondes pour revenir sur un déplacement, sept pour lire un refus.
  useEffect(() => {
    if (!bandeau || bandeau.persistant) return
    const t = setTimeout(fermer, bandeau.action ? 10_000 : 7_000)
    return () => clearTimeout(t)
  }, [bandeau, fermer])

  if (!bandeau) return null
  const erreur = bandeau.ton === 'erreur'
  const Icone = erreur ? TriangleAlert : Check
  return (
    <div
      role={erreur ? 'alert' : 'status'}
      className={cn(
        'fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-full border px-5 py-3 text-sm shadow-lg lg:bottom-6',
        erreur ? 'border-etat-erreur/30 bg-etat-erreur-fond text-etat-erreur' : 'border-[#d4e6e1] bg-white text-encre',
      )}
    >
      <Icone aria-hidden className="size-4 shrink-0" strokeWidth={2.2} />
      <p className="min-w-0 flex-1">{bandeau.message}</p>
      {bandeau.action ? (
        <button
          type="button"
          onClick={() => {
            bandeau.action!.faire()
            fermer()
          }}
          className="shrink-0 rounded-full bg-primary px-4 py-1.5 font-semibold text-white hover:bg-marine"
        >
          {bandeau.action.libelle}
        </button>
      ) : null}
      <button type="button" onClick={fermer} aria-label="Fermer" className="shrink-0 rounded-full p-1 hover:bg-black/5">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}

/**
 * Un rendez-vous figé (terminé, au fauteuil, annulé…) qu'on essaie quand même de glisser à la souris (24/10) : le
 * curseur passe à « interdit » et le bandeau dit pourquoi. Avant, il ne se passait rien, et le glisser-déposer
 * paraissait en panne. Au doigt, rien : un glissement sur une carte figée est un défilement.
 */
export function useEssaiFige(dire: (b: Bandeau) => void) {
  const essai = useRef<{ id: string; pointerId: number; x: number; y: number; dit: boolean } | null>(null)
  const [refuse, setRefuse] = useState<string | null>(null)

  return {
    /** La carte dont l'essai est en cours : son curseur passe à « interdit ». */
    refuse,
    appui(e: React.PointerEvent, id: string) {
      if (e.pointerType === 'touch' || e.button !== 0) return
      essai.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, dit: false }
      // Le lâcher et le clic qui suit restent à la carte, même relâchés ailleurs : sans quoi le clic tombait sur la
      // case vide d'en dessous, qui ouvre « Nouveau rendez-vous ».
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    glisse(e: React.PointerEvent, id: string, statut: StatutRendezVous) {
      const a = essai.current
      if (!a || a.id !== id || a.pointerId !== e.pointerId || a.dit) return
      if (!depasseLeSeuil(e.clientX - a.x, e.clientY - a.y)) return
      a.dit = true
      setRefuse(id)
      dire({ ton: 'erreur', message: RAISON_FIGE[statut] ?? 'Ce rendez-vous ne se déplace pas.' })
    },
    lache(e: React.PointerEvent) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      setRefuse(null)
    },
    abandon() {
      essai.current = null
      setRefuse(null)
    },
    /** À appeler au clic de la carte : vrai si ce clic termine un essai de glisser, qui n'ouvre pas la fiche. */
    clicApresEssai() {
      const a = essai.current
      essai.current = null
      return Boolean(a?.dit)
    },
  }
}

/** Le geste lancé au clavier se distingue d'un pointeur par cet identifiant, qu'aucun pointeur ne porte. */
export const CLAVIER = -1

export const MODE_EMPLOI_CLAVIER: Bandeau = {
  ton: 'info',
  message: 'Flèches : déplacer · Maj : durée · Entrée : valider · Échap : annuler',
  persistant: true,
}

/** Durée de l'appui qui lance le glisser au doigt : plus court, il prendrait un simple défilement pour un geste. */
export const APPUI_LONG_MS = 400

/**
 * Au doigt, le geste ne démarre qu'après un appui long ; pendant qu'il dure, la page ne défile plus. L'écouteur est
 * posé une fois pour toutes, non passif : un navigateur décide au toucher initial s'il peut défiler sans attendre,
 * un écouteur ajouté en cours de route arriverait trop tard pour l'en empêcher.
 */
export function useBlocageDefilement(conteneur: RefObject<HTMLElement | null>, gesteActif: () => boolean) {
  const actif = useRef(gesteActif)
  useEffect(() => {
    actif.current = gesteActif
  })
  useEffect(() => {
    const el = conteneur.current
    if (!el) return
    const bloquer = (e: TouchEvent) => {
      if (actif.current()) e.preventDefault()
    }
    el.addEventListener('touchmove', bloquer, { passive: false })
    return () => el.removeEventListener('touchmove', bloquer)
  }, [conteneur])
}
