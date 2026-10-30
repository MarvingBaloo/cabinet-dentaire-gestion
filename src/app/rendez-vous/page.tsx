import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'

import { FormulaireReservation } from '@/components/features/portail/formulaire-reservation'
import { EnTetePublic } from '@/components/features/vitrine/en-tete-public'
import { PiedDePage } from '@/components/features/vitrine/pied-de-page'
import { EtatVide } from '@/components/ui/etat-vide'
import { LIBELLE_MOMENT, horairesDuJour, propositions } from '@/lib/creneaux-montres'
import {
  grilleMois,
  heureCabinet,
  jourLocal,
  minutesDepuisMinuit,
  moisEnToutesLettres,
  moisPrecedent,
  moisSuivant,
  premierJourMois,
} from '@/lib/dates'
import { joursLongs, nomCourtCabinet } from '@/lib/jours-publics'
import { slugDuSite } from '@/lib/site-slug'
import { cn } from '@/lib/utils'
import { adresseIpClient } from '@/server/http/adresse-ip'
import {
  type EntreeMotifPatient,
  listerMotifsPatient,
  listerPraticiensPublics,
} from '@/server/queries/public/catalogue'
import { creneauxDisponibles } from '@/server/queries/public/creneaux'
import { presencesPubliques } from '@/server/queries/public/presences'
import { tropDeLecturesPubliques } from '@/server/services/lecture-publique'

// Parcours de réservation (maquette du 13/10) : cinq étapes sur une même page,
// chacune s'ouvrant sous la précédente — où, pourquoi, avec qui, quand, puis
// les coordonnées.
//
// CHAQUE CHOIX EST UNE ADRESSE. La navigation se fait par liens, pas par état
// de composant : le patient peut revenir en arrière avec son navigateur, garder
// un lien, recharger sans tout reperdre — et la page fonctionne avant même que
// le JavaScript soit chargé, ce qui compte sur un mobile en bord de réseau. Le
// fragment (#etape-3) amène l'écran sur l'étape qui vient de s'ouvrir.
//
// Seules les coordonnées puis le code sont un formulaire.

export const metadata: Metadata = {
  title: 'Prendre rendez-vous',
  description: 'Choisissez votre cabinet, le motif de votre venue et un créneau disponible.',
}

export const dynamic = 'force-dynamic'

const TOUS = 'tous'

type Params = {
  site?: string
  menu?: string
  motif?: string
  praticien?: string
  creneau?: string
  /** « Un autre jour ? » : le calendrier à la place des trois propositions (P1, 26/10). */
  autre?: string
  /** Le jour choisi dans le calendrier, et le mois qu'il montre. */
  date?: string
  mois?: string
  /** Étape rouverte par « Modifier » : elle s'affiche en entier, les suivantes se cachent. */
  modifier?: string
}

const TITRES_COURTS = ['Cabinet', 'Motif', 'Praticien', 'Créneau']

const TITRES_ETAPES = [
  'Dans quel cabinet ?',
  'Que vous amène ?',
  'Avec quel praticien ?',
  'Choisissez un créneau',
  'Vos coordonnées',
]

/** Numéro d'étape en hexagone dégradé (maquette-prise-de-rendez-vous.pdf, R2, 19/10). */
function NumeroEtape({ numero }: { numero: number }) {
  return (
    <span className="hexagone grid h-[2.4rem] w-[2.125rem] shrink-0 place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] font-heading text-sm font-bold text-white">
      {numero}
    </span>
  )
}

const INITIALES = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

/** « 9 h 30 » : l'heure comme on la dit, sur les propositions. */
const heureDite = (d: Date) => heureCabinet(d).replace(/^0/, '').replace(':', '\u00a0h\u00a0')

const jourComplet = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Guadeloupe',
})
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Le libellé que le patient a choisi, pour le récapitulatif et le fichier .ics.
 * Cherché dans le menu patient et non dans le catalogue des actes : c'est
 * « Détartrage » qu'il a lu à l'écran, pas le nom technique de l'acte (D20).
 */
function libelleDuMotif(menu: EntreeMotifPatient[], motifId: string): string | null {
  for (const entree of menu) {
    if (entree.motifId === motifId) return entree.libelle
    // « Une dent » seul ne dit rien (tour du 20/10) : le sous-choix garde le titre de son entrée.
    const enfant = entree.enfants.find((c) => c.motifId === motifId)
    if (enfant) return `${entree.libelle} · ${enfant.libelle}`
  }
  return null
}

