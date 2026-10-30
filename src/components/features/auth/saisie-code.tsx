'use client'

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'

const LONGUEUR = 6

/**
 * Code à six chiffres saisi en six cases, envoyé au serveur dans un seul champ
 * caché `name`. Le code reçu par SMS proposé par iOS ou Android arrive en entier
 * dans la première case (autoComplete="one-time-code") : il est réparti sur les
 * six, comme un code collé.
 */
export function SaisieCode({
  name,
  idLibelle,
  decritPar,
}: {
  name: string
  idLibelle: string
  decritPar: string
}) {
  const [chiffres, setChiffres] = useState<string[]>(() => Array(LONGUEUR).fill(''))
  const cases = useRef<(HTMLInputElement | null)[]>([])

  function remplir(depart: number, texte: string) {
    const recus = texte.replace(/\D/g, '').slice(0, LONGUEUR - depart).split('')
    if (recus.length === 0) return
    setChiffres((avant) => {
      const apres = [...avant]
      recus.forEach((c, k) => {
        apres[depart + k] = c
      })
      return apres
    })
    cases.current[Math.min(depart + recus.length, LONGUEUR - 1)]?.focus()
  }

  function vider(i: number) {
    setChiffres((avant) => avant.map((c, k) => (k === i ? '' : c)))
  }

  function auClavier(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !chiffres[i] && i > 0) {
      e.preventDefault()
      vider(i - 1)
      cases.current[i - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      cases.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < LONGUEUR - 1) {
      e.preventDefault()
      cases.current[i + 1]?.focus()
    }
  }

  function aCollage(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    remplir(i, e.clipboardData.getData('text'))
  }

  return (
    <div role="group" aria-labelledby={idLibelle} aria-describedby={decritPar}>
      <input type="hidden" name={name} value={chiffres.join('')} />
      <div className="grid grid-cols-6 gap-3">
        {chiffres.map((chiffre, i) => (
          <input
            key={i}
            ref={(el) => {
              cases.current[i] = el
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            autoFocus={i === 0}
            aria-label={`Chiffre ${i + 1} sur ${LONGUEUR}`}
            value={chiffre}
            onChange={(e) => (e.target.value === '' ? vider(i) : remplir(i, e.target.value))}
            onKeyDown={(e) => auClavier(i, e)}
            onPaste={(e) => aCollage(i, e)}
            onFocus={(e) => e.target.select()}
            className="champ chiffres h-[4.5rem] px-0 text-center text-[1.75rem] font-medium focus:border-[#387a70]"
          />
        ))}
      </div>
    </div>
  )
}
