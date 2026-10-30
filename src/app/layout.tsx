import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

import { TabulationSafari } from '@/components/features/navigation/tabulation-safari'
import { CABINET } from '@/config/cabinet'

// Polices de la charte « MG Cabinet dentaire » (22/10), servies depuis le dépôt (licence OFL) :
// next/font/google les téléchargeait à chaque construction, et une panne DNS du NAS bloquait sa démo.
const montserrat = localFont({
  variable: '--font-montserrat',
  src: [
    { path: './polices/montserrat-latin-400-normal.woff2', weight: '400' },
    { path: './polices/montserrat-latin-500-normal.woff2', weight: '500' },
    { path: './polices/montserrat-latin-600-normal.woff2', weight: '600' },
    { path: './polices/montserrat-latin-700-normal.woff2', weight: '700' },
  ],
})

// Titres du site public et du tableau de bord — un seul système partout.
const poppins = localFont({
  variable: '--font-poppins',
  src: [
    { path: './polices/poppins-latin-500-normal.woff2', weight: '500' },
    { path: './polices/poppins-latin-600-normal.woff2', weight: '600' },
    { path: './polices/poppins-latin-700-normal.woff2', weight: '700' },
    { path: './polices/poppins-latin-800-normal.woff2', weight: '800' },
  ],
})

export const metadata: Metadata = {
  title: CABINET.nomCommercial ?? CABINET.nom,
  description: CABINET.baseline,
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // data-scroll-behavior : sans lui, Next.js garde le défilement doux (globals.css)
    // pendant un changement de page, et « Retour au site » glissait jusqu'au pied
    // de l'accueil au lieu d'en ouvrir le haut.
    <html
      lang="fr"
      data-scroll-behavior="smooth"
      className={`${montserrat.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <TabulationSafari />
      </body>
    </html>
  )
}
