import type { Metadata } from 'next'
import { MapPin, Phone } from 'lucide-react'
import Image from 'next/image'
import { notFound } from 'next/navigation'

import { EnTetePublic } from '@/components/features/vitrine/en-tete-public'
import { CerclePointille } from '@/components/features/vitrine/cercle-pointille'
import { PiedDePage } from '@/components/features/vitrine/pied-de-page'
import { CABINET, PHOTOS_PRATICIENS, URGENCES } from '@/config/cabinet'
import { env } from '@/config/env'
import { formatHeureMinutesISO, jourLocal } from '@/lib/dates'
import { joursLongs, nomCourtCabinet } from '@/lib/jours-publics'
import { construireJsonLdCabinet, echapperJsonLd } from '@/lib/jsonld'
import { cn } from '@/lib/utils'
import { listerMotifsPatient } from '@/server/queries/public/catalogue'
import { presencesPubliques } from '@/server/queries/public/presences'
import { siteDetailParSlug } from '@/server/queries/public/site'

const IMAGE_PAR_SLUG: Record<string, string> = {
  'marie-galante': '/images/cabinet/salle-beige.jpg',
  guadeloupe: '/images/cabinet/salle-bleue.jpg',
}

const SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

// Page publique d'un cabinet (lot E, D34 ; maquette du 13/10) : horaires,
// adresse, praticiens qui y reçoivent, et une carte de réservation pré-filtrée
// sur ce site. Rien n'est inventé (D24) : un champ que le cabinet n'a pas fourni
// s'affiche « à renseigner », jamais remplacé par un texte plausible.
//
// Données structurées `Dentist` (lot F, JSON-LD) injectées dans le corps de
// page : même règle, un champ absent n'apparaît pas dans le bloc.

type Params = { slug: string }

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const site = await siteDetailParSlug(slug)
  if (!site) return { title: 'Cabinet introuvable' }

  const nomAffiche = CABINET.nomCommercial ?? CABINET.nom

  return {
    title: `${site.nom} — ${nomAffiche}`,
    description: site.adresse
      ? `${nomAffiche}, cabinet de ${site.nom} : ${site.adresse}. Prise de rendez-vous en ligne.`
      : `${nomAffiche}, cabinet de ${site.nom}. Prise de rendez-vous en ligne.`,
  }
}

