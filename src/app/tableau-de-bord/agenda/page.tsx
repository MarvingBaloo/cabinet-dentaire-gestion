import { TypeIndisponibilite } from '@prisma/client'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { Message } from '@/components/ui/message'
import { type BandeauJour, CalendrierMois } from '@/components/features/agenda/calendrier-mois'
import { DerouleJour } from '@/components/features/agenda/deroule-jour'
import { GrilleJour } from '@/components/features/agenda/grille-jour'
import { FicheRendezVousProvider } from '@/components/features/agenda/panneau-rendez-vous'
import { GrilleSemaine } from '@/components/features/agenda/grille-semaine'
import { LegendeSites } from '@/components/features/agenda/legende-sites'
import { NotesJour } from '@/components/features/agenda/notes-jour'
import { PanneauAgenda } from '@/components/features/agenda/panneau-agenda'
import { RaccourcisAgenda } from '@/components/features/agenda/raccourcis-agenda'
import {
  aujourdHuiLocal,
  bornesDuJour,
  decalerJour,
  grilleMois,
  jourEnToutesLettres,
  jourLocal,
  joursSemaineAffiches,
  moisEnToutesLettres,
  moisPrecedent,
  moisSuivant,
  minutesDepuisMinuit,
} from '@/lib/dates'
import { libelleFerie } from '@/lib/jours-feries'
import { COOKIE_PANNEAU_REPLIE, hrefAgenda } from '@/lib/url-agenda'
import { cn } from '@/lib/utils'
import { hasPermission } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { lireCabinetChoisi } from '@/server/cabinet-choisi'
import {
  listerFauteuils,
  listerIndisponibilites,
  listerMotifs,
  listerPraticiens,
  listerPresences,
  listerRendezVous,
  listerRendezVousConsolide,
  listerRendezVousPraticien,
} from '@/server/queries/agenda'
import { lireIdentite } from '@/server/queries/identite'
import { listerNotesJour } from '@/server/queries/notes-jour'
import { listerFauteuilsPraticiens } from '@/server/queries/presences'
import { parseParametresAgenda } from '@/server/validation/agenda'

// Planning (maquettes du 13/10) : panneau de gauche commun — mini-calendrier,
// cabinet, praticiens, actes et statuts, notes du jour — et trois vues, jour par
// fauteuil, semaine, mois, rassemblées ici parce qu'elles partagent la même
// navigation et les mêmes paramètres d'URL. Le garde reste dans le layout
// (`exigerContexte`) et dans la DAL : cette page n'affiche que ce que la DAL
// consent à rendre, et laisse remonter telle quelle une éventuelle
// `PorteeConsolideeError` — refuser la vue consolidée à un compte mono-site est
// un défaut de sécurité s'il est avalé en silence, pas une erreur à rattraper.

export const metadata = { title: 'Agenda' }

// Lit la base à chaque affichage : jamais pré-rendue à la construction.
export const dynamic = 'force-dynamic'

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const nomCourt = (nom: string) => nom.replace(/^Cabinet (de |d’|d')/, '')

/** Numéro de semaine ISO 8601 d'un jour `AAAA-MM-JJ`. */
function semaineIso(jour: string): number {
  const d = new Date(`${jour}T12:00:00Z`)
  const jeudi = new Date(d)
  jeudi.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7))
  const premierJeudi = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 4))
  return (
    1 +
    Math.round(
      (jeudi.getTime() - premierJeudi.getTime()) / 604_800_000 - (((premierJeudi.getUTCDay() + 6) % 7) - 3) / 7,
    )
  )
}

/** « 12 → 17 octobre 2026 », ou « 28 septembre → 3 octobre 2026 ». */
function titreSemaine(jours: string[]): string {
  const [premier, dernier] = [jours[0]!, jours.at(-1)!]
  const mois = (j: string) => moisEnToutesLettres(j).split(' ')[0]!
  const annee = dernier.slice(0, 4)
  return premier.slice(0, 7) === dernier.slice(0, 7)
    ? `${Number(premier.slice(8))} → ${Number(dernier.slice(8))} ${mois(dernier)} ${annee}`
    : `${Number(premier.slice(8))} ${mois(premier)} → ${Number(dernier.slice(8))} ${mois(dernier)} ${annee}`
}

