import { ChevronDown } from 'lucide-react'

import type { RoleName } from '@prisma/client'

import { LIBELLE_ROLE } from '@/lib/roles'
import { choisirCabinetAction } from '@/server/actions/cabinet'
import { deconnexionAction } from '@/server/actions/auth'
import type { CabinetAccessible } from '@/server/cabinet-choisi'

const BOUTON =
  'flex h-10 items-center gap-2 rounded-sm border border-border bg-background px-6 text-sm font-medium text-foreground'

/** Menu du cabinet affiché. Un seul cabinet accessible : rien à choisir. */
export function SelecteurCabinet({
  choisi,
  cabinets,
}: {
  choisi: CabinetAccessible | null
  cabinets: CabinetAccessible[]
}) {
  if (!choisi) return null
  if (cabinets.length < 2) return <span className={BOUTON}>{choisi.nom}</span>

  return (
    <details className="relative">
      <summary className={`${BOUTON} cursor-pointer list-none hover:border-primary [&::-webkit-details-marker]:hidden`}>
        {choisi.nom}
        <ChevronDown aria-hidden className="size-4" />
        <span className="sr-only">— changer de cabinet</span>
      </summary>
      <form
        action={choisirCabinetAction}
        className="absolute right-0 z-40 mt-1 min-w-full overflow-hidden rounded-sm border border-border bg-background py-1 shadow-md"
      >
        {cabinets.map((c) => (
          <button
            key={c.id}
            type="submit"
            name="cabinet"
            value={c.id}
            aria-current={c.id === choisi.id ? 'true' : undefined}
            className="block w-full px-4 py-2 text-left text-sm whitespace-nowrap hover:bg-muted aria-[current=true]:font-semibold"
          >
            {c.nom}
          </button>
        ))}
      </form>
    </details>
  )
}

/** Initiales de la personne connectée ; au clic, son nom et la déconnexion. */
export function MenuCompte({
  prenom,
  nom,
  email,
  roles,
}: {
  prenom: string
  nom: string
  email: string
  roles: string[]
}) {
  const initiales = `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase()

  return (
    <details className="relative">
      <summary className="grid size-9 cursor-pointer list-none place-items-center rounded-full bg-[#e4f1ee] text-[0.8125rem] font-bold text-[#387a70] [&::-webkit-details-marker]:hidden">
        <span aria-hidden>{initiales}</span>
        <span className="sr-only">
          Compte de {prenom} {nom}
        </span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-64 rounded-sm border border-border bg-background p-4 shadow-md">
        <p className="font-medium">
          {prenom} {nom}
        </p>
        <p className="text-sm text-muted-foreground">{email}</p>
        <p className="mt-0.5 text-sm text-muted-foreground first-letter:uppercase">{roles.map((r) => LIBELLE_ROLE[r as RoleName] ?? r).join(', ').toLowerCase()}</p>
        <form action={deconnexionAction} className="mt-3 border-t border-border pt-3">
          <button type="submit" className="text-sm text-primary underline-offset-4 hover:underline">
            Se déconnecter
          </button>
        </form>
      </div>
    </details>
  )
}
