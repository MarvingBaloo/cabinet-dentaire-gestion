'use client'

import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

/**
 * Contenu du tableau de bord. L'Accueil suit sa maquette du 13/10 : fond blanc,
 * aligné à gauche. Les autres écrans gardent leur fond tant que leur maquette
 * n'est pas codée ; l'agenda (vues semaine, mois, consolidée) a besoin de toute
 * la largeur disponible.
 */
// Écrans déjà refaits selon leur maquette du 13/10 : fond blanc, marges de la maquette.
const ECRANS_REFAITS = [
  '/tableau-de-bord',
  '/tableau-de-bord/agenda/nouveau',
  '/tableau-de-bord/presences',
  '/tableau-de-bord/indisponibilites',
  '/tableau-de-bord/liste-attente',
  '/tableau-de-bord/motifs',
  '/tableau-de-bord/patients',
  '/tableau-de-bord/patients/bloques',
  '/tableau-de-bord/messages',
  '/tableau-de-bord/comptes',
  '/tableau-de-bord/postes',
]

const FOND_CREME = [
  '/tableau-de-bord',
  '/tableau-de-bord/patients',
  '/tableau-de-bord/liste-attente',
  '/tableau-de-bord/messages',
  '/tableau-de-bord/comptes',
  '/tableau-de-bord/postes',
  '/tableau-de-bord/journal',
  '/tableau-de-bord/presences',
  '/tableau-de-bord/indisponibilites',
  '/tableau-de-bord/motifs',
  '/tableau-de-bord/patients/bloques',
  '/tableau-de-bord/agenda/nouveau',
]

export function PlanDeTravail({ children }: { children: React.ReactNode }) {
  const chemin = usePathname()

  // L'Accueil (maquette D2 du 20/10), les Patients (P1), la liste d'attente (L3) et les Réglages (R2) posent leurs
  // cartes sur le fond crème du site, uni : sans ses hexagones dans l'espace du cabinet (Marving, 28/10).
  if (FOND_CREME.includes(chemin ?? '') || /^\/tableau-de-bord\/patients\/[0-9a-f-]{36}$/.test(chemin ?? '')) {
    return <main id="contenu" tabIndex={-1} className="outline-none bg-[#f7f6f2] flex-1 px-4 py-8 lg:px-12 lg:py-10">{children}</main>
  }

  // La fiche d'un patient (`/tableau-de-bord/patients/<id>`) suit la même mise en page.
  if (ECRANS_REFAITS.includes(chemin ?? '') || /^\/tableau-de-bord\/patients\/[0-9a-f-]{36}$/.test(chemin ?? '')) {
    return <main id="contenu" tabIndex={-1} className="outline-none flex-1 bg-background px-4 py-8 lg:px-12 lg:py-10">{children}</main>
  }
  // Le chat, comme le planning, va bord à bord : sa liste de collègues et sa conversation remplissent l'écran (D82).
  if (chemin === '/tableau-de-bord/chat' || chemin?.startsWith('/tableau-de-bord/chat/')) {
    return <main id="contenu" tabIndex={-1} className="outline-none flex min-h-0 flex-1 flex-col bg-[#f7f6f2]">{children}</main>
  }
  // Le planning a son propre panneau gauche, bord à bord (maquette « Planning »).
  if (chemin === '/tableau-de-bord/agenda') {
    return <main id="contenu" tabIndex={-1} className="outline-none flex-1 bg-background">{children}</main>
  }

  const pleineLargeur = chemin?.startsWith('/tableau-de-bord/agenda')

  return (
    <main id="contenu" tabIndex={-1} className="outline-none flex-1 bg-secondary px-6 py-8">
      <div className={cn(pleineLargeur ? 'max-w-none' : 'mx-auto w-full max-w-6xl')}>{children}</div>
    </main>
  )
}
