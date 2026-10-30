import type { Metadata } from 'next'
import {
  Armchair,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileText,
  MapPin,
  Phone,
  ShieldPlus,
  Ship,
  Smartphone,
  Users,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { Fragment } from 'react'

import { CartesSoins } from '@/components/features/vitrine/cartes-soins'
import { CerclePointille } from '@/components/features/vitrine/cercle-pointille'
import { EnTetePublic } from '@/components/features/vitrine/en-tete-public'
import { FondHero } from '@/components/features/vitrine/fond-hero'
import { PiedDePage } from '@/components/features/vitrine/pied-de-page'
import { CABINET, CONSEILS, EQUIPE, GALERIE, PHOTOS_PRATICIENS, SITES, SOINS, URGENCES } from '@/config/cabinet'
import { joursLongs, nomCourtCabinet, ouIlRecoit } from '@/lib/jours-publics'
import { cn } from '@/lib/utils'
import { slugDuSite } from '@/lib/site-slug'
import { codesCabinetsEnActivite } from '@/server/queries/public/catalogue'
import { presencesPubliques } from '@/server/queries/public/presences'

// Les lieux cités suivent les cabinets en activité (D74) : « Marie-Galante » seul tant que la Guadeloupe est décochée.
export async function generateMetadata(): Promise<Metadata> {
  const codes = await codesCabinetsEnActivite()
  const lieux = codes.includes('GUADELOUPE') ? 'Marie-Galante et Guadeloupe' : 'Marie-Galante'
  return { title: `${CABINET.nomCommercial ?? CABINET.nom} — ${lieux}`, description: CABINET.presentation }
}

// Lit la base à chaque visite, jamais à la fabrication de l'image : au build, seule une adresse
// de secours sans vraie base existe (Dockerfile), pour permettre `prisma generate` sans base réelle.
export const dynamic = 'force-dynamic'

const etapesReservation = (lieux: string) => [
  { titre: 'Le cabinet', texte: `${lieux}.` },
  { titre: 'Le motif', texte: 'Ce qui vous amène.' },
  { titre: 'Le créneau', texte: 'Avec un praticien, ou peu importe.' },
  { titre: 'Vos coordonnées', texte: 'Un code arrive par SMS : c’est réservé.' },
] as const

const ICONES_ETAPES = [
  <MapPin key="cabinet" aria-hidden className="size-6" strokeWidth={1.6} />,
  <ClipboardList key="motif" aria-hidden className="size-6" strokeWidth={1.6} />,
  <CalendarClock key="creneau" aria-hidden className="size-6" strokeWidth={1.6} />,
  <svg
    key="coordonnees"
    aria-hidden
    viewBox="0 0 24 24"
    className="size-6 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]"
  >
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="m9 12 2 2 4-4" />
  </svg>,
]

const ICONE_DENT = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    className="size-5 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]"
  >
    <path d="M7 3c-2.2 0-4 1.8-4 4.2 0 2 .7 3.3 1.3 5 .6 1.9.7 4.5 1.3 6.6.3 1.1.8 2.2 1.8 2.2 1.3 0 1.4-2.2 1.7-3.6.3-1.4.6-2.6 1.9-2.6s1.6 1.2 1.9 2.6c.3 1.4.4 3.6 1.7 3.6 1 0 1.5-1.1 1.8-2.2.6-2.1.7-4.7 1.3-6.6.6-1.7 1.3-3 1.3-5C21 4.8 19.2 3 17 3c-1.9 0-2.9 1-5 1S8.9 3 7 3z" />
  </svg>
)