function Etape({ numero, titre, children }: { numero: number; titre: string; children: React.ReactNode }) {
  return (
    <section
      id={`etape-${numero}`}
      aria-labelledby={`titre-etape-${numero}`}
      className="carte-douce scroll-mt-8 px-5 py-7 sm:px-8 group-has-[[data-plein-ecran]]/parcours:hidden"
    >
      <h2 id={`titre-etape-${numero}`} className="flex items-center gap-3.5 font-heading text-2xl font-bold">
        <NumeroEtape numero={numero} />
        {titre}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  )
}

/** Une étape faite, repliée sur une ligne : le choix retenu et « Modifier » (R2, 19/10). */
function EtapeFaite({ numero, titre, valeur, href }: { numero: number; titre: string; valeur: string; href: string }) {
  return (
    <section
      id={`etape-${numero}`}
      aria-label={`${titre} : ${valeur}`}
      className="carte-douce flex scroll-mt-8 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 sm:px-7 group-has-[[data-plein-ecran]]/parcours:hidden"
    >
      <NumeroEtape numero={numero} />
      <p className="font-heading text-lg font-bold">{titre}</p>
      <p className="min-w-0 flex-1 text-[0.9375rem] text-muted-foreground max-sm:basis-full max-sm:pl-12">{valeur}</p>
      <Link href={href} className="text-sm font-semibold text-primary hover:underline max-sm:ml-12">
        Modifier
      </Link>
    </section>
  )
}

