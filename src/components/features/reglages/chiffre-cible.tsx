'use client'

/**
 * Un chiffre du bandeau qui montre ce qu'il compte (Marving, 28/10 : « les chiffres sont cliquables ») : la page
 * défile jusqu'au premier élément marqué `data-cible`, et chacun s'éclaire un instant.
 */
export function ChiffreCible({ cible, children }: { cible: string; children: React.ReactNode }) {
  return (
    <a
      href={`#${cible}`}
      onClick={(e) => {
        e.preventDefault()
        const elements = [...document.querySelectorAll<HTMLElement>(`[data-cible~="${cible}"]`)]
        elements[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        for (const el of elements) {
          // Retirer puis remettre la classe relance l'animation à chaque clic.
          el.classList.remove('cible-eclairee')
          void el.offsetWidth
          el.classList.add('cible-eclairee')
        }
      }}
      className="group rounded-2xl outline-offset-4 focus-visible:outline-2 focus-visible:outline-[#387a70]"
    >
      {children}
    </a>
  )
}