const ICONES_CONSEILS = [
  <svg
    key="extraction"
    aria-hidden
    viewBox="0 0 24 24"
    className="size-6 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]"
  >
    <path d="M7 3c-2.2 0-4 1.8-4 4.2 0 2 .7 3.3 1.3 5 .6 1.9.7 4.5 1.3 6.6.3 1.1.8 2.2 1.8 2.2 1.3 0 1.4-2.2 1.7-3.6.3-1.4.6-2.6 1.9-2.6s1.6 1.2 1.9 2.6c.3 1.4.4 3.6 1.7 3.6 1 0 1.5-1.1 1.8-2.2.6-2.1.7-4.7 1.3-6.6.6-1.7 1.3-3 1.3-5C21 4.8 19.2 3 17 3c-1.9 0-2.9 1-5 1S8.9 3 7 3z" />
  </svg>,
  <ClipboardCheck key="intervention" aria-hidden className="size-6" strokeWidth={1.6} />,
  <svg
    key="quotidien"
    aria-hidden
    viewBox="0 0 24 24"
    className="size-6 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]"
  >
    <path d="M4 20 15 9" />
    <path d="M15 9l3-3a2.1 2.1 0 0 1 3 3l-3 3z" />
    <path d="M14 5v2M17 3v2M12 7v2" />
  </svg>,
]

/** Ruche de la galerie : trois alvéoles puis deux sur ordinateur (x, y), deux, une, deux sur téléphone (xm, ym). */
const PLACES_RUCHE = [
  { x: '0%', y: '0%', xm: '0%', ym: '0%' },
  { x: '33.77%', y: '0%', xm: '50.87%', ym: '0%' },
  { x: '67.53%', y: '0%', xm: '25.43%', ym: '30.4%' },
  { x: '16.88%', y: '43.83%', xm: '0%', ym: '60.8%' },
  { x: '50.65%', y: '43.83%', xm: '50.87%', ym: '60.8%' },
]

function Surtitre({ children }: { children: React.ReactNode }) {
  return <p className="accent-vert text-sm font-semibold">{children}</p>
}

const titre2 = 'mt-3 font-heading text-[length:var(--texte-titre-2)] leading-[1.05] font-bold tracking-tight'
const conteneur = 'mx-auto max-w-[90rem] px-6 lg:px-20'

