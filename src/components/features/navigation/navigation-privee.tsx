'use client'

import {
  CalendarDays,
  ChartColumnBig,
  ExternalLink,
  House,
  LayoutGrid,
  MessagesSquare,
  SlidersHorizontal,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

import { useChat } from '@/components/features/chat/chat-en-direct'
import { cn } from '@/lib/utils'

type Section = {
  libelle: string
  icone: LucideIcon
  href: string
  onglets: { href: string; libelle: string }[]
  reglages?: boolean
  statistiques?: boolean
  apps?: boolean
}

// Masquer n'est pas protéger : chaque page garde sa propre garde serveur. Le
// rail ne fait qu'épargner à la secrétaire un onglet où rien ne lui est permis.
const SECTIONS: Section[] = [
  { libelle: 'Accueil', icone: House, href: '/tableau-de-bord', onglets: [] },
  {
    libelle: 'Agenda',
    icone: CalendarDays,
    href: '/tableau-de-bord/agenda',
    onglets: [
      { href: '/tableau-de-bord/agenda', libelle: 'Planning' },
      { href: '/tableau-de-bord/presences', libelle: 'Présences' },
      { href: '/tableau-de-bord/indisponibilites', libelle: 'Congés et fermetures' },
      { href: '/tableau-de-bord/liste-attente', libelle: 'Liste d’attente' },
    ],
  },
  // Le parcours des patients du jour, en colonnes (27/10).
  { libelle: 'Workflow', icone: Workflow, href: '/tableau-de-bord/workflow', onglets: [] },
  {
    libelle: 'Patients',
    icone: Users,
    href: '/tableau-de-bord/patients',
    onglets: [
      { href: '/tableau-de-bord/patients', libelle: 'Patients' },
      { href: '/tableau-de-bord/motifs', libelle: 'Menu des patients' },
      { href: '/tableau-de-bord/patients/bloques', libelle: 'Réservation bloquée' },
    ],
  },
  // L'équipe s'écrit de personne à personne (D82, 28/10).
  { libelle: 'Chat', icone: MessagesSquare, href: '/tableau-de-bord/chat', onglets: [] },
  {
    libelle: 'Statistiques',
    icone: ChartColumnBig,
    href: '/tableau-de-bord/statistiques',
    statistiques: true,
    onglets: [
      { href: '/tableau-de-bord/statistiques', libelle: 'Activité' },
      { href: '/tableau-de-bord/statistiques/motifs', libelle: 'Motifs' },
      { href: '/tableau-de-bord/statistiques/absences', libelle: 'Absences' },
      { href: '/tableau-de-bord/statistiques/prise-de-rendez-vous', libelle: 'Prise de rendez-vous' },
      { href: '/tableau-de-bord/statistiques/remplissage', libelle: 'Remplissage' },
      { href: '/tableau-de-bord/statistiques/patients', libelle: 'Patients' },
      { href: '/tableau-de-bord/statistiques/retrocession', libelle: 'Rétrocession' },
    ],
  },
  // Ce que remontent les applications connectées au cabinet, pour le praticien (27/10).
  { libelle: 'Apps', icone: LayoutGrid, href: '/tableau-de-bord/apps', apps: true, onglets: [] },
  {
    libelle: 'Réglages',
    icone: SlidersHorizontal,
    href: '/tableau-de-bord/messages',
    reglages: true,
    onglets: [
      { href: '/tableau-de-bord/messages', libelle: 'Modèles de messages' },
      { href: '/tableau-de-bord/comptes', libelle: 'Comptes' },
      { href: '/tableau-de-bord/postes', libelle: 'Postes' },
      { href: '/tableau-de-bord/cabinets', libelle: 'Cabinets' },
      { href: '/tableau-de-bord/reglages-retrocession', libelle: 'Rétrocession' },
      { href: '/tableau-de-bord/journal', libelle: 'Journal' },
    ],
  },
]

function ongletCourant(chemin: string, href: string) {
  return chemin === href || chemin.startsWith(`${href}/`)
}

function sectionCourante(chemin: string) {
  return (
    SECTIONS.find(
      (s) =>
        s.onglets.some((o) => ongletCourant(chemin, o.href)) ||
        // Une section sans onglets (Workflow, Apps) se reconnaît à son adresse ; l'Accueil reste le repli.
        (s.onglets.length === 0 && s !== SECTIONS[0] && ongletCourant(chemin, s.href)),
    ) ?? SECTIONS[0]!
  )
}

function LienRail({
  href,
  libelle,
  Icone,
  actif,
  pastille = 0,
}: {
  href: string
  libelle: string
  Icone: LucideIcon
  actif?: boolean
  /** Les messages non lus, sur « Chat ». */
  pastille?: number
}) {
  return (
    <Link
      href={href}
      aria-current={actif ? 'page' : undefined}
      aria-label={pastille > 0 ? `${libelle}, ${pastille} non lus` : undefined}
      className={cn(
        // Huit icônes pour l'administrateur au téléphone (28/10) : chacune tient dans sa part de la barre.
        // À l'ordinateur, la pastille contient le plus long libellé, « Statistiques », même en gras (29/10).
        'flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 py-2.5 text-[0.625rem] text-encre/75 lg:text-[0.6875rem] transition-colors hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-encre lg:mx-1 lg:flex-none lg:rounded-2xl lg:px-1 lg:py-3',
        actif && 'bg-white/60 font-semibold text-encre',
      )}
    >
      <span className="relative">
        <Icone aria-hidden className="size-[1.375rem]" strokeWidth={1.6} />
        {pastille > 0 ? (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-2.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-[#c2410c] px-1 text-[0.625rem] leading-none font-bold text-white"
          >
            {pastille > 99 ? '99+' : pastille}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate lg:max-w-none lg:overflow-visible">{libelle}</span>
    </Link>
  )
}

/** Rail de gauche à partir de lg ; barre du bas en dessous. */
export function Rail({
  reglages,
  statistiques,
  apps,
  haut,
}: {
  reglages: boolean
  statistiques: boolean
  apps: boolean
  haut: React.ReactNode
}) {
  const chemin = usePathname() ?? ''
  const courante = sectionCourante(chemin)
  const { nonLus } = useChat()

  return (
    <nav
      aria-label="Navigation principale"
      className="rail-degrade fixed inset-x-0 bottom-0 z-30 flex lg:sticky lg:top-0 lg:h-screen lg:w-[5.5rem] lg:shrink-0 lg:flex-col"
    >
      <div className="hidden justify-center py-5 lg:flex">{haut}</div>
      <div className="contents lg:flex lg:flex-1 lg:flex-col lg:gap-1">
        {SECTIONS.filter(
          (s) => (!s.reglages || reglages) && (!s.statistiques || statistiques) && (!s.apps || apps),
        ).map((s) => (
          <LienRail
            key={s.libelle}
            href={s.href}
            libelle={s.libelle}
            Icone={s.icone}
            actif={s === courante}
            pastille={s.href === '/tableau-de-bord/chat' ? nonLus : 0}
          />
        ))}
      </div>
      {/* Au téléphone, « Chat » a pris la place de « Site » dans la barre du bas (maquette du 28/10). */}
      <div className="hidden lg:mx-3 lg:mb-3 lg:flex lg:flex-col lg:border-t lg:border-encre/15 lg:pt-3">
        <LienRail href="/" libelle="Site" Icone={ExternalLink} />
      </div>
    </nav>
  )
}

// Écrans qui lisent le cabinet choisi. Les autres l'ignorent encore : y montrer
// le menu affirmerait un choix que la page ne suit pas. Chaque écran s'ajoute
// ici quand sa maquette est codée (le Planning garde son propre choix).
const ECRANS_PAR_CABINET = [
  '/tableau-de-bord',
  '/tableau-de-bord/agenda/nouveau',
  '/tableau-de-bord/comptes',
  '/tableau-de-bord/workflow',
]

/** Barre du haut : les onglets de la section courante, puis à droite le cabinet et le compte. */
export function BarreHaute({
  cabinet,
  compte,
  recherche,
  reglages,
  statistiques,
}: {
  cabinet: React.ReactNode
  compte: React.ReactNode
  recherche?: React.ReactNode
  reglages: boolean
  statistiques: boolean
}) {
  const chemin = usePathname() ?? ''
  const requete = useSearchParams().toString()
  const section = sectionCourante(chemin)
  // Secrétaire qui tape l'adresse d'un réglage : la page lui dit « réservé », sans onglets vers d'autres refus.
  const onglets = (section.reglages && !reglages) || (section.statistiques && !statistiques) ? [] : section.onglets
  // L'onglet le plus précis l'emporte : « Patients » (/patients) ne s'allume pas
  // sur « Réservation bloquée » (/patients/bloques).
  const ongletActif = onglets
    .filter((o) => ongletCourant(chemin, o.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href
  const parCabinet = ECRANS_PAR_CABINET.includes(chemin)

  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-border bg-background px-4 lg:px-12">
      <nav aria-label="Onglets" className="flex h-full min-w-0 flex-[0_1_auto] items-center gap-1.5 overflow-x-auto">
        {onglets.map((o) => {
          const actif = o.href === ongletActif
          return (
            <Link
              key={o.href}
              // Les onglets des statistiques gardent la période et le praticien choisis.
              href={section.statistiques && requete ? `${o.href}?${requete}` : o.href}
              aria-current={actif ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center rounded-full px-4 text-[0.9375rem] whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                actif && 'bg-[#e4f1ee] font-semibold text-[#387a70] hover:bg-[#e4f1ee] hover:text-[#387a70]',
              )}
            >
              {o.libelle}
            </Link>
          )
        })}
      </nav>
      {recherche ? <div className="hidden min-w-[14rem] flex-1 justify-end md:flex">{recherche}</div> : null}
      <div className="flex shrink-0 items-center gap-4">
        {parCabinet ? cabinet : null}
        {compte}
      </div>
    </header>
  )
}
