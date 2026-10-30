'use client'

import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import { compterNonLusAction, reglerSonAction } from '@/server/actions/chat'

// Chat en direct (D82) : écoute le flux du serveur sur tous les écrans de l'espace du cabinet. Un message pour soi
// joue un petit son (sauf s'il est coupé) et fait monter la pastille de « Chat » ; l'écran du chat se redessine.

type Evenement = { op: 'message' | 'lu'; de: string | null; pourMoi: boolean }

type ValeurChat = {
  nonLus: number
  sonCoupe: boolean
  basculerSon: () => void
  /** Après avoir lu une conversation : la pastille reprend le compte rendu par le serveur. */
  majNonLus: (n: number) => void
}

const ContexteChat = createContext<ValeurChat>({
  nonLus: 0,
  sonCoupe: false,
  basculerSon: () => {},
  majNonLus: () => {},
})

export const useChat = () => useContext(ContexteChat)

/** Même nom que `NOM_COOKIE_MAJ_AUTO` (src/server/auth/session-courante.ts) : un rafraîchissement ne prolonge pas la session. */
const COOKIE_MAJ_AUTO = 'maj-auto'

let effacement: ReturnType<typeof setTimeout> | undefined

/** Le cookie part avec les requêtes des secondes qui suivent, comme pour l'agenda en direct. */
function sansProlonger() {
  document.cookie = `${COOKIE_MAJ_AUTO}=1; path=/; max-age=10; samesite=strict`
  clearTimeout(effacement)
  effacement = setTimeout(() => {
    document.cookie = `${COOKIE_MAJ_AUTO}=; path=/; max-age=0; samesite=strict`
  }, 5000)
}

let audio: AudioContext | null = null

/** Le navigateur ne laisse jouer un son qu'après un premier geste sur la page : on prépare le son à ce moment-là. */
function preparerSon() {
  const Ctx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  audio ??= new Ctx()
  if (audio.state === 'suspended') void audio.resume()
}

/** Deux notes douces, un quart de seconde : on l'entend sans sursauter. */
function jouerSon() {
  if (!audio || audio.state !== 'running') return
  const t = audio.currentTime
  for (const [frequence, decalage] of [
    [880, 0],
    [1318.5, 0.11],
  ] as const) {
    const osc = audio.createOscillator()
    const volume = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequence
    volume.gain.setValueAtTime(0, t + decalage)
    volume.gain.linearRampToValueAtTime(0.08, t + decalage + 0.02)
    volume.gain.exponentialRampToValueAtTime(0.0001, t + decalage + 0.28)
    osc.connect(volume).connect(audio.destination)
    osc.start(t + decalage)
    osc.stop(t + decalage + 0.3)
  }
}

export function ChatEnDirect({
  nonLusInitial,
  sonCoupeInitial,
  children,
}: {
  nonLusInitial: number
  sonCoupeInitial: boolean
  children: React.ReactNode
}) {
  const router = useRouter()
  const chemin = usePathname()
  const cheminCourant = useRef(chemin)
  useEffect(() => {
    cheminCourant.current = chemin
  }, [chemin])
  const [nonLus, setNonLus] = useState(nonLusInitial)
  const [sonCoupe, setSonCoupe] = useState(sonCoupeInitial)
  const sonCoupeCourant = useRef(sonCoupe)
  useEffect(() => {
    sonCoupeCourant.current = sonCoupe
  }, [sonCoupe])

  useEffect(() => {
    window.addEventListener('pointerdown', preparerSon)
    window.addEventListener('keydown', preparerSon)
    return () => {
      window.removeEventListener('pointerdown', preparerSon)
      window.removeEventListener('keydown', preparerSon)
    }
  }, [])

  useEffect(() => {
    const source = new EventSource('/tableau-de-bord/flux-chat')
    let attente: ReturnType<typeof setTimeout> | undefined
    source.onmessage = (message) => {
      let e: Evenement
      try {
        e = JSON.parse(message.data) as Evenement
      } catch {
        return
      }
      if (e.pourMoi && !sonCoupeCourant.current) jouerSon()
      clearTimeout(attente)
      attente = setTimeout(() => {
        sansProlonger()
        if ((cheminCourant.current ?? '').startsWith('/tableau-de-bord/chat')) router.refresh()
        void compterNonLusAction().then(setNonLus)
      }, 150)
    }
    return () => {
      clearTimeout(attente)
      source.close()
    }
  }, [router])

  const basculerSon = useCallback(() => {
    const coupe = !sonCoupeCourant.current
    setSonCoupe(coupe)
    void reglerSonAction(coupe)
  }, [])

  return (
    <ContexteChat.Provider value={{ nonLus, sonCoupe, basculerSon, majNonLus: setNonLus }}>
      {children}
    </ContexteChat.Provider>
  )
}