export default async function PageAccueil() {
  const { cabinets, praticiens } = await presencesPubliques()
  const principal = cabinets[0]
  const joursOuverts = [...new Set(cabinets.flatMap((c) => c.jours))].sort((a, b) => a - b)
  const fauteuils = cabinets.reduce((n, c) => n + c.fauteuils, 0)
  const vitrine = (nom: string) => SITES.find((s) => s.nom === nomCourtCabinet(nom))
  // Un seul cabinet en activité (D74) : le site parle de lui seul, sans « deux cabinets » ni traversée.
  const plusieurs = cabinets.length > 1
  const noms = cabinets.map((c) => nomCourtCabinet(c.nom))

  return (
    <>
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Aller au contenu
      </a>

      <main id="contenu" className="flex-1">
        {/* ── Haut de page : V2 de maquette-haut-de-page.pdf (19/10) — vert d'eau vers bleu,
             hexagones (trois alvéoles éclairées à icône), vague de lumière, vagues et pouls. Ni recherche ni boutons :
             ceux de l'en-tête suffisent. ── */}
        <section className="fond-v2 relative isolate overflow-hidden">
          <svg
            aria-hidden
            viewBox="0 0 1440 800"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 -z-10 size-full"
          >
            {Array.from({ length: 9 }, (_, i) => (
              <path
                key={i}
                d={`M0 ${700 + i * 7} C 430 ${620 + i * 9}, 860 ${800 - i * 6}, 1440 ${690 + i * 8}`}
                fill="none"
                stroke="rgb(255 255 255 / 0.22)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path
              d="M760 120 h70 l14 -30 l18 60 l16 -46 l12 16 h560"
              className="max-md:hidden"
              fill="none"
              stroke="rgb(255 255 255 / 0.45)"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <FondHero />
          <EnTetePublic surCouleur />
          <div className={`${conteneur} relative pt-40 pb-24 md:pt-48 xl:pb-40`}>
            <p className="revele-1 inline-flex items-center gap-2 rounded-full bg-white/60 px-3.5 py-1.5 text-[0.8125rem] font-semibold">
              <span aria-hidden>＋</span>
              {noms.join(' et ')}
            </p>
            <h1 className="revele-2 mt-6 max-w-[48rem] font-heading text-[length:clamp(2.75rem,5.2vw,4.75rem)] leading-[0.98] font-extrabold tracking-tight text-balance">
              {CABINET.accroche}
            </h1>
            <p className="revele-3 mt-6 max-w-[33rem] text-lg text-encre/85">{CABINET.baseline}</p>
          </div>
        </section>

        {/* ── Chiffres : C1 de maquette-chiffres.pdf (19/10) — hexagones blancs à cheval
             sur le bas du haut de page, chiffre en dégradé, précision dessous. ── */}
        {/* Chiffres et « Le cabinet » partagent un même fond : les hexagones flottent entre le haut de page et la suite. */}
        <div className="fond-hexagones">
          <section className="relative z-10 -mt-24 xl:-mt-32">
            <dl
              className={`${conteneur} grid grid-cols-2 justify-items-center gap-x-3 gap-y-2 lg:grid-cols-4 lg:gap-6`}
            >
              {[
                {
                  valeur: String(cabinets.length),
                  legende: plusieurs ? 'cabinets' : 'cabinet',
                  detail: cabinets.map((c) => nomCourtCabinet(c.nom)).join(' et '),
                  Icone: MapPin,
                },
                {
                  valeur: String(fauteuils),
                  legende: 'fauteuils',
                  detail: !principal
                    ? ''
                    : plusieurs
                      ? `dont ${principal.fauteuils} à ${nomCourtCabinet(principal.nom)}`
                      : `à ${nomCourtCabinet(principal.nom)}`,
                  Icone: Armchair,
                },
                {
                  valeur: `${joursOuverts.length} j/7`,
                  legende: joursLongs(joursOuverts),
                  detail: cabinets
                    .slice(1)
                    .map((c) => `${nomCourtCabinet(c.nom)} ${joursLongs(c.jours)}`)
                    .join(' · '),
                  Icone: CalendarCheck,
                },
                {
                  valeur: '24 h/24',
                  legende: 'réservation en ligne',
                  detail: 'confirmée par SMS',
                  Icone: Smartphone,
                },
              ].map(({ valeur, legende, detail, Icone }) => (
                <div key={valeur + legende} className="flex flex-col items-center text-center">
                  <div className="relative grid h-[11.5rem] w-[10rem] place-items-center sm:h-[16.25rem] sm:w-[14.375rem]">
                    <svg
                      aria-hidden
                      viewBox="0 0 230 260"
                      className="absolute inset-0 size-full drop-shadow-[0_22px_30px_rgb(20_80_90/0.22)]"
                    >
                      <polygon
                        points="115,3 225.9,67 225.9,193 115,257 4.1,193 4.1,67"
                        fill="#fff"
                        stroke="#e3f1ee"
                        strokeWidth={2.5}
                        strokeLinejoin="round"
                      />
                    </svg>
                    <div className="relative flex flex-col-reverse items-center px-4">
                      <dt className="mt-1 text-[0.8125rem] font-semibold sm:text-[0.9375rem]">{legende}</dt>
                      <dd className="chiffres texte-degrade font-heading text-[2.125rem] leading-tight font-extrabold sm:text-[3.125rem]">
                        {valeur}
                      </dd>
                      <Icone aria-hidden className="mb-1 size-5 text-[#387a70] sm:size-6" strokeWidth={1.6} />
                    </div>
                  </div>
                  <p className="mt-2 mb-3 max-w-[13rem] text-[0.8125rem] text-muted-foreground sm:mt-4 sm:text-sm">
                    {detail}
                  </p>
                </div>
              ))}
            </dl>
          </section>

          {/* ── Le cabinet : L1 + fond à hexagones + cercle à pointillés (maquette-le-cabinet-l1-cercle.pdf, 19/10) ── */}
          <section id="le-cabinet" className="scroll-mt-20 pt-8 pb-20 lg:pt-12 lg:pb-28">
            <div className="mx-auto grid max-w-[90rem] items-center gap-12 px-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10 lg:px-20">
              <div>
                <Surtitre>Le cabinet</Surtitre>
                <h2 className={titre2}>{plusieurs ? 'Deux cabinets, une même équipe.' : 'Un cabinet, une équipe.'}</h2>
                <p className="mt-6 max-w-[28rem] leading-relaxed text-muted-foreground">
                  {plusieurs
                    ? 'Le cabinet de Marie-Galante reçoit du lundi au samedi, sur trois fauteuils. Le vendredi, un praticien traverse pour recevoir au cabinet de Guadeloupe. Même dossier, mêmes habitudes, où que vous soyez soigné.'
                    : 'Le cabinet de Marie-Galante reçoit du lundi au samedi, sur trois fauteuils. Une équipe qui vous connaît, et votre dossier suivi d’un rendez-vous à l’autre.'}
                </p>
                <ul className="mt-7 space-y-3.5 font-medium">
                  {(plusieurs
                    ? [
                        { texte: 'Un seul dossier pour les deux cabinets', Icone: FileText },
                        { texte: 'Un praticien traverse chaque vendredi', Icone: Ship },
                        { texte: 'La même équipe, les mêmes habitudes', Icone: Users },
                      ]
                    : [
                        { texte: 'Votre dossier suivi d’un soin à l’autre', Icone: FileText },
                        { texte: 'Trois fauteuils, du lundi au samedi', Icone: Armchair },
                        { texte: 'La même équipe, les mêmes habitudes', Icone: Users },
                      ]
                  ).map(({ texte, Icone }) => (
                    <li key={texte} className="flex items-center gap-3.5">
                      <span className="hexagone grid h-[2.375rem] w-[2.125rem] shrink-0 place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white">
                        <Icone aria-hidden className="size-4" strokeWidth={1.8} />
                      </span>
                      {texte}
                    </li>
                  ))}
                </ul>
                {principal ? (
                  <Link
                    href={`/cabinets/${slugDuSite(principal.code)}`}
                    className="lien-action mt-7 inline-flex text-[0.9375rem] text-primary"
                  >
                    En savoir plus
                  </Link>
                ) : null}
              </div>

              <div className="relative mx-auto h-[26rem] w-full max-w-[22rem] sm:h-[35rem] sm:max-w-[43rem]">
                <CerclePointille className="absolute -top-10 -left-5 w-60 sm:-top-16 sm:left-2 sm:w-[21rem]" />
                <div className="hexagone absolute top-0 right-0 h-[24rem] w-[20.75rem] sm:right-10 sm:h-[34.625rem] sm:w-[30rem]">
                  <Image
                    src="/images/cabinet/salle-beige.jpg"
                    alt="La salle de soins de Marie-Galante"
                    fill
                    sizes="(min-width: 640px) 480px, 330px"
                    className="object-cover"
                  />
                </div>
                {principal ? (
                  <div className="hexagone absolute bottom-0 left-0 grid h-[10.8rem] w-[9.375rem] place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] px-5 text-center text-white sm:bottom-8 sm:h-[14.45rem] sm:w-[12.5rem] sm:px-8">
                    <div>
                      <p className="font-heading text-[2.125rem] leading-none font-extrabold sm:text-[2.875rem]">
                        {principal.fauteuils}
                      </p>
                      <p className="mt-1.5 text-[0.75rem] leading-snug text-white/90 sm:text-[0.8125rem]">
                        {principal.fauteuils > 1 ? 'fauteuils' : 'fauteuil'} à {nomCourtCabinet(principal.nom)}
                        {cabinets.slice(1).map((c) => `, ${c.fauteuils} en ${nomCourtCabinet(c.nom)}`)}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          {/* ── Nos soins : S1 de maquette-nos-soins.pdf (19/10), sur le même fond à hexagones ── */}
          <section id="nos-soins" className="relative scroll-mt-20 pb-24">
            <div className={`relative ${conteneur}`}>
              <CartesSoins
                soins={SOINS}
                entete={
                  <div>
                    <Surtitre>Nos soins</Surtitre>
                    <h2 className={titre2}>Ce que nous traitons au cabinet</h2>
                  </div>
                }
              />
            </div>
          </section>
        </div>

        {/* ── Réserver en ligne : E3 sur la bande vert d'eau à hexagones (maquette-reserver-en-ligne-e3-bleu.pdf,
             19/10) — les étapes à gauche, le premier écran de la réservation dans un téléphone à droite. ── */}
        <section className="fond-v2-hexagones overflow-hidden">
          <div className={`${conteneur} py-24`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="text-sm font-semibold">Réserver en ligne</p>
                <h2 className={titre2}>Quatre étapes, sans appeler.</h2>
              </div>
              <Link
                href="/rendez-vous"
                className="lien-action inline-flex h-12 items-center rounded-full bg-white px-7 text-[0.9375rem] text-[#387a70] shadow-[0_12px_28px_-12px_rgb(0_40_50/0.5)] hover:bg-white/90"
              >
                Commencer
              </Link>
            </div>

            <div className="mt-14 grid items-center gap-14 lg:grid-cols-[28.75rem_20rem] lg:justify-center lg:gap-32">
              <div className="relative">
                <CerclePointille
                  couleur="#fff"
                  className="absolute -bottom-24 -left-60 w-52 opacity-70 max-lg:hidden"
                />
                <ol className="relative space-y-8 before:absolute before:top-8 before:bottom-8 before:left-7 before:border-l-2 before:border-dashed before:border-encre/30">
                  {etapesReservation(noms.join(' ou ')).map((etape, i) => (
                    <li key={etape.titre} className="relative flex items-center gap-5">
                      <span
                        className={cn(
                          'hexagone grid h-16 w-14 shrink-0 place-items-center',
                          i === 0 ? 'bg-white text-[#387a70]' : 'bg-white/55',
                        )}
                      >
                        {ICONES_ETAPES[i]}
                      </span>
                      <div>
                        <p className="font-heading text-xl font-bold">
                          {i + 1}. {etape.titre}
                        </p>
                        <p className="mt-1 text-sm text-encre/80">{etape.texte}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Le vrai premier écran de la réservation, en miniature : décoratif, le lien est « Commencer ». */}
              <div className="relative isolate">
                <CerclePointille
                  couleur="#fff"
                  className="absolute -top-16 -right-52 -z-10 w-80 opacity-70 max-lg:hidden"
                />
                <div
                  aria-hidden
                  className="mx-auto h-[37.5rem] w-80 rounded-[2.875rem] bg-[#24332f] p-3 shadow-[0_40px_80px_-30px_rgb(0_20_30/0.7)] max-sm:h-[32rem] max-sm:w-72"
                >
                  <div className="h-full overflow-hidden rounded-[2.25rem] bg-white text-foreground">
                    <p className="fond-v2 h-[7.5rem] px-5 pt-10 font-heading text-xl font-extrabold">
                      Prendre rendez-vous
                    </p>
                    <div className="px-4 py-6">
                      <p className="flex items-center gap-2.5 font-heading text-[1.0625rem] font-bold">
                        <span className="hexagone grid h-[1.875rem] w-[1.625rem] place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-xs text-white">
                          1
                        </span>
                        Dans quel cabinet ?
                      </p>
                      {cabinets.map((c, i) => (
                        <p
                          key={c.id}
                          className={cn(
                            'mt-3.5 rounded-[1.125rem] border px-4 py-3.5 text-sm font-semibold',
                            i === 0 ? 'border-[#387a70] bg-[#edf6f3]' : 'border-[#dde9e6]',
                          )}
                        >
                          {nomCourtCabinet(c.nom)}
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground first-letter:uppercase">
                            {joursLongs(c.jours)}
                          </span>
                        </p>
                      ))}
                      {['Ce qui vous amène', 'Le créneau'].map((q, i) => (
                        <p
                          key={q}
                          className="mt-5 flex items-center gap-2.5 font-heading text-[1.0625rem] font-bold opacity-40"
                        >
                          <span className="hexagone grid h-[1.875rem] w-[1.625rem] place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-xs text-white">
                            {i + 2}
                          </span>
                          {q}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── L'équipe : T2 de maquette-equipe.pdf (19/10) — grandes photos arrondies, nom et rôle sur un
             voile bleu-vert, pastille hexagonale à icône. ── */}
        <section id="equipe" className="fond-hexagones scroll-mt-20">
          <div className={`${conteneur} py-24`}>
            <Surtitre>L’équipe</Surtitre>
            <h2 className={titre2}>Qui vous accueille</h2>

            <ul className="mt-14 grid grid-cols-2 gap-3.5 sm:gap-6 lg:grid-cols-4">
              {[
                ...praticiens.map((p, i) => ({
                  cle: p.id,
                  nom: `Dr ${p.prenom} ${p.nom}`,
                  role: p.titre,
                  lieu: ouIlRecoit(p.sites),
                  image: PHOTOS_PRATICIENS[i % PHOTOS_PRATICIENS.length]!,
                  icone: ICONE_DENT,
                })),
                ...EQUIPE.map((m, i) => ({
                  cle: m.role,
                  nom: m.role,
                  role: i === 0 ? 'Au fauteuil, à chaque soin' : 'Vos rendez-vous et votre dossier',
                  lieu: plusieurs ? 'Sur les deux cabinets' : `Au cabinet de ${noms[0] ?? ''}`,
                  image: m.image,
                  icone:
                    i === 0 ? (
                      <ShieldPlus aria-hidden className="size-5" strokeWidth={1.6} />
                    ) : (
                      <CalendarDays aria-hidden className="size-5" strokeWidth={1.6} />
                    ),
                })),
              ].map((m) => (
                <li
                  key={m.cle}
                  className="relative h-64 overflow-hidden rounded-[1.375rem] shadow-[0_30px_50px_-30px_rgb(10_50_60/0.55)] sm:h-[26.25rem] sm:rounded-[1.875rem]"
                >
                  <Image src={m.image} alt="" fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
                  <div
                    aria-hidden
                    className="absolute inset-x-0 top-2/5 bottom-0 bg-linear-to-b from-transparent to-[rgb(44_95_88/0.92)]"
                  />
                  <span className="hexagone absolute top-4 right-4 grid h-[3.25rem] w-[2.875rem] place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white max-sm:hidden">
                    {m.icone}
                  </span>
                  <div className="absolute inset-x-3.5 bottom-3.5 text-white sm:inset-x-5.5 sm:bottom-5.5">
                    <p className="font-heading text-base leading-tight font-bold sm:text-[1.3125rem]">{m.nom}</p>
                    <p className="mt-1 text-xs text-white/85 sm:text-sm">{m.role}</p>
                    <p className="mt-1.5 text-[0.6875rem] font-semibold text-[#cfe8e2] sm:mt-2 sm:text-[0.8125rem]">
                      {m.lieu}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Conseils : K3 de maquette-conseils.pdf (19/10) — les conseils en liste, et à côté la carte des
             urgences. ── */}
        <section id="conseils" className="fond-hexagones scroll-mt-20">
          <div className={`${conteneur} pb-24`}>
            <Surtitre>Conseils</Surtitre>
            <h2 className={titre2}>Avant et après vos soins</h2>

            <div className="mt-12 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
              <ul className="carte-douce divide-y divide-[#e6eeee] px-6 py-2 sm:px-8">
                {CONSEILS.map((conseil, i) => (
                  <li key={conseil.titre} className="flex gap-5 py-6">
                    <span className="hexagone grid h-[3.75rem] w-[3.25rem] shrink-0 place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white">
                      {ICONES_CONSEILS[i]}
                    </span>
                    <div>
                      <h3 className="font-heading text-[1.3125rem] font-bold">{conseil.titre}</h3>
                      <p className="mt-1.5 leading-relaxed text-muted-foreground">{conseil.texte}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="fond-v2-hexagones relative overflow-hidden rounded-[1.875rem] p-8 max-sm:pb-24">
                <CerclePointille couleur="#fff" className="absolute -right-32 -bottom-36 w-64 opacity-50" />
                <span className="hexagone grid h-[3.75rem] w-[3.25rem] place-items-center bg-white text-[#387a70]">
                  <Phone aria-hidden className="size-6" strokeWidth={1.6} />
                </span>
                <h3 className="mt-5 font-heading text-[1.625rem] font-bold">{URGENCES.intitule}</h3>
                <p className="relative mt-2.5 leading-relaxed text-encre/85">{URGENCES.texte}</p>
                {CABINET.telephone ? (
                  <a
                    href={`tel:${CABINET.telephone.replace(/\s/g, '')}`}
                    className="relative mt-6 inline-flex h-12 items-center rounded-full bg-white px-6 font-bold text-[#387a70] hover:bg-white/90"
                  >
                    Appeler le {CABINET.telephone}
                  </a>
                ) : (
                  <p className="relative mt-6 inline-flex h-12 items-center rounded-full bg-white/60 px-6 font-semibold">
                    Numéro à renseigner
                  </p>
                )}
                <p className="relative mt-5 text-[0.8125rem] text-encre/80">{URGENCES.horsHoraires}</p>
              </div>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Ces conseils sont d’ordre général et ne remplacent pas l’avis du praticien.
            </p>
          </div>
        </section>

        {/* ── Le cabinet en images : G1 de maquette-en-images.pdf (19/10) — les photos en ruche d'hexagones,
             légende en pilule. Placement en pourcentages : la ruche garde ses proportions à toute largeur. ── */}
        <section id="en-images" className="fond-hexagones relative scroll-mt-20 overflow-hidden">
          <CerclePointille className="absolute top-60 -right-32 w-52 lg:top-auto lg:-right-16 lg:-bottom-10 lg:w-80" />
          <div className={`${conteneur} relative pb-24`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <Surtitre>Le cabinet en images</Surtitre>
                <h2 className={titre2}>Le cabinet au quotidien</h2>
              </div>
              <Link href="/rendez-vous" className="lien-action text-[0.9375rem] text-primary">
                Envie de voir par vous-même ?
              </Link>
            </div>

            <ul className="relative mx-auto mt-12 aspect-[346/500] w-full max-w-[26rem] lg:aspect-[924/616] lg:max-w-[57.75rem]">
              {GALERIE.map((photo, i) => {
                const place = PLACES_RUCHE[i]
                return place ? (
                  <li
                    key={photo.src}
                    className="hexagone absolute h-[39.2%] w-[49.13%] top-(--ym) left-(--xm) lg:h-[56.17%] lg:w-[32.47%] lg:top-(--y) lg:left-(--x)"
                    style={
                      { '--x': place.x, '--y': place.y, '--xm': place.xm, '--ym': place.ym } as React.CSSProperties
                    }
                  >
                    <Image
                      src={photo.src}
                      alt={photo.alt}
                      fill
                      sizes="(min-width: 1024px) 300px, 50vw"
                      className="object-cover"
                    />
                    <span className="absolute bottom-[18%] left-1/2 -translate-x-1/2 rounded-full bg-white/92 px-3 py-1 text-center whitespace-nowrap text-[0.6875rem] font-semibold sm:text-xs">
                      {photo.legende}
                    </span>
                  </li>
                ) : null
              })}
            </ul>
          </div>
        </section>

        {/* ── Accès et horaires : A2 de maquette-acces.pdf (19/10) — une carte en verre par cabinet sur la bande
             bleu-vert, reliées par la traversée du canal. ── */}
        <section id="acces" className="fond-acces scroll-mt-20">
          <div className={`${conteneur} py-24`}>
            <p className="text-sm font-semibold">Accès et horaires</p>
            <h2 className={titre2}>{plusieurs ? 'Nos deux cabinets' : 'Notre cabinet'}</h2>

            <div
              className={cn(
                'mt-12 grid items-center gap-2',
                plusieurs ? 'lg:grid-cols-[1fr_8rem_1fr] lg:gap-0' : 'max-w-[36rem]',
              )}
            >
              {cabinets.map((c, i) => {
                const v = vitrine(c.nom)
                return (
                  <Fragment key={c.id}>
                    {i > 0 ? (
                      <p aria-hidden className="my-3 text-center text-[0.8125rem] font-semibold lg:my-0">
                        <svg viewBox="0 0 130 46" className="mx-auto mb-1.5 w-32 overflow-visible">
                          <path
                            d="M4 32 C 34 6, 96 6, 126 32"
                            fill="none"
                            stroke="#fff"
                            strokeWidth={2}
                            strokeDasharray="5 6"
                          />
                          <Ship x={53} y={0} width={24} height={24} stroke="#fff" strokeWidth={1.6} />
                        </svg>
                        {joursLongs(c.jours)}
                      </p>
                    ) : null}
                    <article className="overflow-hidden rounded-[1.875rem] border border-white/80 bg-white/60 backdrop-blur-md">
                      <div className="relative m-2.5 h-56 overflow-hidden rounded-[1.375rem]">
                        <Image
                          src={v?.image ?? '/images/cabinet/salle-verte.jpg'}
                          alt=""
                          fill
                          sizes="(min-width: 1024px) 40vw, 100vw"
                          className="object-cover"
                        />
                      </div>
                      <div className="px-6 pt-1.5 pb-7 sm:px-7">
                        <div className="flex items-start justify-between gap-4">
                          <h3 className="font-heading text-[1.625rem] font-bold">{nomCourtCabinet(c.nom)}</h3>
                          <p className="shrink-0 rounded-[1.125rem] bg-linear-to-br from-[#387a70] to-[#2c5f58] px-4 py-2.5 text-center text-white">
                            <span className="block font-heading text-3xl leading-none font-extrabold">
                              {c.fauteuils}
                            </span>
                            <span className="text-xs">{c.fauteuils > 1 ? 'fauteuils' : 'fauteuil'}</span>
                          </p>
                        </div>
                        <ul className="mt-4 space-y-2.5 text-[0.9375rem]">
                          <li className="flex items-center gap-2.5">
                            <Clock aria-hidden className="size-[1.125rem] shrink-0" strokeWidth={1.6} />
                            <span className="first-letter:uppercase">
                              {c.jours.length > 0 ? joursLongs(c.jours) : 'Horaires à renseigner'}
                            </span>
                          </li>
                          <li className={cn('flex items-center gap-2.5', !c.adresse && 'text-etat-alerte')}>
                            <MapPin aria-hidden className="size-[1.125rem] shrink-0" strokeWidth={1.6} />
                            {c.adresse ?? 'Adresse à renseigner'}
                          </li>
                          <li className={cn('flex items-center gap-2.5', !v?.telephone && 'text-etat-alerte')}>
                            <Phone aria-hidden className="size-[1.125rem] shrink-0" strokeWidth={1.6} />
                            {v?.telephone ? (
                              <a href={`tel:${v.telephone.replace(/\s/g, '')}`} className="hover:underline">
                                {v.telephone}
                              </a>
                            ) : (
                              'Numéro à renseigner'
                            )}
                          </li>
                        </ul>
                        <Link
                          href={`/cabinets/${slugDuSite(c.code)}`}
                          className="lien-action mt-5 inline-flex text-[0.9375rem]"
                        >
                          En savoir plus
                        </Link>
                      </div>
                    </article>
                  </Fragment>
                )
              })}
            </div>
          </div>
        </section>
      </main>

      <PiedDePage />
    </>
  )
}
