import type { SiteCode } from '@prisma/client'
import Link from 'next/link'

import { CABINET } from '@/config/cabinet'
import { slugDuSite } from '@/lib/site-slug'
import { assistantAllume } from '@/server/assistant/modele'
import { codesCabinetsEnActivite, lieuxEnActivite } from '@/server/queries/public/catalogue'
import { AssistantUrgences } from './assistant-urgences'
import { Logo } from './logo'

// Un lien par cabinet en activité (D74), Marie-Galante d'abord.
const colonnes = (codes: SiteCode[]) => [
  {
    titre: 'Le cabinet',
    liens: [
      ...(['MARIE_GALANTE', 'GUADELOUPE'] as const)
        .filter((c) => codes.includes(c))
        .map((c) => ({ href: `/cabinets/${slugDuSite(c)}`, libelle: c === 'MARIE_GALANTE' ? 'Marie-Galante' : 'Guadeloupe' })),
      { href: '/#equipe', libelle: 'L’équipe' },
    ],
  },
  {
    titre: 'Patients',
    liens: [
      { href: '/rendez-vous', libelle: 'Prendre rendez-vous' },
      { href: '/mes-rendez-vous', libelle: 'Mes rendez-vous' },
      { href: '/mes-rendez-vous#liste-attente', libelle: 'Liste d’attente' },
    ],
  },
  {
    titre: 'Informations',
    liens: [
      { href: '/#conseils', libelle: 'Conseils' },
      { href: '/#acces', libelle: 'Accès et horaires' },
      { href: '/connexion', libelle: 'Espace professionnel' },
    ],
  },
]

/**
 * Pied complet de l’accueil : P3 de maquette-pied-de-page.pdf (19/10) — la bande bleue
 * continue, un dernier appel « Prendre rendez-vous » en verre, puis le logo, la phrase et les liens.
 * `simple` sur les pages du parcours patient, où la maquette ne garde que la mention du bas.
 */
export async function PiedDePage({ simple = false }: { simple?: boolean }) {
  const nomAffiche = CABINET.nomCommercial ?? CABINET.nom
  const [lieux, codes] = await Promise.all([lieuxEnActivite(), codesCabinetsEnActivite()])

  if (simple) {
    return (
      <footer className="fond-menthe border-t border-[#e0ebe8]">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-4 px-6 py-16 lg:px-20">
          <p className="text-xs text-muted-foreground">© 2026 {nomAffiche} · {lieux}</p>
          <Link href="/connexion" className="text-sm hover:underline">
            Espace professionnel
          </Link>
        </div>
        {/* La bulle de l'assistant des urgences (D77), sur chaque page du site : toutes finissent par ce pied. */}
        {assistantAllume() ? <AssistantUrgences /> : null}
      </footer>
    )
  }

  return (
    <footer className="fond-pied">
      <div className="mx-auto max-w-[90rem] px-6 lg:px-20">
        <div className="flex flex-col items-start justify-between gap-6 rounded-[1.875rem] border border-white/80 bg-white/60 px-6 py-8 backdrop-blur-md sm:px-12 sm:py-11 lg:flex-row lg:items-center">
          <div>
            <p className="font-heading text-[1.625rem] leading-tight font-extrabold sm:text-[2.125rem]">
              Un rendez-vous, en quelques minutes.
            </p>
            <p className="mt-2 text-encre/80">De jour comme de nuit : un code par SMS suffit, sans compte à créer.</p>
          </div>
          <Link
            href="/rendez-vous"
            className="lien-action inline-flex h-12 shrink-0 items-center rounded-full bg-white px-6 text-[0.9375rem] text-[#387a70] hover:bg-white/90"
          >
            Prendre rendez-vous
          </Link>
        </div>
      </div>

      <div className="mx-auto grid max-w-[90rem] gap-12 px-6 pt-16 pb-16 lg:grid-cols-[1fr_auto] lg:px-20">
        <div>
          <div className="flex items-center gap-3">
            <Logo taille={44} />
            <p className="font-heading text-lg font-semibold">{nomAffiche}</p>
          </div>
          <p className="mt-7 max-w-md font-heading text-[1.75rem] leading-tight font-bold">
            Prendre soin de votre sourire, à chaque rendez-vous.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 sm:gap-16">
          {colonnes(codes).map((colonne) => (
            <div key={colonne.titre}>
              <h2 className="text-sm font-semibold text-[#2c5f58]">{colonne.titre}</h2>
              <ul className="mt-5 space-y-3 text-[0.9375rem]">
                {colonne.liens.map((lien) => (
                  <li key={lien.libelle}>
                    <Link href={lien.href} className="hover:underline">
                      {lien.libelle}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[90rem] px-6 lg:px-20">
        <p className="border-t border-encre/15 py-6 text-xs text-encre/70">
          © 2026 {nomAffiche} · {lieux}
        </p>
      </div>
      {assistantAllume() ? <AssistantUrgences /> : null}
    </footer>
  )
}
