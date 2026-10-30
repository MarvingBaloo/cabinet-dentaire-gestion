import type { Metadata } from 'next'
import { CalendarDays, ShieldPlus } from 'lucide-react'
import Link from 'next/link'

import { CABINET } from '@/config/cabinet'
import { Logo } from '@/components/features/vitrine/logo'
import { lieuxEnActivite } from '@/server/queries/public/catalogue'

// Usage interne (personnel) : jamais indexé (lot F, D36).
export const metadata: Metadata = { robots: { index: false } }

// Lit les cabinets en activité (D74) à chaque visite, jamais à la fabrication : le texte suivrait sinon l'état
// de la base au moment du build, et la construction du NAS n'a pas de vraie base.
export const dynamic = 'force-dynamic'

const DENT =
  'M7 3c-2.2 0-4 1.8-4 4.2 0 2 .7 3.3 1.3 5 .6 1.9.7 4.5 1.3 6.6.3 1.1.8 2.2 1.8 2.2 1.3 0 1.4-2.2 1.7-3.6.3-1.4.6-2.6 1.9-2.6s1.6 1.2 1.9 2.6c.3 1.4.4 3.6 1.7 3.6 1 0 1.5-1.1 1.8-2.2.6-2.1.7-4.7 1.3-6.6.6-1.7 1.3-3 1.3-5C21 4.8 19.2 3 17 3c-1.9 0-2.9 1-5 1S8.9 3 7 3z'

/** Alvéole à contour blanc et icône, comme celles du haut de l'accueil. */
function Alveole({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={`absolute grid h-[8.625rem] w-[7.5rem] place-items-center text-white ${className}`}>
      <svg aria-hidden viewBox="0 0 120 138" className="absolute inset-0 size-full">
        <polygon
          points="60,2 118,35.5 118,102.5 60,136 2,102.5 2,35.5"
          fill="rgb(255 255 255 / 0.12)"
          stroke="#fff"
          strokeWidth={3}
          strokeLinejoin="round"
        />
      </svg>
      <span className="relative">{children}</span>
    </div>
  )
}

/** C1 de maquette-connexion.pdf (20/10) : moitié bleu-vert à alvéoles, formulaire en carte sur le fond clair. */
export default async function LayoutConnexion({ children }: { children: React.ReactNode }) {
  const lieux = await lieuxEnActivite()
  const nomAffiche = CABINET.nomCommercial ?? CABINET.nom

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* La moitié de l'écran à partir de md ; bande basse sous md. */}
      <div className="fond-v2-hexagones relative flex h-24 shrink-0 flex-col justify-center overflow-hidden px-6 md:h-auto md:w-1/2 md:justify-between md:px-14 md:py-14">
        <div className="relative z-10 flex items-center gap-3.5">
          <Logo taille={44} />
          <span className="font-heading text-lg font-bold">{nomAffiche}</span>
        </div>
        <div aria-hidden className="relative hidden h-80 lg:block">
          <Alveole className="top-0 left-1/2 -translate-x-1/2">
            <svg viewBox="0 0 24 24" className="size-11 fill-none stroke-current stroke-[1.5]">
              <path d={DENT} strokeLinejoin="round" />
            </svg>
          </Alveole>
          <Alveole className="top-[10.125rem] left-[calc(50%-6.4rem)] -translate-x-1/2">
            <ShieldPlus className="size-11" strokeWidth={1.5} />
          </Alveole>
          <Alveole className="top-[10.125rem] left-[calc(50%+6.4rem)] -translate-x-1/2">
            <CalendarDays className="size-11" strokeWidth={1.5} />
          </Alveole>
        </div>
        <div className="relative z-10 hidden max-w-xl md:block">
          <p className="text-sm text-encre/80">{lieux}</p>
          <p className="mt-2 font-heading text-[2.25rem] leading-tight font-extrabold tracking-tight">
            {lieux.includes('·') ? 'L’agenda des deux cabinets, au même endroit.' : 'L’agenda du cabinet, au même endroit.'}
          </p>
        </div>
      </div>

      <main className="fond-hexagones flex flex-1 flex-col p-4 sm:p-6 md:px-10 md:py-14">
        <div className="mx-auto w-full max-w-[31.25rem]">
          <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
            ← Retour au site
          </Link>
        </div>
        <div className="flex flex-1 items-center py-8">
          <div className="carte-douce mx-auto w-full max-w-[31.25rem] space-y-6 px-6 py-9 sm:px-11 sm:py-11">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