/** Un choix = un lien, assez grand pour un pouce. Choisi : bordure, fond bleu pâle et coche. */
function Carte({
  href,
  titre,
  detail,
  choisi,
}: {
  href: string
  titre: string
  detail?: string | null
  choisi: boolean
}) {
  return (
    <Link
      href={href}

      aria-current={choisi ? 'true' : undefined}
      className={cn(
        'relative block min-h-[4.75rem] rounded-2xl border bg-card px-4 py-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        choisi ? 'border-2 border-[#387a70] bg-[#edf6f3]' : 'border-border hover:border-[#387a70]',
      )}
    >
      <span className="block pr-6 font-semibold">{titre}</span>
      {detail ? <span className="mt-1 line-clamp-1 block text-[0.8125rem] text-muted-foreground">{detail}</span> : null}
      {choisi ? <Check aria-hidden className="absolute top-3.5 right-4 size-4 text-[#387a70]" /> : null}
    </Link>
  )
}

/** Choix secondaire (sous-motif, praticien) : bouton plein une fois choisi. */
function Pastille({
  href,
  children,
  choisi,
  centre = false,
}: {
  href: string
  children: React.ReactNode
  choisi: boolean
  centre?: boolean
}) {
  return (
    <Link
      href={href}

      aria-current={choisi ? 'true' : undefined}
      className={cn(
        'flex h-12 items-center rounded-full border px-5 text-[0.9375rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        centre && 'justify-center text-center',
        choisi
          ? 'border-transparent bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white'
          : 'border-border bg-card hover:border-[#387a70]',
      )}
    >
      {children}
    </Link>
  )
}

export default async function PageRendezVous({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams
  const [{ cabinets, praticiens: presences }, menu, praticiensPublics] = await Promise.all([
    presencesPubliques(),
    listerMotifsPatient(),
    listerPraticiensPublics(),
  ])
  const site = cabinets.find((s) => s.id === p.site)

  /** L'adresse d'un choix : on garde ce qui précède, on oublie ce qui suit. */
  const lien = (garder: (keyof Params)[], ajouts: Params, etape: number) => {
    const q = new URLSearchParams()
    for (const k of garder) if (p[k]) q.set(k, p[k]!)
    for (const [k, v] of Object.entries(ajouts)) if (v) q.set(k, v)
    return `/rendez-vous?${q.toString()}#etape-${etape}`
  }

  // ── 2. Le motif : l'entrée ouverte (ses sous-choix) et l'acte retenu ──
  const entreeOuverte =
    menu.find((e) => e.id === p.menu) ??
    (p.motif ? menu.find((e) => e.enfants.some((c) => c.motifId === p.motif)) : undefined)
  const motifLibelle = p.motif ? libelleDuMotif(menu, p.motif) : null
  const motifRetenu = Boolean(site && p.motif && motifLibelle)

  // ── 3. Avec qui : ceux qui pratiquent cet acte ET reçoivent dans ce cabinet ──
  const praticiens = motifRetenu
    ? praticiensPublics.filter(
        (pr) =>
          pr.motifs.some((m) => m.motifId === p.motif) &&
          presences.some((x) => x.id === pr.id && x.sites.some((s) => s.siteId === site!.id)),
      )
    : []
  const nomPraticien = (id: string) => {
    const pr = praticiens.find((x) => x.id === id)
    return pr ? `Dr ${pr.prenom} ${pr.nom}` : null
  }
  const praticienRetenu =
    motifRetenu && Boolean(p.praticien) && (p.praticien === TOUS || praticiens.some((x) => x.id === p.praticien))

  // ── 4. Quand ──
  // Limite par adresse IP (D25) : sans elle, un robot peut relever deux mois
  // d'agenda en boucle. Vérifiée ici et pas dans `creneauxDisponibles` elle-même
  // — ces fonctions ne se protègent pas (README de `queries/public/`).
  const limite = praticienRetenu && (await tropDeLecturesPubliques(await adresseIpClient()))
  const creneaux =
    praticienRetenu && !limite
      ? await creneauxDisponibles({
          motifId: p.motif!,
          siteId: site!.id,
          ...(p.praticien !== TOUS ? { praticienId: p.praticien! } : {}),
        })
      : []

  // Cherché sur le praticien ET l'horaire : avec « peu importe », deux
  // praticiens partagent le même horaire, et le lien porte lequel.
  const choisi = p.creneau
    ? creneaux.find(
        (c) => c.debut.toISOString() === p.creneau && (p.praticien === TOUS || c.praticienId === p.praticien),
      )
    : undefined

  // « Peu importe » : deux praticiens libres à la même heure ne font pas deux
  // choix, seulement du bruit. Un créneau par horaire ; le patient apprend avec
  // qui dans le récapitulatif.
  const visibles =
    p.praticien === TOUS ? [...new Map(creneaux.map((c) => [c.debut.toISOString(), c])).values()] : creneaux
  const parJour = new Map<string, typeof visibles>()
  for (const c of visibles) {
    const j = jourLocal(c.debut)
    parJour.set(j, [...(parJour.get(j) ?? []), c])
  }
  // P1 (26/10) : peu de places montrées à la fois, pour ne pas laisser croire que le cabinet est vide. D'abord
  // trois propositions ; « Un autre jour ? » ouvre un calendrier où un jour montre au plus trois horaires.
  const minutes = (c: (typeof visibles)[number]) => minutesDepuisMinuit(c.debut, jourLocal(c.debut))
  const troisPropositions = propositions(parJour, minutes)
  const tousLesJours = [...parJour.keys()]
  const jourChoisi = p.date && parJour.has(p.date) ? p.date : undefined
  const premierMois = tousLesJours[0] ? premierJourMois(tousLesJours[0]) : undefined
  const dernierMois = tousLesJours.at(-1) ? premierJourMois(tousLesJours.at(-1)!) : undefined
  const moisAffiche =
    p.mois && premierMois && dernierMois && /^\d{4}-\d{2}-01$/.test(p.mois) && p.mois >= premierMois && p.mois <= dernierMois
      ? p.mois
      : jourChoisi
        ? premierJourMois(jourChoisi)
        : premierMois
  const enCalendrier = p.autre === '1' || Boolean(jourChoisi)
  const lienCalendrier = (ajouts: Params) => lien(['site', 'menu', 'motif', 'praticien'], { autre: '1', ...ajouts }, 4)
  const lienCreneau = (c: (typeof visibles)[number]) =>
    lien(
      ['site', 'menu', 'motif', 'praticien', 'autre', 'date', 'mois'],
      { creneau: c.debut.toISOString(), praticien: p.praticien === TOUS ? TOUS : c.praticienId },
      5,
    )
  const lienListeAttente =
    site && p.motif
      ? `/rendez-vous/liste-attente?site=${site.id}&motif=${p.motif}${p.praticien && p.praticien !== TOUS ? `&praticien=${p.praticien}` : ''}`
      : '/rendez-vous/liste-attente'

  const praticienAffiche = choisi
    ? nomPraticien(choisi.praticienId)
    : p.praticien === TOUS
      ? 'Peu importe'
      : p.praticien
        ? nomPraticien(p.praticien)
        : null

  // R2 (19/10) : une étape faite se replie sur une ligne ; seule l'étape en cours s'affiche en entier.
  const faites = [Boolean(site), motifRetenu, praticienRetenu, Boolean(choisi)]
  const premiereAFaire = faites.indexOf(false) + 1 || 5
  const demandee = Number(p.modifier)
  const enCours = demandee >= 1 && demandee < premiereAFaire ? demandee : premiereAFaire
  const lienModifier = (n: number) =>
    lien(['site', 'menu', 'motif', 'praticien', 'creneau', 'autre', 'date', 'mois'], { modifier: String(n) }, n)
  const valeurs = [
    site ? nomCourtCabinet(site.nom) : '',
    motifLibelle ?? '',
    p.praticien === TOUS ? 'Peu importe' : p.praticien ? (nomPraticien(p.praticien) ?? '') : '',
    choisi ? `${majuscule(jourComplet.format(choisi.debut))} à ${heureCabinet(choisi.debut)}` : '',
  ]
  /** L'étape n : repliée si faite et avant l'étape en cours, en entier si en cours, absente après. */
  const etape = (n: number, contenu: () => React.ReactNode) =>
    n < enCours ? (
      <EtapeFaite numero={n} titre={TITRES_COURTS[n - 1]!} valeur={valeurs[n - 1]!} href={lienModifier(n)} />
    ) : n === enCours ? (
      contenu()
    ) : null

  return (
    <div className="group/parcours">
      {/* Bandeau bleu-vert de la page cabinet, avec la progression (R2, 19/10). */}
      <section className="fond-v2-hexagones relative isolate group-has-[[data-plein-ecran]]/parcours:hidden">
        <EnTetePublic surCouleur />
        <div className="mx-auto max-w-[90rem] px-6 pt-36 pb-12 lg:px-20 lg:pt-40">
          <h1 className="font-heading text-[length:var(--texte-titre-2)] leading-none font-extrabold tracking-tight">
            Prendre rendez-vous
          </h1>
          <p className="mt-3 text-encre/85">Sans compte : un code par SMS confirme votre réservation.</p>
          <div aria-hidden className="mt-7 flex max-w-[32.5rem] gap-2">
            {TITRES_ETAPES.map((t, i) => (
              <span key={t} className={cn('h-1.5 flex-1 rounded-full', i < enCours ? 'bg-[#387a70]' : 'bg-white/60')} />
            ))}
          </div>
          <p className="mt-2.5 text-[0.8125rem] text-encre/85">
            Étape {enCours} sur 5 · {TITRES_ETAPES[enCours - 1]!.replace(' ?', '')}
          </p>
        </div>
      </section>
      <div className="hidden group-has-[[data-plein-ecran]]/parcours:block">
        <EnTetePublic clair />
      </div>

      <main className="fond-hexagones">
        <div className="mx-auto grid max-w-[90rem] items-start gap-x-12 gap-y-5 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_23.75rem] lg:px-20 lg:py-16 group-has-[[data-plein-ecran]]/parcours:block group-has-[[data-plein-ecran]]/parcours:py-20">
          <div className="space-y-4">
            {/* 1. Où */}
            {etape(1, () => (
              <Etape numero={1} titre="Dans quel cabinet ?">
                <div className="grid gap-4 sm:grid-cols-2">
                  {cabinets.map((s) => (
                    <Carte
                      key={s.id}
                      href={lien([], { site: s.id }, 2)}
                      titre={nomCourtCabinet(s.nom)}
                      detail={s.jours.length > 0 ? majuscule(joursLongs(s.jours)) : null}
                      choisi={s.id === site?.id}
                    />
                  ))}
                </div>
                <Link
                  href={`/cabinets/${slugDuSite((site ?? cabinets[0])?.code ?? 'MARIE_GALANTE')}`}
                  className="lien-action mt-5 inline-flex text-sm text-primary"
                >
                  En savoir plus sur ce cabinet
                </Link>
              </Etape>
            ))}

            {/* 2. Pourquoi */}
            {site
              ? etape(2, () => (
                  <Etape numero={2} titre="Que vous amène ?">
                    <div className={cn('grid gap-4', menu.length === 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
                      {menu.map((e) => (
                        <Carte
                          key={e.id}
                          // Les sous-entrées l'emportent sur l'acte : c'est l'ajout le
                          // plus récent du cabinet qui dit son intention.
                          href={
                            e.enfants.length > 0
                              ? lien(['site'], { menu: e.id }, 2)
                              : lien(['site'], { motif: e.motifId ?? '' }, 3)
                          }
                          titre={e.libelle}
                          detail={e.aide}
                          choisi={e.id === entreeOuverte?.id || (e.enfants.length === 0 && e.motifId === p.motif)}
                        />
                      ))}
                    </div>
                    {entreeOuverte ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {entreeOuverte.enfants.map((c) => (
                          <Pastille
                            key={c.id}
                            href={lien(['site'], { menu: entreeOuverte.id, motif: c.motifId }, 3)}
                            choisi={c.motifId === p.motif}
                          >
                            {c.libelle}
                          </Pastille>
                        ))}
                      </div>
                    ) : null}
                  </Etape>
                ))
              : null}

            {/* 3. Avec qui */}
            {motifRetenu
              ? etape(3, () => (
                  <Etape numero={3} titre="Avec quel praticien ?">
                    {praticiens.length === 0 ? (
                      <EtatVide
                        variante="filtre"
                        titre="Aucun praticien ne propose ce motif dans ce cabinet"
                        texte="Choisissez un autre cabinet, ou appelez le cabinet."
                      />
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Pastille
                          centre
                          href={lien(['site', 'menu', 'motif'], { praticien: TOUS }, 4)}
                          choisi={p.praticien === TOUS}
                        >
                          Peu importe
                        </Pastille>
                        {praticiens.map((pr) => (
                          <Pastille
                            key={pr.id}
                            centre
                            href={lien(['site', 'menu', 'motif'], { praticien: pr.id }, 4)}
                            choisi={p.praticien === pr.id}
                          >
                            Dr {pr.prenom} {pr.nom}
                          </Pastille>
                        ))}
                      </div>
                    )}
                  </Etape>
                ))
              : null}

            {/* 4. Quand */}
            {praticienRetenu
              ? etape(4, () => (
                  <Etape numero={4} titre="Choisissez un créneau">
                    {limite ? (
                      <EtatVide
                        variante="erreur"
                        titre="Trop de consultations depuis cette connexion"
                        texte="Réessayez dans quelques minutes, ou appelez le cabinet."
                      />
                    ) : parJour.size === 0 ? (
                      <EtatVide
                        variante="filtre"
                        titre="Aucun créneau pour ce motif dans les deux prochains mois"
                        texte="Appelez le cabinet, il reste des solutions."
                        action={
                          <Link href={lienListeAttente} className="lien-action inline-flex text-sm text-primary">
                            Être prévenu si une place se libère
                          </Link>
                        }
                      />
                    ) : (
                      <div className="space-y-6">
                        {!enCalendrier ? (
                          <>
                            <p className="text-[0.9375rem] text-muted-foreground">
                              Nos prochaines disponibilités
                              {p.praticien !== TOUS && praticienAffiche ? ` avec le ${praticienAffiche}` : ''} :
                            </p>
                            <ul className="grid gap-3">
                              {troisPropositions.map((c) => {
                                const estChoisi =
                                  choisi?.debut.getTime() === c.debut.getTime() && choisi.praticienId === c.praticienId
                                return (
                                  <li key={`${c.praticienId}-${c.debut.toISOString()}`}>
                                    <Link
                                      href={lienCreneau(c)}
                                      aria-current={estChoisi ? 'true' : undefined}
                                      className={cn(
                                        'flex items-center gap-4 rounded-[1.25rem] border-[1.5px] px-5 py-4 transition-colors',
                                        estChoisi ? 'border-[#387a70] bg-[#edf6f3]' : 'border-border bg-card hover:border-[#387a70]',
                                      )}
                                    >
                                      <span className="min-w-0 flex-1">
                                        <span className="block font-heading text-lg font-bold">
                                          {majuscule(jourComplet.format(c.debut))}{'\u00a0'}·{' '}
                                          <span className="whitespace-nowrap">{heureDite(c.debut)}</span>
                                        </span>
                                        <span className="block text-[0.8125rem] text-muted-foreground">
                                          {nomCourtCabinet(site!.nom)}
                                          {p.praticien === TOUS ? ` · ${nomPraticien(c.praticienId) ?? ''}` : ''}
                                        </span>
                                      </span>
                                      <span aria-hidden className="text-sm font-semibold text-primary">
                                        Choisir →
                                      </span>
                                    </Link>
                                  </li>
                                )
                              })}
                            </ul>
                            <Link href={lienCalendrier({})} className="lien-action flex w-fit text-sm font-semibold text-primary">
                              Un autre jour ? Choisir une date
                            </Link>
                          </>
                        ) : (
                          <div className="grid gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                            <div>
                              <div className="flex items-center justify-between">
                                <p className="font-heading text-lg font-semibold">
                                  {moisAffiche ? majuscule(moisEnToutesLettres(moisAffiche)) : ''}
                                </p>
                                <nav aria-label="Changer de mois" className="flex gap-1">
                                  {moisAffiche && premierMois && moisAffiche > premierMois ? (
                                    <Link
                                      href={lienCalendrier({ mois: moisPrecedent(moisAffiche), ...(jourChoisi ? { date: jourChoisi } : {}) })}
                                      aria-label="Mois précédent"
                                      className="grid size-9 place-items-center rounded-full text-lg text-primary hover:bg-muted"
                                    >
                                      ‹
                                    </Link>
                                  ) : null}
                                  {moisAffiche && dernierMois && moisAffiche < dernierMois ? (
                                    <Link
                                      href={lienCalendrier({ mois: moisSuivant(moisAffiche), ...(jourChoisi ? { date: jourChoisi } : {}) })}
                                      aria-label="Mois suivant"
                                      className="grid size-9 place-items-center rounded-full text-lg text-primary hover:bg-muted"
                                    >
                                      ›
                                    </Link>
                                  ) : null}
                                </nav>
                              </div>
                              <div className="mt-3 grid grid-cols-7 gap-1.5 text-center" role="group" aria-label="Jours">
                                {INITIALES.map((l, i) => (
                                  <span key={i} aria-hidden className="py-1 text-xs text-muted-foreground">
                                    {l}
                                  </span>
                                ))}
                                {(moisAffiche ? grilleMois(moisAffiche).flat() : []).map((j) => {
                                  const duMois = j.slice(0, 7) === moisAffiche?.slice(0, 7)
                                  const libre = duMois && parJour.has(j)
                                  const n = Number(j.slice(8, 10))
                                  if (!libre)
                                    return (
                                      <span key={j} aria-hidden className={cn('grid h-11 place-items-center text-[0.9375rem]', duMois ? 'text-muted-foreground/45' : 'invisible')}>
                                        {n}
                                      </span>
                                    )
                                  return (
                                    <Link
                                      key={j}
                                      href={lienCalendrier({ date: j, mois: moisAffiche! })}
                                      aria-label={`Choisir le ${majuscule(jourComplet.format(new Date(`${j}T16:00:00Z`)))}`}
                                      aria-current={j === jourChoisi ? 'date' : undefined}
                                      className={cn(
                                        'grid h-11 place-items-center rounded-[0.875rem] border-[1.5px] font-heading text-[0.9375rem] font-semibold transition-colors',
                                        j === jourChoisi
                                          ? 'border-transparent bg-[#387a70] text-white'
                                          : 'border-border bg-card hover:border-[#387a70]',
                                      )}
                                    >
                                      {n}
                                    </Link>
                                  )
                                })}
                              </div>
                              <Link
                                href={lien(['site', 'menu', 'motif', 'praticien'], {}, 4)}
                                className="mt-4 inline-flex text-sm text-primary hover:underline"
                              >
                                ← Revenir aux prochaines disponibilités
                              </Link>
                            </div>
                            <div className="md:border-l md:border-border/60 md:pl-8">
                              {jourChoisi ? (
                                <>
                                  <p className="font-heading text-lg font-bold">
                                    {majuscule(jourComplet.format(new Date(`${jourChoisi}T16:00:00Z`)))}
                                  </p>
                                  <div className="mt-4 grid grid-cols-3 gap-3">
                                    {horairesDuJour(jourChoisi, parJour.get(jourChoisi) ?? [], minutes).map(({ moment, creneau: c }) => {
                                      const estChoisi =
                                        choisi?.debut.getTime() === c.debut.getTime() && choisi.praticienId === c.praticienId
                                      return (
                                        <div key={moment}>
                                          <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                                            {LIBELLE_MOMENT[moment]}
                                          </p>
                                          <Link
                                            href={lienCreneau(c)}
                                            aria-current={estChoisi ? 'true' : undefined}
                                            className={cn(
                                              'chiffres flex h-11 items-center justify-center rounded-full border text-[0.9375rem] transition-colors',
                                              estChoisi
                                                ? 'bouton-principal border-transparent'
                                                : 'border-border bg-card font-semibold text-[#387a70] hover:border-[#387a70]',
                                            )}
                                          >
                                            {heureDite(c.debut)}
                                          </Link>
                                        </div>
                                      )
                                    })}
                                  </div>
                                  <p className="mt-4 text-[0.8125rem] text-muted-foreground">
                                    Ces horaires ne vous vont pas ? Choisissez un autre jour.
                                  </p>
                                </>
                              ) : (
                                <p className="text-[0.9375rem] text-muted-foreground">
                                  Choisissez un jour : ceux qui sont en clair ont encore de la place.
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        <Link href={lienListeAttente} className="lien-action flex w-fit text-sm text-primary">
                          Aucun créneau ne vous convient ? Être prévenu si une place se libère
                        </Link>
                      </div>
                    )}
                  </Etape>
                ))
              : null}

            {/* 5. Coordonnées, puis code */}
            {choisi && site && p.motif && enCours === 5 ? (
              <section
                id="etape-5"
                aria-labelledby="titre-etape-5"
                className="carte-douce scroll-mt-8 px-5 py-7 sm:px-8 group-has-[[data-plein-ecran]]/parcours:border-0 group-has-[[data-plein-ecran]]/parcours:bg-transparent group-has-[[data-plein-ecran]]/parcours:p-0 group-has-[[data-plein-ecran]]/parcours:shadow-none"
              >
                <h2
                  id="titre-etape-5"
                  className="flex items-center gap-3.5 font-heading text-2xl font-bold group-has-[[data-plein-ecran]]/parcours:hidden"
                >
                  <NumeroEtape numero={5} />
                  Vos coordonnées
                </h2>
                <div className="mt-6 group-has-[[data-plein-ecran]]/parcours:mt-0">
                  <FormulaireReservation
                    siteId={site.id}
                    motifId={p.motif}
                    praticienId={choisi.praticienId}
                    debut={choisi.debut.toISOString()}
                    // Pour le récapitulatif et le fichier .ics, et rien d'autre : ce
                    // sont les libellés déjà affichés à l'écran. Le fichier se fabrique
                    // dans le navigateur, sans qu'aucune route publique n'ait à relire
                    // un rendez-vous (D19).
                    siteNom={site.nom}
                    siteAdresse={site.adresse}
                    motifLibelle={motifLibelle}
                    jour={majuscule(jourComplet.format(choisi.debut))}
                    heure={heureCabinet(choisi.debut)}
                    praticienNom={nomPraticien(choisi.praticienId)}
                  />
                </div>
              </section>
            ) : null}
          </div>

          {/* Récapitulatif : en-tête bleu-vert, détails sur blanc (R2, 19/10). En tête sur téléphone. */}
          {site ? (
            <aside className="carte-douce h-fit overflow-hidden max-lg:order-first lg:sticky lg:top-8 group-has-[[data-plein-ecran]]/parcours:hidden">
              <div className="fond-v2-hexagones px-7 py-6">
                <p className="text-xs font-bold tracking-[0.12em] uppercase opacity-85">Votre choix</p>
                {choisi ? (
                  <p className="mt-3 font-heading text-[1.75rem] leading-tight font-extrabold">
                    {majuscule(jourComplet.format(choisi.debut))}
                    <span className="block">à {heureCabinet(choisi.debut)}</span>
                  </p>
                ) : (
                  <p className="mt-3 text-[0.9375rem] text-encre/85">Le jour et l’heure s’afficheront ici.</p>
                )}
              </div>
              <dl className="space-y-4 px-7 py-6">
                <div>
                  <dt className="text-[0.8125rem] text-muted-foreground">Cabinet</dt>
                  <dd className="mt-0.5 font-semibold">{nomCourtCabinet(site.nom)}</dd>
                </div>
                {motifLibelle ? (
                  <div>
                    <dt className="text-[0.8125rem] text-muted-foreground">Motif</dt>
                    <dd className="mt-0.5 font-semibold">{motifLibelle}</dd>
                  </div>
                ) : null}
                {praticienAffiche ? (
                  <div>
                    <dt className="text-[0.8125rem] text-muted-foreground">Praticien</dt>
                    <dd className="mt-0.5 font-semibold">{praticienAffiche}</dd>
                  </div>
                ) : null}
              </dl>
            </aside>
          ) : null}
        </div>
      </main>

      <PiedDePage simple />
    </div>
  )
}
