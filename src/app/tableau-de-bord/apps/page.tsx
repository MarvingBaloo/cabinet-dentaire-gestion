import { redirect } from 'next/navigation'

import { exigerContexte } from '@/server/auth/session-courante'

// Apps (Marving, 27/10) : là où le praticien lira ce que remontent les applications connectées au cabinet. Aucune
// ne l'est encore. Réservé aux praticiens et à l'administrateur, comme l'icône du menu.

export const metadata = { title: 'Apps' }

export default async function PageApps() {
  const ctx = await exigerContexte()
  if (!ctx.roles.includes('PRATICIEN') && !ctx.roles.includes('ADMIN')) redirect('/tableau-de-bord')

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <header>
        <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-bold">Apps</h1>
      </header>
      <p className="carte-douce px-6 py-10 text-center text-muted-foreground">Aucune application connectée pour l’instant.</p>
    </div>
  )
}