export default async function PageCabinet({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const site = await siteDetailParSlug(slug)
  if (!site) notFound()

  const [{ cabinets, praticiens }, menu] = await Promise.all([presencesPubliques(), listerMotifsPatient()])
  const cabinet = cabinets.find((c) => c.id === site.id)
  const ici = praticiens.flatMap((p, i) => {
    const s = p.sites.find((x) => x.siteId === site.id)
    return s ? [{ ...p, jours: s.jours, photo: PHOTOS_PRATICIENS[i % PHOTOS_PRATICIENS.length]! }] : []
  })

  // Lu au rendu d'une page dynamique, côté serveur : le jour du cabinet, pas celui du visiteur.
  const indexAujourdhui = (new Date(`${jourLocal(new Date())}T12:00:00.000Z`).getUTCDay() + 6) % 7
  const nomCourt = nomCourtCabinet(site.nom)
  const nomAffiche = CABINET.nomCommercial ?? CABINET.nom
  const lienCarte =
    site.latitude !== null && site.longitude !== null
      ? `https://www.openstreetmap.org/?mlat=${site.latitude}&mlon=${site.longitude}#map=17/${site.latitude}/${site.longitude}`
      : null

  const jsonLd = construireJsonLdCabinet({
    nom: `${nomAffiche} — ${site.nom}`,
    url: `${env.APP_URL}/cabinets/${site.slug}`,
    telephone: CABINET.telephone,
    adresse: site.adresse,
    latitude: site.latitude,
    longitude: site.longitude,
    horaires: site.horaires,
  })

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: echapperJsonLd(jsonLd) }} />

      {/* Haut de page : V1 de maquette-page-cabinet.pdf (19/10) — le bandeau vert d'eau vers bleu de l'accueil,
          le nom du cabinet, et sa photo en hexagone. */}
      <section className="fond-v2-hexagones relative isolate overflow-hidden">
        <EnTetePublic surCouleur />
        <div className="mx-auto max-w-[90rem] px-6 pt-36 pb-16 lg:px-20 lg:pt-44 lg:pb-24">
          <p className="inline-flex rounded-full bg-white/60 px-3.5 py-1.5 text-[0.8125rem] font-semibold">
            Nos cabinets
          </p>
          <h1 className="mt-5 font-heading text-[length:var(--texte-titre-1)] leading-none font-extrabold tracking-tight">
            {nomCourt}
          </h1>
          {cabinet ? (
            <p className="mt-4 text-lg text-encre/85">
              {cabinet.fauteuils} {cabinet.fauteuils > 1 ? 'fauteuils' : 'fauteuil'}
              {cabinet.jours.length > 0 ? ` · ${joursLongs(cabinet.jours)}` : null}
            </p>
          ) : null}
          <div className="hexagone relative mt-10 h-[14.4rem] w-[12.5rem] lg:absolute lg:top-24 lg:right-32 lg:mt-0 lg:h-[19.5rem] lg:w-[16.875rem]">
            <Image
              src={IMAGE_PAR_SLUG[slug] ?? '/images/cabinet/salle-verte.jpg'}
              alt={`Le cabinet de ${nomCourt}`}
              fill
              priority
              sizes="270px"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      <div className="fond-hexagones">
        <main className="mx-auto grid max-w-[90rem] grid-cols-1 items-start gap-x-12 gap-y-6 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_26.25rem] lg:px-20 lg:py-20">
          {/* min-w-0 : un nom ou un menu déroulant long n’élargit plus la page au téléphone (21/10). */}
          <div className="min-w-0 space-y-6">
            <section className="carte-douce px-6 py-7 sm:px-8">
              <h2 className="font-heading text-[1.625rem] font-bold">Horaires d’ouverture</h2>
              {site.horaires.length > 0 ? (
                <table className="mt-4 w-full text-[0.9375rem]">
                  <caption className="sr-only">Horaires d’ouverture du cabinet de {nomCourt}</caption>
                  <tbody>
                    {SEMAINE.map((jour, i) => {
                      const h = site.horaires.find((x) => x.jour === jour)
                      const aujourdhui = i === indexAujourdhui
                      return (
                        <tr
                          key={jour}
                          className={cn(
                            aujourdhui ? 'bg-[#e7f5f2] font-semibold' : 'border-b border-[#edf2f2]',
                            '[&>*:first-child]:rounded-l-[0.875rem] [&>*:last-child]:rounded-r-[0.875rem]',
                          )}
                        >
                          <th scope="row" className={cn('px-3.5 py-3 text-left', !aujourdhui && 'font-normal')}>
                            {jour}
                            {aujourdhui ? ' · aujourd’hui' : null}
                          </th>
                          <td className={cn('chiffres px-3.5 py-3 text-right', !h && 'text-muted-foreground')}>
                            {h
                              ? h.intervalles
                                  .map((x) => `${formatHeureMinutesISO(x.debut)} – ${formatHeureMinutesISO(x.fin)}`)
                                  .join(' · ')
                              : 'Fermé'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="mt-4 text-etat-alerte">Horaires à renseigner.</p>
              )}
            </section>

            <section className="carte-douce px-6 py-7 sm:px-8">
              <h2 className="font-heading text-[1.625rem] font-bold">Adresse et accès</h2>
              <p className={cn('mt-4 flex items-center gap-2.5', !site.adresse && 'text-etat-alerte')}>
                <MapPin aria-hidden className="size-[1.125rem] shrink-0" strokeWidth={1.6} />
                {site.adresse ?? 'Adresse à renseigner'}
              </p>
              {lienCarte ? (
                <a
                  href={lienCarte}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lien-action mt-3 inline-flex text-primary"
                >
                  Voir le plan d’accès
                </a>
              ) : null}
            </section>

            {/* Les praticiens gardent leur présentation en pastilles rondes (choix du 19/10). */}
            {ici.length > 0 ? (
              <section className="carte-douce px-6 py-7 sm:px-8">
                <h2 className="font-heading text-[1.625rem] font-bold">Les praticiens qui reçoivent ici</h2>
                <ul className="mt-6 grid grid-cols-1 gap-8 sm:grid-cols-2">
                  {ici.map((p) => (
                    <li key={p.id} className="flex items-center gap-5">
                      <div className="relative size-[5.5rem] shrink-0 overflow-hidden rounded-full">
                        <Image src={p.photo} alt="" fill sizes="88px" className="object-cover" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-heading text-xl font-semibold [overflow-wrap:anywhere]">
                          Dr {p.prenom} {p.nom}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{joursLongs(p.jours)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-6">
            <form method="get" action="/rendez-vous" className="carte-douce space-y-6 px-6 py-8 sm:px-8">
              <input type="hidden" name="site" value={site.id} />
              <div>
                <h2 className="font-heading text-[1.625rem] font-bold">Prendre rendez-vous</h2>
                <p className="mt-1 text-sm text-muted-foreground">au cabinet de {nomCourt}</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="motif" className="block text-sm font-medium">
                  Que vous amène ?
                </label>
                <select id="motif" name="motif" className="champ" defaultValue="">
                  <option value="">Choisir…</option>
                  {menu.map((e) =>
                    e.enfants.length > 0 ? (
                      <optgroup key={e.id} label={e.libelle}>
                        {e.enfants.map((c) => (
                          <option key={c.id} value={c.motifId}>
                            {c.libelle}
                          </option>
                        ))}
                      </optgroup>
                    ) : e.motifId ? (
                      <option key={e.id} value={e.motifId}>
                        {e.libelle}
                      </option>
                    ) : null,
                  )}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="praticien" className="block text-sm font-medium">
                  Avec quel praticien ?
                </label>
                <select id="praticien" name="praticien" className="champ" defaultValue="">
                  <option value="">Peu importe</option>
                  {ici.map((p) => (
                    <option key={p.id} value={p.id}>
                      Dr {p.prenom} {p.nom}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="lien-action bouton-principal mt-2 h-12 w-full justify-center text-[0.9375rem]"
              >
                Voir les créneaux
              </button>
            </form>

            <section className="fond-v2-hexagones relative overflow-hidden rounded-[1.75rem] px-7 pt-7 pb-24">
              <CerclePointille couleur="#fff" className="absolute -right-24 -bottom-32 w-52 opacity-50" />
              <span className="hexagone grid h-[3.25rem] w-[2.875rem] place-items-center bg-white text-[#387a70]">
                <Phone aria-hidden className="size-5" strokeWidth={1.6} />
              </span>
              <h2 className="mt-4 font-heading text-[1.625rem] font-bold">{URGENCES.intitule}</h2>
              <p className="relative mt-2 text-[0.9375rem] leading-relaxed text-encre/85">{URGENCES.texte}</p>
              {CABINET.telephone ? (
                <a
                  href={`tel:${CABINET.telephone.replace(/\s/g, '')}`}
                  className="chiffres relative mt-5 inline-flex h-11 items-center rounded-full bg-white px-5 font-bold text-[#387a70] hover:bg-white/90"
                >
                  {CABINET.telephone}
                </a>
              ) : (
                <p className="relative mt-5 inline-flex h-11 items-center rounded-full bg-white/60 px-5 font-semibold">
                  Numéro à renseigner
                </p>
              )}
              <p className="relative mt-4 text-[0.8125rem] text-encre/80">{URGENCES.horsHoraires}</p>
            </section>
          </aside>
        </main>
      </div>

      <PiedDePage simple />
    </>
  )
}
