'use client'

import { X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

// Agenda en direct (D61, maquette du 13/10) : écoute le flux du serveur, met à
// jour l'écran qui affiche l'agenda, et montre en bas à droite un bandeau
// refermable d'un clic — « Dr Aubertin a ajouté une urgence à 12:15 ».

type Banniere = { titre: string; detail: string }
type Evenement = { id: string; banniere: Banniere | null }

/** Écrans qui lisent les rendez-vous et se redessinent à chaque changement. */
const ECRANS_A_RAFRAICHIR = ['/tableau-de-bord', '/tableau-de-bord/agenda', '/tableau-de-bord/workflow']

/** Même nom que `NOM_COOKIE_MAJ_AUTO` (src/server/auth/session-courante.ts). */
const COOKIE_MAJ_AUTO = 'maj-auto'

const MAX_BANNIERES = 3

export function AgendaEnDirect() {
  const router = useRouter()
  const chemin = usePathname()
  const cheminCourant = useRef(chemin)
  useEffect(() => {
    cheminCourant.current = chemin
  }, [chemin])
  const [bannieres, setBannieres] = useState<(Banniere & { cle: string })[]>([])

  useEffect(() => {
    const source = new EventSource('/tableau-de-bord/flux-agenda')
    let attente: ReturnType<typeof setTimeout> | undefined

    source.onmessage = (message) => {
      let e: Evenement
      try {
        e = JSON.parse(message.data) as Evenement
      } catch {
        return
      }
      if (e.banniere) {
        const b = { ...e.banniere, cle: `${e.id}-${Date.now()}` }
        setBannieres((avant) => [b, ...avant].slice(0, MAX_BANNIERES))
      }
      if (!ECRANS_A_RAFRAICHIR.includes(cheminCourant.current ?? '')) return
      // Plusieurs changements d'affilée (un déplacement par glisser en écrit
      // deux) : un seul rafraîchissement. Le cookie dit au serveur que ce n'est
      // pas un geste de la personne — sa session ne s'en trouve pas prolongée.
      clearTimeout(attente)
      attente = setTimeout(() => {
        document.cookie = `${COOKIE_MAJ_AUTO}=1; path=/; max-age=10; samesite=strict`
        router.refresh()
        setTimeout(() => {
          document.cookie = `${COOKIE_MAJ_AUTO}=; path=/; max-age=0; samesite=strict`
        }, 5000)
      }, 300)
    }

    return () => {
      clearTimeout(attente)
      source.close()
    }
  }, [router])

  if (bannieres.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-20 z-50 flex w-[25rem] max-w-[calc(100vw-2rem)] flex-col gap-3 lg:right-8 lg:bottom-6"
    >
      {bannieres.map((b) => (
        <div
          key={b.cle}
          className="bande-sombre flex items-start gap-4 rounded-sm border-l-4 border-primary px-5 py-4 shadow-lg"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{b.titre}</p>
            <p className="mt-1 truncate text-[0.8125rem] text-white/70">{b.detail}</p>
          </div>
          <button
            type="button"
            onClick={() => setBannieres((avant) => avant.filter((x) => x.cle !== b.cle))}
            className="-mr-1 grid size-7 shrink-0 place-items-center rounded-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden className="size-4" />
            <span className="sr-only">Fermer</span>
          </button>
        </div>
      ))}
    </div>
  )
}
