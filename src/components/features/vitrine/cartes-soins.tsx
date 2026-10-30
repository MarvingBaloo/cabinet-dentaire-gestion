'use client'

import { Crown, Smile, Syringe } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

import { cn } from '@/lib/utils'

type Soin = { titre: string; image: string; description: string }

const ICONE_DESSINEE = 'size-5 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]'

/** Icônes absentes de lucide (dent, implant, brosse), au même trait. */
function Dessin({ children }: { children: React.ReactNode }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={ICONE_DESSINEE}>
      {children}
    </svg>
  )
}

const ICONES: Record<string, React.ReactNode> = {
  'Soins conservateurs': (
    <Dessin>
      <path d="M7 3c-2.2 0-4 1.8-4 4.2 0 2 .7 3.3 1.3 5 .6 1.9.7 4.5 1.3 6.6.3 1.1.8 2.2 1.8 2.2 1.3 0 1.4-2.2 1.7-3.6.3-1.4.6-2.6 1.9-2.6s1.6 1.2 1.9 2.6c.3 1.4.4 3.6 1.7 3.6 1 0 1.5-1.1 1.8-2.2.6-2.1.7-4.7 1.3-6.6.6-1.7 1.3-3 1.3-5C21 4.8 19.2 3 17 3c-1.9 0-2.9 1-5 1S8.9 3 7 3z" />
    </Dessin>
  ),
  'Prothèses dentaires': <Crown aria-hidden className="size-5" strokeWidth={1.6} />,
  'Chirurgie orale': <Syringe aria-hidden className="size-5" strokeWidth={1.6} />,
  Implantologie: (
    <Dessin>
      <path d="M7 3h10l-1.5 5h-7z" />
      <path d="M9 8h6v2H9zM9.3 12h5.4M9.7 14.5h4.6M10.2 17h3.6M11 19.5 12 22l1-2.5" />
      <path d="M9 10l.5 9.5h5L15 10" />
    </Dessin>
  ),
  'Prévention et hygiène': (
    <Dessin>
      <path d="M4 20 15 9" />
      <path d="M15 9l3-3a2.1 2.1 0 0 1 3 3l-3 3z" />
      <path d="M14 5v2M17 3v2M12 7v2" />
    </Dessin>
  ),
  'Orthodontie et esthétique': <Smile aria-hidden className="size-5" strokeWidth={1.6} />,
}

/** Nombre de soins montrés d'abord sur téléphone ; « Voir tous les soins » déplie la suite sur place. */
const SUR_TELEPHONE = 3

/**
 * S1 de maquette-nos-soins.pdf (19/10) : une carte par soin, sa photo découpée en
 * hexagone dépasse au-dessus de la carte, avec une pastille à icône. Les six soins sur
 * ordinateur ; trois d'abord sur téléphone — il n'existe pas de page des soins à
 * laquelle renvoyer.
 */
export function CartesSoins({ soins, entete }: { soins: readonly Soin[]; entete: React.ReactNode }) {
  const [tous, setTous] = useState(false)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        {entete}
        <Link href="/rendez-vous" className="lien-action pb-2 text-[0.9375rem] text-primary max-lg:hidden">
          Prendre rendez-vous
        </Link>
      </div>

      <ul id="liste-soins" className="mt-[5.5rem] grid gap-x-7 gap-y-[5.5rem] sm:grid-cols-2 lg:grid-cols-3">
        {soins.map((soin, i) => (
          <li
            key={soin.titre}
            className={cn('carte-douce relative px-7 pt-[7.5rem] pb-7', !tous && i >= SUR_TELEPHONE && 'max-lg:hidden')}
          >
            <div className="hexagone absolute -top-[4.375rem] left-7 h-[11.5rem] w-40">
              <Image src={soin.image} alt="" fill sizes="160px" className="object-cover" />
            </div>
            <span className="hexagone absolute top-[4.375rem] left-40 grid h-[3.25rem] w-[2.875rem] place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white">
              {ICONES[soin.titre] ?? null}
            </span>
            <h3 className="font-heading text-[1.3125rem] leading-tight font-bold">{soin.titre}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{soin.description}</p>
            <Link href="/rendez-vous" className="lien-action mt-4 inline-flex text-sm text-primary">
              Prendre rendez-vous
            </Link>
          </li>
        ))}
      </ul>

      {soins.length > SUR_TELEPHONE ? (
        <button
          type="button"
          aria-expanded={tous}
          aria-controls="liste-soins"
          onClick={() => setTous((v) => !v)}
          className="lien-action mt-10 text-[0.9375rem] text-primary lg:hidden"
        >
          {tous ? 'Moins de soins' : 'Voir tous les soins'}
        </button>
      ) : null}
    </>
  )
}
