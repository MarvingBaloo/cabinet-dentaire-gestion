'use client'

import { Plus, Star, Sun } from 'lucide-react'
import { useActionState, useState } from 'react'

import { TitreAlveole } from '@/components/features/patients/alveoles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  type EtatPresence,
  choisirFauteuilAction,
  enregistrerExceptionAction,
  enregistrerJourSemaineTypeAction,
  supprimerExceptionAction,
} from '@/server/actions/presences'

// Écran des présences (compléments d'agenda, lot 1) : semaine type par
// praticien (Q2 — agenda fixe, mêmes jours chaque semaine) et ses exceptions
// ponctuelles. La garde anti-orphelin (Q5) est entièrement côté service —
// cet écran se contente d'afficher la liste des rendez-vous concernés quand
// elle refuse.
//
// Une ligne = un formulaire, comme `ModelesMessages` (notifications) : une
// seule grande soumission obligerait à tout renvoyer pour corriger une heure,
// et ferait perdre le reste en cas de refus sur UN seul jour.

const JOURS: { valeur: number; libelle: string }[] = [
  { valeur: 1, libelle: 'Lundi' },
  { valeur: 2, libelle: 'Mardi' },
  { valeur: 3, libelle: 'Mercredi' },
  { valeur: 4, libelle: 'Jeudi' },
  { valeur: 5, libelle: 'Vendredi' },
  { valeur: 6, libelle: 'Samedi' },
  { valeur: 7, libelle: 'Dimanche' },
]

export type PraticienVue = { id: string; nom: string; prenom: string; titre: string | null; couleur: string }
export type SiteVue = { id: string; code: string; nom: string }
export type FauteuilVue = { id: string; nom: string; siteId: string }
export type FauteuilPraticienVue = { praticienId: string; siteId: string; fauteuilId: string }

export type LigneSemaineTypeVue = {
  praticienId: string
  jourSemaine: number
  siteId: string
  fauteuilId: string
  /** "HH:MM", heure du cabinet. */
  heureDebut: string
  heureFin: string
  /** Pause facultative, "HH:MM" ou null. */
  pauseDebut: string | null
  pauseFin: string | null
}

export type ExceptionVue = {
  id: string
  praticienId: string
  /** "AAAA-MM-JJ". */
  date: string
  type: 'RETRAIT' | 'AJOUT_OU_MODIFICATION'
  motif: string | null
  siteNom: string | null
  fauteuilNom: string | null
  heureDebut: string | null
  heureFin: string | null
}

export type JourFerieVue = { date: string; libelle: string }