export default async function PageAgenda({
  searchParams,
}: {
  searchParams: Promise<{
    vue?: string
    date?: string
    jour?: string
    site?: string
    praticien?: string
    sansPraticien?: string | string[]
    sansMotif?: string | string[]
    sansStatut?: string | string[]
    tousPraticiens?: string
    rdv?: string
    enregistre?: string
  }>
}) {
  const ctx = await exigerContexte()
  const brut = await searchParams
  const aujourdHui = aujourdHuiLocal()
  const params = parseParametresAgenda(brut, aujourdHui)
  const { vue, date } = params

  const [fauteuils, praticiensDuCabinet, motifs, identite, { choisi }] = await Promise.all([
    listerFauteuils(ctx),
    listerPraticiens(ctx),
    listerMotifs(ctx),
    lireIdentite(ctx),
    lireCabinetChoisi(ctx),
  ])
  // Un praticien qui n'administre pas ne voit que lui (Marving, 27/10) : plus de confrère à cocher.
  const praticiens = ctx.praticienRestreint
    ? praticiensDuCabinet.filter((p) => p.id === ctx.praticienRestreint)
    : praticiensDuCabinet
  const sites = [...new Map(fauteuils.map((f) => [f.site.id, f.site])).values()]

  // Un site demandé hors de la portée de l'appelant n'est pas gardé : la DAL
  // l'ignorerait de toute façon via `filtreSite`. Sans demande, le cabinet
  // choisi dans la barre du haut (Accueil), sinon le premier visible.
  const siteDemande = params.siteId && sites.some((s) => s.id === params.siteId) ? params.siteId : null
  const praticienChoisi =
    params.praticienId && praticiens.some((p) => p.id === params.praticienId) ? params.praticienId : null
  // Un seul cabinet en activité (D74) : rien à regrouper.
  const consolide = params.tousLesSites && !praticienChoisi && sites.length > 1
  const siteChoisi = consolide
    ? null
    : (siteDemande ?? (choisi && sites.some((s) => s.id === choisi.id) ? choisi.id : (sites[0]?.id ?? null)))
  const site = sites.find((s) => s.id === siteChoisi)

  // L'administrateur, quand il est praticien, ne voit par défaut que ses rendez-vous et coche ses confrères s'il
  // veut les voir (13/10). Les autres praticiens ne voient que les leurs (27/10, filtré dans la DAL). La
  // secrétaire voit tout le monde.
  const praticiensExclus =
    identite.praticienId && !params.tousPraticiens && params.praticiensExclus.length === 0
      ? praticiens.filter((p) => p.id !== identite.praticienId).map((p) => p.id)
      : params.praticiensExclus

  const jours = joursSemaineAffiches(date)
  const semainesMois = grilleMois(date)
  const periode =
    vue === 'jour'
      ? bornesDuJour(date)
      : vue === 'semaine'
        ? { debut: bornesDuJour(jours[0]!).debut, fin: bornesDuJour(jours.at(-1)!).fin }
        : {
            debut: bornesDuJour(semainesMois[0]![0]!).debut,
            fin: bornesDuJour(decalerJour(semainesMois.at(-1)![6]!, 1)).debut,
          }

  // Les exclusions de praticiens sont appliquées ici, pas dans la requête : le
  // panneau affiche le nombre de rendez-vous de CHAQUE praticien, coché ou non.
  const filtres = { motifsExclus: params.motifsExclus, statutsExclus: params.statutsExclus }
  const vueDUnPraticien = vue === 'jour' && !!identite.praticienId
  const [tousRendezVous, notes, presences, indisponibilites, fauteuilsFixes] = await Promise.all([
    praticienChoisi
      ? listerRendezVousPraticien(ctx, praticienChoisi, periode, filtres)
      : consolide
        ? listerRendezVousConsolide(ctx, periode, filtres)
        : listerRendezVous(ctx, periode, { ...(siteChoisi ? { siteId: siteChoisi } : {}), filtres }),
    listerNotesJour(ctx, { premierJour: date, dernierJour: date }, siteChoisi ? { siteId: siteChoisi } : {}),
    listerPresences(ctx, periode),
    vue === 'mois' ? listerIndisponibilites(ctx, periode) : Promise.resolve([]),
    vueDUnPraticien ? listerFauteuilsPraticiens(ctx) : Promise.resolve([]),
  ])
  const rendezVous = tousRendezVous.filter((r) => !praticiensExclus.includes(r.praticien.id))
  const nombreParPraticien = new Map<string, number>()
  for (const r of tousRendezVous) {
    if (r.statut === 'ANNULE') continue
    nombreParPraticien.set(r.praticien.id, (nombreParPraticien.get(r.praticien.id) ?? 0) + 1)
  }

  // Praticien présent ailleurs que dans le cabinet affiché, par jour. Les
  // présences sont déjà cantonnées par la DAL aux cabinets visibles (D5) : une
  // secrétaire de Marie-Galante n'apprend rien de la Guadeloupe.
  const ailleurs: Record<string, string[]> = {}
  if (siteChoisi) {
    for (const p of presences) {
      if (p.site.id === siteChoisi || praticiensExclus.includes(p.praticien.id)) continue
      const j = jourLocal(p.debut)
      const texte = `Dr ${p.praticien.nom} à ${nomCourt(p.site.nom)}`
      ailleurs[j] = [...new Set([...(ailleurs[j] ?? []), texte])]
    }
  }

  // Pour pré-remplir le praticien d'une case vide cliquée (19/10) — les mêmes
  // présences que celles déjà lues pour la page, cantonnées aux cabinets visibles (D5).
  const peutCreer = hasPermission(ctx, 'agenda', 'create')
  // Toutes les présences, praticiens décochés compris, avec les noms : le glisser-déposer dit pendant le geste à
  // qui est un fauteuil et quand un praticien est là (23/10).
  const occupation = presences.map((p) => {
    const j = jourLocal(p.debut)
    return {
      praticienId: p.praticien.id,
      praticienNom: p.praticien.nom,
      siteId: p.site.id,
      fauteuilId: p.fauteuil.id,
      fauteuilNom: p.fauteuil.nom,
      jour: j,
      debut: minutesDepuisMinuit(p.debut, j),
      fin: minutesDepuisMinuit(p.fin, j),
    }
  })
  const presencesGrille = presences
    .filter((p) => !praticiensExclus.includes(p.praticien.id))
    .map((p) => {
      const j = jourLocal(p.debut)
      return {
        praticienId: p.praticien.id,
        siteId: p.site.id,
        fauteuilId: p.fauteuil.id,
        jour: j,
        debut: minutesDepuisMinuit(p.debut, j),
        fin: minutesDepuisMinuit(p.fin, j),
      }
    })

  const base = {
    vue,
    date,
    site: consolide ? 'tous' : (siteChoisi ?? undefined),
    praticien: praticienChoisi ?? undefined,
    sansPraticien: praticiensExclus,
    sansMotif: params.motifsExclus,
    sansStatut: params.statutsExclus,
    tousPraticiens: !!identite.praticienId && praticiensExclus.length === 0,
  }
  const precedent =
    vue === 'jour' ? decalerJour(date, -1) : vue === 'semaine' ? decalerJour(date, -7) : moisPrecedent(date)
  const suivant = vue === 'jour' ? decalerJour(date, 1) : vue === 'semaine' ? decalerJour(date, 7) : moisSuivant(date)
  const hrefJour = (jour: string) => hrefAgenda({ ...base, vue: 'jour', date: jour })

  const nomCabinet = consolide ? 'les deux cabinets' : site ? site.nom : 'aucun cabinet'
  const fauteuilsDuCabinet = siteChoisi ? fauteuils.filter((f) => f.site.id === siteChoisi) : fauteuils
  // Chaque praticien a son fauteuil fixe (D80) : un praticien ne voit en vue jour que les fauteuils des praticiens
  // affichés — le sien, et ceux des confrères que l'administrateur a cochés (Marving, 30/10). Un rendez-vous ou une
  // présence affichés gardent toujours leur colonne. La secrétaire et l'assistante gardent tous les fauteuils.
  const affiche = (praticienId: string) =>
    praticiens.some((p) => p.id === praticienId) && !praticiensExclus.includes(praticienId)
  const fauteuilsDesAffiches = new Set([
    ...fauteuilsFixes.filter((f) => affiche(f.praticienId)).map((f) => f.fauteuilId),
    ...presencesGrille.filter((p) => p.jour === date && affiche(p.praticienId)).map((p) => p.fauteuilId),
    ...rendezVous.map((r) => r.fauteuil.id),
  ])
  const fauteuilsAffiches =
    vueDUnPraticien && fauteuilsDuCabinet.some((f) => fauteuilsDesAffiches.has(f.id))
      ? fauteuilsDuCabinet.filter((f) => fauteuilsDesAffiches.has(f.id))
      : fauteuilsDuCabinet
  const titre =
    vue === 'jour'
      ? majuscule(jourEnToutesLettres(date))
      : vue === 'semaine'
        ? titreSemaine(jours)
        : majuscule(moisEnToutesLettres(date))
  const actifs = rendezVous.filter((r) => r.statut !== 'ANNULE')
  const sousTitre =
    vue === 'jour'
      ? `${majuscule(nomCabinet)} · ${fauteuilsAffiches.length} fauteuil${fauteuilsAffiches.length > 1 ? 's' : ''} · ${actifs.length} rendez-vous`
      : vue === 'semaine'
        ? `Semaine ${semaineIso(jours[0]!)} · ${nomCabinet}`
        : `${majuscule(nomCabinet)} · ${actifs.filter((r) => jourLocal(r.debut).slice(0, 7) === date.slice(0, 7)).length} rendez-vous ce mois-ci`

  const droitsNotes = {
    siteIdCreation: siteChoisi ?? (sites.length === 1 ? sites[0]!.id : null),
    afficherBadge: !siteChoisi && sites.length > 1,
    peutCreer: hasPermission(ctx, 'note', 'create'),
    peutModifier: hasPermission(ctx, 'note', 'update'),
    peutSupprimer: hasPermission(ctx, 'note', 'delete'),
  }
  const peutDeplacer = hasPermission(ctx, 'agenda', 'update')

  // Change dès qu'un rendez-vous affiché change : la fiche ouverte se relit alors (D61).
  const signature = rendezVous.map((r) => `${r.id}:${r.statut}:${r.debut.getTime()}:${r.fin.getTime()}`).join('|')

  return (
    <FicheRendezVousProvider
      signature={signature}
      initiale={typeof brut.rdv === 'string' && /^[0-9a-f-]{36}$/i.test(brut.rdv) ? brut.rdv : null}
      annonce={brut.enregistre ? 'Rendez-vous enregistré. Le patient reçoit un SMS de confirmation.' : null}
    >
      <div className="flex min-h-full flex-col lg:flex-row">
        <PanneauAgenda
          vue={vue}
          date={date}
          aujourdHui={aujourdHui}
          sousTitre={consolide ? 'Les deux cabinets' : site ? nomCourt(site.nom) : ''}
          cabinets={sites.map((s) => ({ id: s.id, nom: s.nom }))}
          siteCourant={consolide ? 'tous' : (siteChoisi ?? '')}
          consolideDisponible={ctx.porteeGlobale && sites.length > 1}
          praticienHistorique={praticienChoisi}
          praticiens={praticiens.map((p) => ({
            id: p.id,
            nom: p.nom,
            prenom: p.prenom,
            couleur: p.couleur,
            nombre: nombreParPraticien.get(p.id) ?? 0,
          }))}
          motifs={motifs.map((m) => ({ id: m.id, libelle: m.libelle, couleur: m.couleur }))}
          praticiensExclus={praticiensExclus}
          motifsExclus={params.motifsExclus}
          statutsExclus={params.statutsExclus}
          marquerTousPraticiens={!!identite.praticienId}
          notes={<NotesJour variante="panneau" jour={date} notes={notes} sites={sites} {...droitsNotes} />}
          replieInitial={(await cookies()).get(COOKIE_PANNEAU_REPLIE)?.value === '1'}
        />

        <div className="min-w-0 flex-1 space-y-5 px-4 py-5 pb-24 lg:space-y-6 lg:px-8 lg:py-10 lg:pb-10">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-2xl leading-tight font-extrabold tracking-tight md:text-[length:var(--texte-titre-3)]">
                {titre}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <p className="hidden sm:block">{sousTitre}</p>
                {/* Navigation par liens : chaque période a son adresse, sans JavaScript. */}
                <nav aria-label="Changer de période" className="flex items-center gap-1">
                  <Link
                    href={hrefAgenda({ ...base, date: precedent })}
                    aria-label="Période précédente"
                    className="flex size-9 items-center justify-center rounded-full border border-[#dde9e6] bg-white text-foreground hover:bg-[#f5f9f8] md:size-8"
                  >
                    <span aria-hidden>‹</span>
                  </Link>
                  {date !== aujourdHui ? (
                    <Link
                      href={hrefAgenda({ ...base, date: aujourdHui })}
                      className="flex h-9 items-center rounded-full border border-[#dde9e6] bg-white px-3 text-foreground hover:bg-[#f5f9f8] md:h-8"
                    >
                      Aujourd’hui
                    </Link>
                  ) : null}
                  <Link
                    href={hrefAgenda({ ...base, date: suivant })}
                    aria-label="Période suivante"
                    className="flex size-9 items-center justify-center rounded-full border border-[#dde9e6] bg-white text-foreground hover:bg-[#f5f9f8] md:size-8"
                  >
                    <span aria-hidden>›</span>
                  </Link>
                </nav>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <nav aria-label="Vue" className="flex rounded-full bg-[#f1f5f5] p-1 text-sm">
                {(['jour', 'semaine', 'mois'] as const).map((v) => (
                  <Link
                    key={v}
                    href={hrefAgenda({ ...base, vue: v })}
                    aria-current={v === vue ? 'page' : undefined}
                    className={cn(
                      'flex h-9 items-center rounded-full px-5',
                      v === vue
                        ? 'bg-white font-semibold text-foreground shadow-[0_2px_8px_rgb(0_0_0/0.08)]'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {majuscule(v)}
                  </Link>
                ))}
              </nav>
              {/* Le jour affiché suit le lien : on pose un rendez-vous le jour qu'on regarde. */}
              <Link
                href={`/tableau-de-bord/agenda/nouveau?jour=${date}`}
                className="hidden h-10 items-center bouton-principal px-4 text-sm font-semibold md:inline-flex"
              >
                + Nouveau rendez-vous
              </Link>
              <RaccourcisAgenda
                liens={{
                  precedent: hrefAgenda({ ...base, date: precedent }),
                  suivant: hrefAgenda({ ...base, date: suivant }),
                  aujourdHui: hrefAgenda({ ...base, date: aujourdHui }),
                  jour: hrefAgenda({ ...base, vue: 'jour' }),
                  semaine: hrefAgenda({ ...base, vue: 'semaine' }),
                  mois: hrefAgenda({ ...base, vue: 'mois' }),
                  nouveau: `/tableau-de-bord/agenda/nouveau?jour=${date}`,
                }}
              />
              {/* Sur téléphone, un « + » flottant au-dessus de la barre du bas, toujours à portée du pouce. */}
              <Link
                href={`/tableau-de-bord/agenda/nouveau?jour=${date}`}
                aria-label="Nouveau rendez-vous"
                className="fixed right-4 bottom-20 z-20 grid size-14 place-items-center rounded-full bouton-principal text-3xl leading-none shadow-lg md:hidden"
              >
                +
              </Link>
            </div>
          </header>

          {consolide ? <LegendeSites sites={sites} /> : null}

          {vue === 'jour' ? (
            <>
              {libelleFerie(date) ? <Message ton="alerte">Jour férié : {libelleFerie(date)}</Message> : null}
              {/* Sur téléphone, trois fauteuils ne tiennent pas côte à côte : la liste de la journée suffit. */}
              <div className="hidden md:block">
                <GrilleJour
                  jour={date}
                  fauteuils={fauteuilsAffiches}
                  rendezVous={rendezVous}
                  consolide={consolide}
                  peutDeplacer={peutDeplacer}
                  peutCreer={peutCreer}
                  presences={presencesGrille}
                  occupation={occupation}
                  presents={Object.fromEntries(
                    fauteuilsAffiches.map((f) => [
                      f.id,
                      [
                        ...new Map(
                          presences
                            .filter((p) => p.fauteuil.id === f.id && jourLocal(p.debut) === date)
                            .map((p) => [p.praticien.id, { nom: p.praticien.nom, couleur: p.praticien.couleur }]),
                        ).values(),
                      ],
                    ]),
                  )}
                />
              </div>
              <section className="space-y-2">
                <h3 className="hidden text-sm font-semibold md:block">
                  Déroulé de la journée
                  <span className="ml-2 font-normal text-muted-foreground">{rendezVous.length} rendez-vous</span>
                </h3>
                <DerouleJour rendezVous={rendezVous} consolide={consolide} />
              </section>
            </>
          ) : vue === 'semaine' ? (
            <GrilleSemaine
              jours={jours}
              rendezVous={rendezVous}
              consolide={consolide}
              hrefJour={hrefJour}
              aujourdHui={aujourdHui}
              peutDeplacer={peutDeplacer}
              peutCreer={peutCreer}
              presences={presencesGrille}
              occupation={occupation}
              siteId={siteChoisi}
              ailleurs={ailleurs}
            />
          ) : (
            <CalendrierMois
              jour={date}
              aujourdHui={aujourdHui}
              // Seulement ce que la case affiche : la vue est un composant client,
              // le reste du rendez-vous n'a pas à partir vers le navigateur.
              rendezVous={rendezVous.map((r) => ({
                id: r.id,
                debut: r.debut,
                statut: r.statut,
                praticien: { couleur: r.praticien.couleur },
                patient: { nom: r.patient.nom },
              }))}
              liens={Object.fromEntries(semainesMois.flat().map((j) => [j, hrefJour(j)]))}
              peutDeplacer={peutDeplacer}
              bandeaux={bandeauxMois(semainesMois.flat(), ailleurs, indisponibilites, praticiensExclus)}
            />
          )}
        </div>
      </div>
    </FicheRendezVousProvider>
  )
}

/** Bandeaux de la vue mois : praticien dans l'autre cabinet, praticien en congé. */
function bandeauxMois(
  jours: string[],
  ailleurs: Record<string, string[]>,
  indisponibilites: Awaited<ReturnType<typeof listerIndisponibilites>>,
  praticiensExclus: string[],
): Record<string, BandeauJour[]> {
  const out: Record<string, BandeauJour[]> = {}
  for (const j of jours) {
    const { debut, fin } = bornesDuJour(j)
    const conges = indisponibilites
      .filter(
        (i) =>
          i.type === TypeIndisponibilite.CONGE &&
          i.praticien &&
          !praticiensExclus.includes(i.praticien.id) &&
          i.debut < fin &&
          i.fin > debut,
      )
      .map((i) => ({ texte: `Dr ${i.praticien!.nom} en congé`, ton: 'conge' as const }))
    const autres = (ailleurs[j] ?? []).map((texte) => ({ texte, ton: 'ailleurs' as const }))
    const tous = [...autres, ...conges]
    if (tous.length) out[j] = [...new Map(tous.map((b) => [b.texte, b])).values()]
  }
  return out
}
