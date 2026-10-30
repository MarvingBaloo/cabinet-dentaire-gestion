import Link from 'next/link'
import { Lock } from 'lucide-react'

import { CABINET } from '@/config/cabinet'
import { cn } from '@/lib/utils'
import { lieuxEnActivite } from '@/server/queries/public/catalogue'
import { Logo } from './logo'

const NAVIGATION = [
  { href: '/#le-cabinet', libelle: 'Le cabinet' },
  { href: '/#nos-soins', libelle: 'Nos soins' },
  { href: '/#equipe', libelle: 'L’équipe' },
  { href: '/#conseils', libelle: 'Conseils' },
  { href: '/#acces', libelle: 'Accès' },
]

const lienClair =
  'rounded-full px-4 py-2 whitespace-nowrap text-foreground transition-colors hover:bg-primary/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const lienSurBande =
  'rounded-full px-4 py-2 whitespace-nowrap text-encre transition-colors hover:bg-white/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-encre'

/**
 * Transparent, superposé au fond clair des hauts de page (direction « clair
 * clinique », 19/10) ; `clair` le pose sur un fond blanc plein, comme sur
 * l'écran de saisie du code ; `surCouleur` le pose sur le haut sauge clair
 * de l'accueil (charte V4, 22/10). Menu replié en `<details>` natif : pas de JS pour un
 * simple repli.
 */
export async function EnTetePublic({ clair = false, surCouleur = false }: { clair?: boolean; surCouleur?: boolean }) {
  const nomAffiche = CABINET.nomCommercial ?? CABINET.nom
  const lieux = await lieuxEnActivite()

  return (
    <header className={cn('inset-x-0 top-0 z-40', clair ? 'relative bg-background' : 'absolute')}>
      <div className="mx-auto flex h-[6.75rem] max-w-[90rem] items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6 lg:pr-12 lg:pl-20">
        <Link
          href="/"
          aria-label={nomAffiche}
          className={cn('flex items-center gap-3', surCouleur ? 'text-encre' : 'text-foreground')}
        >
          <Logo taille={44} />
          <span className="hidden leading-tight min-[420px]:block">
            <span className="block font-heading text-lg font-semibold whitespace-nowrap">{nomAffiche}</span>
            <span
              className={cn('block text-xs whitespace-nowrap', surCouleur ? 'text-encre/75' : 'text-muted-foreground')}
            >
              {lieux}
            </span>
          </span>
        </Link>

        {/* Le menu complet ne tient sur une ligne qu'à partir de 1280 px : en dessous, il se replie. */}
        <nav aria-label="Navigation principale" className="hidden xl:block">
          <ul className="flex items-center gap-1 text-[0.9375rem]">
            {NAVIGATION.map((lien) => (
              <li key={lien.href}>
                <a href={lien.href} className={surCouleur ? lienSurBande : lienClair}>
                  {lien.libelle}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Le patient qui a déjà rendez-vous le retrouve ici : déplacer, annuler, son historique. */}
          <Link
            href="/mes-rendez-vous"
            className={cn(
              'hidden h-11 items-center rounded-full px-5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:inline-flex',
              surCouleur
                ? 'border-[1.5px] border-encre/50 text-encre hover:bg-white/40 focus-visible:outline-encre'
                : 'border border-border bg-white/70 text-foreground backdrop-blur hover:bg-white focus-visible:outline-ring',
            )}
          >
            Mes rendez-vous
          </Link>
          <Link
            href="/rendez-vous"
            className={cn(
              'lien-action inline-flex h-10 items-center px-4 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 sm:h-11 sm:px-5',
              surCouleur
                ? 'rounded-full bg-white text-[#387a70] shadow-[0_12px_28px_-12px_rgb(30_70_62/0.45)] hover:bg-white/90 focus-visible:outline-encre'
                : 'bouton-principal focus-visible:outline-ring',
            )}
          >
            {/* Sur téléphone, le seul bouton visible du site (tour du 20/10) : il ne se cache pas dans le menu. */}
            <span className="sm:hidden">Rendez-vous</span>
            <span className="hidden sm:inline">Prendre rendez-vous</span>
          </Link>
        </div>

        <details className="group xl:hidden">
          <summary
            className={cn(
              'grid size-11 cursor-pointer list-none place-items-center rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden',
              surCouleur
                ? 'border-[1.5px] border-encre/50 text-encre focus-visible:outline-encre'
                : 'border border-border bg-white/70 text-foreground backdrop-blur focus-visible:outline-ring',
            )}
          >
            <span aria-hidden className="text-lg">
              ☰
            </span>
            <span className="sr-only">Menu</span>
          </summary>
          <div className="carte-douce absolute inset-x-4 top-full z-50 mt-2 p-4 text-foreground sm:inset-x-6">
            <ul className="space-y-1 text-sm">
              {NAVIGATION.map((lien) => (
                <li key={lien.href}>
                  <a href={lien.href} className="block rounded-full px-4 py-2.5 hover:bg-muted">
                    {lien.libelle}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/rendez-vous" className="bouton-principal mt-2 block px-4 py-3 text-center font-semibold">
                  Prendre rendez-vous
                </Link>
              </li>
              <li>
                <Link href="/mes-rendez-vous" className="block rounded-full px-4 py-2.5 hover:bg-muted">
                  Mes rendez-vous
                </Link>
              </li>
              <li>
                <Link
                  href="/connexion"
                  className="flex items-center gap-1.5 rounded-full px-4 py-2.5 text-muted-foreground hover:bg-muted"
                >
                  <Lock aria-hidden className="size-3.5" />
                  Espace professionnel
                </Link>
              </li>
            </ul>
          </div>
        </details>
      </div>
    </header>
  )
}
