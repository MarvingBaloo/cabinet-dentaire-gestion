import Link from 'next/link'

import { cn } from '@/lib/utils'

/** Les numéros montrés : le premier, le dernier, et deux de part et d'autre de la page courante. */
export function numerosAffiches(page: number, pages: number): (number | '…')[] {
  const garde = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages))
  const tries = [...garde].sort((a, b) => a - b)
  const resultat: (number | '…')[] = []
  for (const [i, n] of tries.entries()) {
    if (i > 0 && n - tries[i - 1]! > 1) resultat.push('…')
    resultat.push(n)
  }
  return resultat
}

const PILULE = 'grid h-9 min-w-9 place-items-center rounded-full px-3 text-sm font-semibold'

/** Pages d'une liste, par liens : chaque page a son adresse (`?page=`), le retour arrière fonctionne. */
export function Pagination({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={href(page - 1)} className={cn(PILULE, 'border border-[#dde9e6] bg-white hover:bg-[#f5f9f8]')}>
          ‹ Précédente
        </Link>
      ) : null}
      {numerosAffiches(page, pages).map((n, i) =>
        n === '…' ? (
          <span key={`…${i}`} aria-hidden className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <Link
            key={n}
            href={href(n)}
            aria-current={n === page ? 'page' : undefined}
            aria-label={`Page ${n}`}
            className={cn(PILULE, n === page ? 'bg-[#387a70] text-white' : 'text-muted-foreground hover:bg-[#e4f1ee]')}
          >
            {n}
          </Link>
        ),
      )}
      {page < pages ? (
        <Link href={href(page + 1)} className={cn(PILULE, 'border border-[#dde9e6] bg-white hover:bg-[#f5f9f8]')}>
          Suivante ›
        </Link>
      ) : null}
    </nav>
  )
}