const dateCourte = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const dateFerie = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const court = (nom: string) => nom.replace(/^Cabinet (de |d’|d')/, '')
const leJour = (date: string) => new Date(`${date}T00:00:00.000Z`)

/** Teinte des cartes de droite (maquettes du 13/10). */
const CARTE = 'carte-douce px-6 py-6 sm:px-7'
const dateHeureFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

function Message({ etat }: { etat: EtatPresence }) {
  if (etat.erreur) {
    return (
      <div
        role="alert"
        className="space-y-1 rounded-[var(--radius-sm)] border border-etat-erreur/30 bg-etat-erreur-fond px-3 py-2 text-sm text-etat-erreur"
      >
        <p>{etat.erreur}</p>
        {etat.rendezVousConcernes && etat.rendezVousConcernes.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-5">
            {etat.rendezVousConcernes.map((r) => (
              <li key={r.id}>
                {dateHeureFormat.format(new Date(r.debut))} — {r.patient} — {r.motif}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }
  if (etat.succes) {
    return (
      <p
        role="status"
        className="rounded-[var(--radius-sm)] border border-etat-succes/30 bg-etat-succes-fond px-3 py-2 text-sm text-etat-succes"
      >
        {etat.succes}
      </p>
    )
  }
  return null
}

export function Presences({
  praticiens,
  sites,
  fauteuils,
  fauteuilsPraticiens,
  semaineType,
  exceptions,
  joursFeries,
  jourDuJour,
}: {
  praticiens: PraticienVue[]
  sites: SiteVue[]
  fauteuils: FauteuilVue[]
  fauteuilsPraticiens: FauteuilPraticienVue[]
  semaineType: LigneSemaineTypeVue[]
  exceptions: ExceptionVue[]
  joursFeries: JourFerieVue[]
  /** Aujourd'hui, heure du cabinet — vient de la fonction d'accès qui a chargé
   *  la page, jamais lu ici : un composant ne lit pas l'horloge à son rendu. */
  jourDuJour: string
}) {
  if (praticiens.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
        Aucun praticien dans votre périmètre.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="min-w-0 space-y-6">
        {praticiens.map((p) => (
          <SemaineTypePraticien
            key={p.id}
            praticien={p}
            sites={sites}
            fauteuils={fauteuils}
            fauteuilsDuPraticien={fauteuilsPraticiens.filter((f) => f.praticienId === p.id)}
            lignes={semaineType.filter((l) => l.praticienId === p.id)}
          />
        ))}
      </div>

      <div className="space-y-6">
        <Exceptions praticiens={praticiens} exceptions={exceptions} semaineType={semaineType} />
        <NouvelleException praticiens={praticiens} sites={sites} jourDuJour={jourDuJour} />
        <Feries
          praticiens={praticiens}
          sites={sites}
          joursFeries={joursFeries}
          exceptions={exceptions}
        />
      </div>
    </div>
  )
}

function SemaineTypePraticien({
  praticien,
  sites,
  fauteuils,
  fauteuilsDuPraticien,
  lignes,
}: {
  praticien: PraticienVue
  sites: SiteVue[]
  fauteuils: FauteuilVue[]
  fauteuilsDuPraticien: FauteuilPraticienVue[]
  lignes: LigneSemaineTypeVue[]
}) {
  const [edition, setEdition] = useState(false)
  const parJour = new Map(lignes.map((l) => [l.jourSemaine, l]))
  // Le dimanche n'apparaît que s'il est travaillé : le cabinet ne reçoit pas ce jour-là.
  const jours = JOURS.filter((j) => j.valeur !== 7 || parJour.has(7) || edition)

  return (
    <section data-cible="praticien" className="carte-douce space-y-4 px-5 py-6 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            aria-hidden
            className="hexagone h-[2.75rem] w-[2.375rem] shrink-0"
            style={{ backgroundColor: praticien.couleur }}
          />
          <div className="min-w-0">
            <h2 className="font-heading text-xl leading-tight font-bold [overflow-wrap:anywhere]">
              Dr {praticien.prenom} {praticien.nom}
            </h2>
            {praticien.titre ? <p className="mt-0.5 text-sm text-muted-foreground">{praticien.titre}</p> : null}
          </div>
        </div>
        <button
          type="button"
          aria-expanded={edition}
          onClick={() => setEdition((e) => !e)}
          className="h-10 rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8]"
        >
          {edition ? 'Terminer' : 'Modifier la semaine type'}
        </button>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {sites.map((site) => (
          <FauteuilFixe
            key={site.id}
            praticien={praticien}
            site={site}
            fauteuils={fauteuils.filter((f) => f.siteId === site.id)}
            fauteuilId={fauteuilsDuPraticien.find((f) => f.siteId === site.id)?.fauteuilId ?? ''}
          />
        ))}
      </div>

      {edition ? (
        <div className="space-y-2">
          {jours.map((jour) => (
            <JourSemaineType
              key={jour.valeur}
              praticienId={praticien.id}
              jour={jour}
              sites={sites}
              ligne={parJour.get(jour.valeur) ?? null}
            />
          ))}
        </div>
      ) : (
        // Au téléphone, le tableau défile dans sa carte au lieu d’élargir toute la page.
        <div className="overflow-x-auto">
          <table className="w-full text-[0.9375rem]">
            <thead>
              <tr className="border-b border-[#eef2f2] text-left text-xs tracking-[0.1em] text-muted-foreground uppercase">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Jour
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Cabinet
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Horaires
                </th>
              </tr>
            </thead>
            <tbody>
              {jours.map((jour) => {
                const l = parJour.get(jour.valeur)
                const site = l ? sites.find((x) => x.id === l.siteId) : undefined
                return (
                  <tr key={jour.valeur} className="border-b border-[#eef2f2]">
                    <th scope="row" className="px-4 py-3.5 text-left font-semibold">
                      {jour.libelle}
                    </th>
                    {l ? (
                      <>
                        <td className={cn('px-4 py-3.5', site?.code === 'GUADELOUPE' && 'text-[#5B3FB0]')}>
                          {site ? court(site.nom) : '—'}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums">
                          {l.pauseDebut && l.pauseFin
                            ? `${l.heureDebut} – ${l.pauseDebut} · ${l.pauseFin} – ${l.heureFin}`
                            : `${l.heureDebut} – ${l.heureFin}`}
                        </td>
                      </>
                    ) : (
                      <td colSpan={2} className="px-4 py-3.5 text-muted-foreground/70">
                        Pas de présence
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/**
 * Jours fériés à venir, pour CE praticien (Q29, Q30) : fermé par défaut
 * (`plagesVouluesAvecFeries`, src/server/domaine/presences.ts), ouvrable
 * jour par jour. Réutilise le mécanisme des exceptions plutôt qu'un type
 * dédié — « Ouvrir » pose une exception `AJOUT_OU_MODIFICATION` sur ce jour,
 * « Refermer » la retire, avec la même garde anti-orphelin (Q5) que toute
 * autre exception.
 */
function Feries({
  praticiens,
  sites,
  joursFeries,
  exceptions,
}: {
  praticiens: PraticienVue[]
  sites: SiteVue[]
  joursFeries: JourFerieVue[]
  exceptions: ExceptionVue[]
}) {
  const [ouvert, setOuvert] = useState(false)
  const prochain = joursFeries[0]

  return (
    <section className={CARTE}>
      <div className="flex items-baseline justify-between gap-4">
        <TitreAlveole id="titre-feries" icone={Star}>
          Jours fériés
        </TitreAlveole>
        {joursFeries.length > 0 ? (
          <button
            type="button"
            aria-expanded={ouvert}
            onClick={() => setOuvert((o) => !o)}
            className="text-sm font-semibold text-[#387a70] underline-offset-4 hover:underline"
          >
            {ouvert ? 'Masquer' : 'Voir →'}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[0.8125rem] text-muted-foreground">
        {prochain
          ? `Prochain : ${dateFerie.format(leJour(prochain.date))} (${prochain.libelle}). Fermé par défaut, ouvrable praticien par praticien.`
          : 'Aucun jour férié sur les deux prochains mois.'}
      </p>

      {ouvert ? (
        <ul className="mt-4 space-y-4">
          {joursFeries.map((f) => (
            <li key={f.date} className="space-y-2">
              <p className="text-sm font-semibold">
                {majuscule(dateFerie.format(leJour(f.date)))} — {f.libelle}
              </p>
              <ul className="space-y-2">
                {praticiens.map((p) => {
                  const ouverture =
                    exceptions.find(
                      (e) => e.praticienId === p.id && e.date === f.date && e.type === 'AJOUT_OU_MODIFICATION',
                    ) ?? null
                  // Deux composants distincts (chacun son `useActionState`) : les règles
                  // des hooks interdisent d'en appeler un sous condition. La clé force
                  // le démontage au basculement ouvert/fermé.
                  return ouverture ? (
                    <LigneFerieOuverte key={`${p.id}:ouvert`} praticien={p} ferie={f} ouverture={ouverture} />
                  ) : (
                    <LigneFerieFermee
                      key={`${p.id}:ferme`}
                      praticien={p}
                      ferie={f}
                      sites={sites}
                    />
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function LigneFerieOuverte({
  praticien,
  ferie,
  ouverture,
}: {
  praticien: PraticienVue
  ferie: JourFerieVue
  ouverture: ExceptionVue
}) {
  const [etat, action] = useActionState<EtatPresence, FormData>(supprimerExceptionAction, {})

  return (
    <li
      className="space-y-1 rounded-2xl border border-[#eef2f2] p-2.5 text-sm"
      aria-label={`${ferie.libelle}, Dr ${praticien.nom}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Dr {praticien.nom} — ouvert ({ouverture.siteNom ? court(ouverture.siteNom) : ''} · {ouverture.fauteuilNom} ·{' '}
          {ouverture.heureDebut}–{ouverture.heureFin})
        </span>
        <form action={action}>
          <input type="hidden" name="id" value={ouverture.id} />
          <Button type="submit" variant="outline" size="sm">
            Refermer
          </Button>
        </form>
      </div>
      <Message etat={etat} />
    </li>
  )
}

function LigneFerieFermee({
  praticien,
  ferie,
  sites,
}: {
  praticien: PraticienVue
  ferie: JourFerieVue
  sites: SiteVue[]
}) {
  const [etat, action] = useActionState<EtatPresence, FormData>(enregistrerExceptionAction, {})
  // Les champs n'apparaissent qu'à la demande : la plupart des fériés restent fermés.
  const [ouvrir, setOuvrir] = useState(Boolean(etat.erreur))

  return (
    <li key={etat.jeton ?? 'vierge'} className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground">Dr {praticien.nom} — fermé</span>
        <button
          type="button"
          aria-expanded={ouvrir}
          onClick={() => setOuvrir((o) => !o)}
          className="text-primary underline-offset-4 hover:underline"
        >
          {ouvrir ? 'Annuler' : 'Ouvrir ce jour'}
        </button>
      </div>
      {ouvrir ? (
        <form
          action={action}
          className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed border-[#d3e6e1] p-2.5"
        >
          <input type="hidden" name="praticienId" value={praticien.id} />
          <input type="hidden" name="date" value={ferie.date} />
          <input type="hidden" name="type" value="AJOUT_OU_MODIFICATION" />

          <select
            name="siteId"
            required
            defaultValue={etat.saisie?.siteId ?? ''}
            aria-label="Cabinet"
            className="champ rounded-full h-9 py-1.5 text-sm"
          >
            <option value="">Cabinet…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </select>

          <Input
            name="heureDebut"
            type="time"
            step={60}
            required
            aria-label="Début"
            defaultValue={etat.saisie?.heureDebut}
            className="w-28"
          />
          <Input
            name="heureFin"
            type="time"
            step={60}
            required
            aria-label="Fin"
            defaultValue={etat.saisie?.heureFin}
            className="w-28"
          />

          <Button type="submit" size="sm">
            Ouvrir ce jour
          </Button>
        </form>
      ) : null}
      <Message etat={etat} />
    </li>
  )
}

function JourSemaineType({
  praticienId,
  jour,
  sites,
  ligne,
}: {
  praticienId: string
  jour: { valeur: number; libelle: string }
  sites: SiteVue[]
  ligne: LigneSemaineTypeVue | null
}) {
  const [etat, action] = useActionState<EtatPresence, FormData>(enregistrerJourSemaineTypeAction, {})

  const actifInitial = etat.saisie ? etat.saisie.actif === 'on' : ligne !== null
  const [actif, setActif] = useState(actifInitial)
  const [siteId, setSiteId] = useState(etat.saisie?.siteId ?? ligne?.siteId ?? '')

  const cle = `${praticienId}-${jour.valeur}`
  const idActif = `actif-${cle}`
  const idSite = `site-${cle}`
  const idDebut = `debut-${cle}`
  const idFin = `fin-${cle}`

  return (
    <form
      // La ligne enregistrée entre dans la clé : après un succès, le serveur
      // renvoie la nouvelle semaine type, et des champs non contrôlés restés
      // montés verraient leur valeur par défaut changer sous eux.
      key={`${etat.jeton ?? 'vierge'}:${ligne ? `${ligne.siteId}:${ligne.fauteuilId}:${ligne.heureDebut}:${ligne.heureFin}:${ligne.pauseDebut}:${ligne.pauseFin}` : 'aucune'}`}
      action={action}
      className="grid items-end gap-3 rounded-2xl border border-[#eef2f2] p-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_5.75rem_5.75rem_auto]"
    >
      <input type="hidden" name="praticienId" value={praticienId} />
      <input type="hidden" name="jourSemaine" value={jour.valeur} />

      <div className="flex items-center gap-2 self-center">
        <input
          type="checkbox"
          id={idActif}
          name="actif"
          checked={actif}
          onChange={(e) => setActif(e.currentTarget.checked)}
          className="size-4 accent-[#387a70]"
        />
        <Label htmlFor={idActif} className="font-normal">
          {jour.libelle}
        </Label>
      </div>

      {actif ? (
        <>
          <div className="space-y-1">
            <Label htmlFor={idSite}>Cabinet</Label>
            <select
              id={idSite}
              name="siteId"
              required
              value={siteId}
              onChange={(e) => setSiteId(e.currentTarget.value)}
              className="champ rounded-full h-9 py-1.5 text-sm"
            >
              <option value="">Choisir…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {court(s.nom)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor={idDebut}>Début</Label>
            <Input
              id={idDebut}
              name="heureDebut"
              type="time"
              step={60}
              required
              defaultValue={etat.saisie?.heureDebut ?? ligne?.heureDebut}
              className="h-9 px-2 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor={idFin}>Fin</Label>
            <Input
              id={idFin}
              name="heureFin"
              type="time"
              step={60}
              required
              defaultValue={etat.saisie?.heureFin ?? ligne?.heureFin}
              className="h-9 px-2 text-sm"
            />
          </div>
        </>
      ) : (
        <p className="self-center text-sm text-muted-foreground sm:col-span-3">Pas de présence</p>
      )}

      <Button type="submit" size="sm" className="h-9">
        Enregistrer
      </Button>

      {actif ? (
        // Pause facultative (le midi) : la journée donne alors deux plages, et
        // rien ne peut être posé entre les deux.
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground sm:col-start-2 sm:col-span-4">
          <span>Pause (facultatif) de</span>
          <Input
            name="pauseDebut"
            type="time"
            step={60}
            aria-label={`Début de la pause du ${jour.libelle.toLowerCase()}`}
            defaultValue={etat.saisie?.pauseDebut ?? ligne?.pauseDebut ?? ''}
            className="h-9 w-[5.75rem] px-2 text-sm"
          />
          <span>à</span>
          <Input
            name="pauseFin"
            type="time"
            step={60}
            aria-label={`Fin de la pause du ${jour.libelle.toLowerCase()}`}
            defaultValue={etat.saisie?.pauseFin ?? ligne?.pauseFin ?? ''}
            className="h-9 w-[5.75rem] px-2 text-sm"
          />
        </div>
      ) : null}

      <div className="sm:col-span-5">
        <Message etat={etat} />
      </div>
    </form>
  )
}

function Exceptions({
  praticiens,
  exceptions,
  semaineType,
}: {
  praticiens: PraticienVue[]
  exceptions: ExceptionVue[]
  semaineType: LigneSemaineTypeVue[]
}) {
  return (
    <section className={CARTE}>
      <TitreAlveole id="titre-exceptions" icone={Sun}>
        Exceptions à venir
      </TitreAlveole>
      {exceptions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Aucune exception à venir.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {exceptions.map((e) => (
            <LigneException
              key={e.id}
              exception={e}
              praticien={praticiens.find((p) => p.id === e.praticienId)}
              // Ajouter un jour qui n'est pas dans la semaine type, c'est ouvrir ; le
              // changer, c'est une présence différente.
              ouverture={
                e.type === 'AJOUT_OU_MODIFICATION' &&
                !semaineType.some(
                  (l) => l.praticienId === e.praticienId && l.jourSemaine === (leJour(e.date).getUTCDay() || 7),
                )
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function LigneException({
  exception,
  praticien,
  ouverture,
}: {
  exception: ExceptionVue
  praticien: PraticienVue | undefined
  ouverture: boolean
}) {
  const [etat, action] = useActionState<EtatPresence, FormData>(supprimerExceptionAction, {})
  const qui = praticien ? `Dr ${praticien.nom}` : 'Praticien inconnu'
  const detail =
    exception.type === 'RETRAIT'
      ? [qui, exception.motif ?? 'Absent'].join(' · ')
      : [
          qui,
          exception.siteNom ? court(exception.siteNom) : null,
          exception.fauteuilNom,
          `${exception.heureDebut} – ${exception.heureFin}`,
        ]
          .filter(Boolean)
          .join(' · ')
  const [libelle, teinte] =
    exception.type === 'RETRAIT'
      ? ['Pas de présence', 'bg-etat-alerte-fond text-etat-alerte']
      : ouverture
        ? ['Ouverture exceptionnelle', 'bg-etat-succes-fond text-etat-succes']
        : ['Présence différente', 'bg-primary/10 text-primary']

  return (
    <li data-cible="exception" className="space-y-2 py-4 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{majuscule(dateCourte.format(leJour(exception.date)))}</p>
          <p className="text-[0.8125rem] text-muted-foreground">{detail}</p>
          {exception.type !== 'RETRAIT' && exception.motif ? (
            <p className="text-[0.8125rem] text-muted-foreground">{exception.motif}</p>
          ) : null}
          <span className={cn('mt-2 inline-block rounded-full px-2.5 py-0.5 text-[0.8125rem] font-medium', teinte)}>
            {libelle}
          </span>
        </div>
        <form action={action}>
          <input type="hidden" name="id" value={exception.id} />
          <button type="submit" className="text-sm text-etat-erreur underline-offset-4 hover:underline">
            Supprimer
          </button>
        </form>
      </div>
      <Message etat={etat} />
    </li>
  )
}

function NouvelleException({
  praticiens,
  sites,
  jourDuJour,
}: {
  praticiens: PraticienVue[]
  sites: SiteVue[]
  jourDuJour: string
}) {
  const [etat, action] = useActionState<EtatPresence, FormData>(enregistrerExceptionAction, {})

  const [type, setType] = useState<'RETRAIT' | 'AJOUT_OU_MODIFICATION'>(
    etat.saisie?.type === 'AJOUT_OU_MODIFICATION' ? 'AJOUT_OU_MODIFICATION' : 'RETRAIT',
  )

  return (
    <form key={etat.jeton ?? 'vierge'} action={action} className="carte-douce space-y-4 px-6 py-6 sm:px-7">
      <TitreAlveole id="titre-ajout-exception" icone={Plus}>
        Ajouter une exception
      </TitreAlveole>

      <div className="grid gap-4">
        <div className="space-y-1">
          <Label htmlFor="exception-praticien">Praticien</Label>
          <select
            id="exception-praticien"
            name="praticienId"
            required
            defaultValue={etat.saisie?.praticienId ?? ''}
            className="champ rounded-full"
          >
            <option value="">Choisir…</option>
            {praticiens.map((p) => (
              <option key={p.id} value={p.id}>
                Dr {p.prenom} {p.nom}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="exception-date">Date</Label>
          <Input
            id="exception-date"
            name="date"
            type="date"
            required
            min={jourDuJour}
            defaultValue={etat.saisie?.date}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="exception-type">Type</Label>
        <select
          id="exception-type"
          name="type"
          value={type}
          onChange={(e) => setType(e.currentTarget.value as 'RETRAIT' | 'AJOUT_OU_MODIFICATION')}
          className="champ rounded-full"
        >
          <option value="RETRAIT">Pas de présence ce jour-là</option>
          <option value="AJOUT_OU_MODIFICATION">Présence différente de la semaine type</option>
        </select>
      </div>

      {type === 'AJOUT_OU_MODIFICATION' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="exception-site">Cabinet</Label>
            <select
              id="exception-site"
              name="siteId"
              required
              defaultValue={etat.saisie?.siteId ?? ''}
              className="champ rounded-full"
            >
              <option value="">Choisir…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="exception-debut">Début</Label>
            <Input
              id="exception-debut"
              name="heureDebut"
              type="time"
              step={60}
              required
              defaultValue={etat.saisie?.heureDebut}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="exception-fin">Fin</Label>
            <Input
              id="exception-fin"
              name="heureFin"
              type="time"
              step={60}
              required
              defaultValue={etat.saisie?.heureFin}
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="exception-motif">Motif (facultatif)</Label>
        <Input id="exception-motif" name="motif" defaultValue={etat.saisie?.motif} maxLength={300} />
      </div>

      <Button type="submit" size="sm">
        Ajouter
      </Button>

      <Message etat={etat} />
    </form>
  )
}

/** Le fauteuil du praticien dans un cabinet : fixe, choisi une fois (Marving, 27/10). */
function FauteuilFixe({
  praticien,
  site,
  fauteuils,
  fauteuilId,
}: {
  praticien: PraticienVue
  site: SiteVue
  fauteuils: FauteuilVue[]
  fauteuilId: string
}) {
  const [etat, action] = useActionState<EtatPresence, FormData>(choisirFauteuilAction, {})
  const [choix, setChoix] = useState(fauteuilId)
  const id = `fauteuil-${praticien.id}-${site.id}`

  return (
    <form key={`${etat.jeton ?? 'vierge'}:${fauteuilId}`} action={action} className="space-y-1.5">
      <input type="hidden" name="praticienId" value={praticien.id} />
      <input type="hidden" name="siteId" value={site.id} />
      <Label htmlFor={id}>Fauteuil à {court(site.nom)}</Label>
      <div className="flex items-center gap-2">
        <select
          id={id}
          name="fauteuilId"
          value={choix}
          onChange={(e) => setChoix(e.currentTarget.value)}
          className="champ h-9 rounded-full py-1.5 text-sm"
        >
          {fauteuilId ? null : <option value="">Choisir…</option>}
          {fauteuils.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nom}
            </option>
          ))}
        </select>
        {choix !== fauteuilId && choix ? (
          <Button type="submit" size="sm" className="h-9">
            Enregistrer
          </Button>
        ) : null}
      </div>
      <Message etat={etat} />
    </form>
  )
}
