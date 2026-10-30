import type { Metadata } from 'next'

import { AgendaEnDirect } from '@/components/features/agenda/agenda-en-direct'
import { ChatEnDirect } from '@/components/features/chat/chat-en-direct'
import { MenuCompte, SelecteurCabinet } from '@/components/features/navigation/barre-compte'
import { BarreHaute, Rail } from '@/components/features/navigation/navigation-privee'
import { PlanDeTravail } from '@/components/features/navigation/plan-de-travail'
import { RechercheGlobale } from '@/components/features/navigation/recherche-globale'
import { Logo } from '@/components/features/vitrine/logo'
import { hasPermission } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { lireCabinetChoisi } from '@/server/cabinet-choisi'
import { compterNonLus } from '@/server/queries/chat'
import { lireIdentite } from '@/server/queries/identite'

// Usage interne (personnel) : jamais indexé (lot F, D36).
export const metadata: Metadata = { robots: { index: false } }

// Toute page sous ce layout est protégée : `exigerContexte` redirige si la
// session est absente, expirée, révoquée, inactive ou sans second facteur.
// C'est ici et non dans un middleware — celui-ci tournerait sur l'Edge Runtime,
// proscrit par D2, et n'aurait pas accès à PostgreSQL.
export default async function LayoutPrive({ children }: { children: React.ReactNode }) {
  const ctx = await exigerContexte()
  const [identite, { choisi, cabinets }, nonLus] = await Promise.all([
    lireIdentite(ctx),
    lireCabinetChoisi(ctx),
    compterNonLus(ctx),
  ])

  // « Réglages » n'est montré qu'à qui peut y faire quelque chose (maquettes du
  // 13/10 : pas d'onglet pour la secrétaire ni l'assistante).
  const statistiques = hasPermission(ctx, 'statistiques', 'read')
  const reglages =
    hasPermission(ctx, 'notifications', 'modeles') ||
    hasPermission(ctx, 'utilisateur', 'create') ||
    hasPermission(ctx, 'workstation', 'read')

  return (
    // D82 : le chat écoute sur tous les écrans — la pastille de « Chat » monte et le son joue, où qu'on soit.
    <ChatEnDirect nonLusInitial={nonLus} sonCoupeInitial={identite.chatSonCoupe}>
      <div className="espace-cabinet flex min-h-screen pb-16 lg:pb-0">
        {/* Le premier arrêt de la touche Tab : sauter le menu et la barre du haut (24/10). */}
        <a
          href="#contenu"
          className="sr-only z-[70] rounded-full bg-white px-4 py-2 text-sm font-semibold text-encre shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Aller au contenu
        </a>
        <Rail
          reglages={reglages}
          statistiques={statistiques}
          apps={ctx.roles.includes('PRATICIEN') || ctx.roles.includes('ADMIN')}
          haut={<Logo taille={40} />}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <BarreHaute
            cabinet={<SelecteurCabinet choisi={choisi} cabinets={cabinets} />}
            compte={<MenuCompte prenom={identite.prenom} nom={identite.nom} email={ctx.email} roles={ctx.roles} />}
            recherche={hasPermission(ctx, 'patient', 'read') ? <RechercheGlobale /> : null}
            reglages={reglages}
            statistiques={statistiques}
          />
          <PlanDeTravail>{children}</PlanDeTravail>
        </div>
        {/* D61 : chaque écran ouvert apprend aussitôt ce qui change dans l'agenda. */}
        {hasPermission(ctx, 'agenda', 'read') ? <AgendaEnDirect /> : null}
      </div>
    </ChatEnDirect>
  )
}
