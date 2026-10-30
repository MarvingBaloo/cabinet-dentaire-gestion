import Image from 'next/image'

import { cn } from '@/lib/utils'

/**
 * La dent dans son contour sauge, sur un carré blanc arrondi (charte « MG Cabinet dentaire », 22/10).
 * Le texte « MG Cabinet dentaire » du logo n'est pas repris : le nom s'écrit à côté, en vraie police.
 * Image détourée depuis le JPG reçu ; à remplacer par le SVG du graphiste s'il arrive.
 */
export function Logo({ className, taille = 36 }: { className?: string; taille?: number }) {
  const image = Math.round(taille * 0.84)
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[30%] bg-white shadow-[0_6px_16px_-8px_rgb(40_60_55/0.35)]',
        className,
      )}
      style={{ width: taille, height: taille }}
    >
      <Image src="/images/marque/logo.png" alt="" width={image} height={image} className="object-contain" />
    </span>
  )
}
