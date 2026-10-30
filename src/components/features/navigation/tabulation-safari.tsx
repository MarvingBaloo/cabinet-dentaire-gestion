'use client'

import { useEffect } from 'react'

const SANS_TABINDEX = 'a[href]:not([tabindex]), button:not([tabindex]), summary:not([tabindex])'

/**
 * Safari, tel qu'il est réglé à l'achat d'un Mac, ne s'arrête à la touche Tab sur aucun lien ni aucun bouton : seuls
 * les champs, et ce qui porte un `tabindex` explicite (24/10, « on ne peut pas circuler dans l'app avec le
 * clavier ? » — le menu, les flèches de l'agenda, « Nouveau rendez-vous » étaient hors d'atteinte). On pose donc
 * `tabindex="0"` sur chaque lien et bouton, y compris ceux qui apparaissent ensuite. Un `tabindex` posé par le code
 * est laissé tel quel.
 *
 * Seulement à la première pression sur Tab : modifier la page avant que React ait fini de l'hydrater (les segments
 * arrivent en flux, après ce composant) lui fait signaler, en console, des attributs qu'il n'a pas rendus.
 */
export function TabulationSafari() {
  useEffect(() => {
    if (!/^Apple/.test(navigator.vendor)) return
    const poser = (el: Element) => {
      if (el.matches(SANS_TABINDEX)) el.setAttribute('tabindex', '0')
      el.querySelectorAll(SANS_TABINDEX).forEach((e) => e.setAttribute('tabindex', '0'))
    }
    let observateur: MutationObserver | null = null
    // À la capture : posé avant que le navigateur ne cherche l'arrêt suivant, cette pression-ci en profite déjà.
    function premiereTabulation(e: KeyboardEvent) {
      if (e.key !== 'Tab' || observateur) return
      window.removeEventListener('keydown', premiereTabulation, true)
      poser(document.body)
      observateur = new MutationObserver((mutations) => {
        for (const m of mutations) for (const n of m.addedNodes) if (n instanceof Element) poser(n)
      })
      observateur.observe(document.body, { childList: true, subtree: true })
    }
    window.addEventListener('keydown', premiereTabulation, true)
    return () => {
      window.removeEventListener('keydown', premiereTabulation, true)
      observateur?.disconnect()
    }
  }, [])
  return null
}
