'use client'

import { CalendarDays, LockKeyhole, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef, useState, useTransition } from 'react'

import { TitreAlveole } from '@/components/features/patients/alveoles'
import { Message } from '@/components/ui/message'
import { FUSEAU_CABINET, heureCabinet, jourEnToutesLettres } from '@/lib/dates'
import { afficherTelephone } from '@/lib/telephone'
import { cn } from '@/lib/utils'
import {
  type ApercuVue,
  type EtatAgenda,
  type CreneauSuggere,
  apercuCreneauAction,
  prochainsCreneauxAction,
  creerPatientAction,
  creerRendezVousAction,
} from '@/server/actions/agenda'

// Formulaire de prise de rendez-vous, au comptoir ou au téléphone (maquettes
// du 13/10 : sections, fiches cliquables, récapitulatif en direct).
//
// Trois formulaires cohabitent sur la page — chercher un patient, en créer un,
// poser le rendez-vous — et HTML interdit de les imbriquer. Les deux premiers
// sont donc déclarés vides en tête, et leurs champs les rejoignent par
// l'attribut `form`. Le rendu visuel reste d'un seul tenant, et chacun garde sa
// propre soumission : la recherche passe par l'adresse de la page, ce qui la
// rend rejouable et utilisable sans JavaScript.

export type PatientVue = {
  id: string
  nom: string
  prenom: string
  dateNaissance: Date | null
  telephone: string
  profilComplet: boolean
  reservationBloquee: boolean
  derniereVisite: Date | null
}

export type PraticienVue = {
  id: string
  nom: string
  prenom: string
  titre: string | null
  motifs: { motifId: string; dureeMinutes: number }[]
}

export type MotifVue = {
  id: string
  libelle: string
  estUrgence: boolean
}

export type SiteVue = { id: string; nom: string }

const dateVisite = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  day: 'numeric',
  month: 'long',
})

const CHAMP = 'champ h-11 rounded-full'
const ETIQUETTE = 'mb-2 block text-sm font-medium'

export function FormulaireRendezVous({
  jour,
  aujourdHui,
  recherche,
  patients,
  praticiens,
  motifs,
  sites,
  monPraticienId,
  praticienParDefaut,
  siteParDefaut,
  heureParDefaut = null,
}: {
  jour: string
  aujourdHui: string
  recherche: string
  patients: PatientVue[]
  praticiens: PraticienVue[]
  motifs: MotifVue[]
  sites: SiteVue[]
  /** La fiche praticien du compte connecté, s'il en a une : urgence et hors-horaires ne valent que sur SON agenda. */
  monPraticienId: string | null
  praticienParDefaut: string | null
  siteParDefaut: string | null
  /** L'heure de la case cliquée dans l'agenda, s'il y en a une. */
  heureParDefaut?: string | null
}) {
  const [etat, action] = useActionState<EtatAgenda, FormData>(creerRendezVousAction, {})
  const [etatPatient, actionPatient] = useActionState<EtatAgenda, FormData>(creerPatientAction, {})

  // Repris d'un éventuel refus : le praticien choisi commande la liste des
  // motifs, la reperdre reviendrait à vider l'écran à chaque créneau occupé.
  const [praticienId, setPraticienId] = useState(etat.valeurs?.praticienId ?? praticienParDefaut ?? '')
  // Q19, Q23 (Marving, 21/10) : urgence et hors-horaires sur SON agenda seulement, jamais sur celui d'un confrère.
  const estPraticien = !!monPraticienId && praticienId === monPraticienId
  const [motifId, setMotifId] = useState(etat.valeurs?.motifId ?? '')
  const [patientChoisi, setPatientId] = useState(etat.valeurs?.patientId ?? '')
  // Une seule fiche trouvée est retenue d'office, y compris après une nouvelle
  // recherche faite pendant la frappe ; un choix fait à la main l'emporte tant
  // qu'il figure dans les résultats.
  const patientId =
    patientChoisi && patients.some((p) => p.id === patientChoisi)
      ? patientChoisi
      : patients.length === 1
        ? patients[0]!.id
        : patientChoisi
  const [creation, setCreation] = useState(patients.length === 0 && Boolean(recherche))
  // Une fiche retenue, la liste se replie sur elle (Marving, 28/10 : « la liste ne disparaît pas ») ; « Changer de
  // patient » ou une nouvelle frappe la rouvre.
  const [listeOuverte, setListeOuverte] = useState(false)
  const repliee = !listeOuverte && patients.some((p) => p.id === patientId)

  // La fiche que l'on vient de créer n'est dans aucun résultat de recherche :
  // elle se déduit du retour de l'action, sans état à tenir.
  const nouveau = etatPatient.id ? { id: etatPatient.id, libelle: etatPatient.libelle ?? 'nouvelle fiche' } : null

  const praticien = praticiens.find((p) => p.id === praticienId)
  // Chaque praticien a son périmètre d'actes (D14) : un motif qu'il ne pratique
  // pas n'est pas proposé — le service le refuserait de toute façon.
  const motifsDuPraticien = praticien ? motifs.filter((m) => praticien.motifs.some((l) => l.motifId === m.id)) : []
  const motif = motifs.find((m) => m.id === motifId)
  const duree = praticien?.motifs.find((l) => l.motifId === motifId)?.dureeMinutes

  // ── Récapitulatif en direct ──────────────────────────────────────────────
  const formulaire = useRef<HTMLFormElement>(null)
  const [apercu, setApercu] = useState<ApercuVue>({ etat: 'incomplet' })
  const [champs, setChamps] = useState({
    jour: etat.valeurs?.jour || jour,
    heure: etat.valeurs?.heure ?? heureParDefaut ?? '',
    siteId: '',
    surbooking: false,
  })
  const [, demarrer] = useTransition()
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null)

  function rafraichir() {
    const f = formulaire.current
    if (!f) return
    const d = new FormData(f)
    setChamps({
      jour: String(d.get('jour') ?? ''),
      heure: String(d.get('heure') ?? ''),
      siteId: String(d.get('siteId') ?? ''),
      surbooking: d.get('surbooking') === 'on',
    })
    if (minuterie.current) clearTimeout(minuterie.current)
    minuterie.current = setTimeout(() => demarrer(async () => setApercu(await apercuCreneauAction(d))), 300)
  }
  useEffect(() => {
    rafraichir()
    return () => {
      if (minuterie.current) clearTimeout(minuterie.current)
    }
    // Au montage et à chaque refus (nouveau jeton) : les champs viennent d'être reconstruits.
  }, [etat.jeton])

  const patientRetenu = nouveau
    ? nouveau.libelle
    : (() => {
        const p = patients.find((x) => x.id === patientId)
        return p ? `${p.prenom} ${p.nom}` : null
      })()
  const site = sites.find((s) => s.id === champs.siteId)

  // ── Recherche du patient pendant la frappe ───────────────────────────────
  // La même recherche que le bouton « Rechercher » (paramètre `q` de l'adresse,
  // lu côté serveur), lancée un quart de seconde après la dernière touche.
  const router = useRouter()

  // Enregistré : retour à l'agenda du jour, fiche du nouveau rendez-vous ouverte (tour du 20/10). Rester sur
  // un formulaire à moitié vidé laissait douter qu'un second clic ne crée pas un doublon.
  useEffect(() => {
    if (!etat.succes || !etat.id) return
    router.push(`/tableau-de-bord/agenda?vue=jour&date=${champs.jour}&rdv=${etat.id}&enregistre=1`)
    // Une fois par rendez-vous créé : `champs` n'a pas à relancer la navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat.id, etat.succes, router])

  const minuterieRecherche = useRef<ReturnType<typeof setTimeout> | null>(null)
  function rechercherEnTapant(valeur: string) {
    setListeOuverte(true)
    if (minuterieRecherche.current) clearTimeout(minuterieRecherche.current)
    minuterieRecherche.current = setTimeout(() => {
      const q = new URLSearchParams(window.location.search)
      const texte = valeur.trim()
      if (texte.length >= 2) q.set('q', texte)
      else q.delete('q')
      router.replace(`?${q.toString()}`, { scroll: false })
    }, 250)
  }

  // ── Prochains créneaux libres ────────────────────────────────────────────
  // Rangés avec la demande qui les a produits : une réponse arrivée après un
  // changement de praticien, d'acte, de cabinet ou de date n'est pas affichée.
  const demandeCreneaux =
    praticienId && motifId && champs.siteId && champs.jour
      ? { praticienId, motifId, siteId: champs.siteId, jour: champs.jour }
      : null
  const cleCreneaux = demandeCreneaux ? Object.values(demandeCreneaux).join('|') : null
  const [creneaux, setCreneaux] = useState<{ cle: string; liste: CreneauSuggere[] } | null>(null)
  useEffect(() => {
    if (!demandeCreneaux || !cleCreneaux) return
    let actif = true
    void prochainsCreneauxAction(demandeCreneaux).then((liste) => {
      if (actif) setCreneaux({ cle: cleCreneaux, liste })
    })
    return () => {
      actif = false
    }
    // `demandeCreneaux` est reconstruit à chaque rendu : la clé suffit à dire s'il a changé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleCreneaux])
  const suggestions = creneaux && creneaux.cle === cleCreneaux ? creneaux.liste : null

  function choisirCreneau(c: CreneauSuggere) {
    const f = formulaire.current
    if (!f) return
    ;(f.elements.namedItem('jour') as HTMLInputElement).value = c.jour
    ;(f.elements.namedItem('heure') as HTMLInputElement).value = c.heure
    rafraichir()
  }

  return (
    <>
      {/* Déclarés vides, hors de la grille : leurs champs les rejoignent par l'attribut `form`. */}
      <form id="recherche-patient" method="get" className="hidden" />
      <form id="creation-patient" action={actionPatient} className="hidden" />
      <div className="grid gap-10 xl:grid-cols-[minmax(0,47.5rem)_23.75rem] xl:gap-15">
        {/* La clé change à chaque refus, ce qui refait monter le formulaire :
          React remet les formulaires à zéro après une Server Action, et les
          champs pilotés se désynchroniseraient du DOM. */}
        <form
          key={etat.jeton ?? 'vierge'}
          ref={formulaire}
          id="rendez-vous"
          action={action}
          onChange={rafraichir}
          className="space-y-10"
        >
          {etat.erreur ? (
            <Message ton="erreur" role="alert">
              {etat.erreur}
            </Message>
          ) : null}
          {etat.succes ? (
            <Message ton="succes" role="status">
              {etat.succes} Retour à l’agenda…
            </Message>
          ) : null}

          <section className="carte-douce space-y-5 px-5 py-6 sm:px-7">
            <TitreAlveole id="titre-patient" icone={UserRound}>
              Patient
            </TitreAlveole>

            {/* Le jour voyage avec la recherche : sans lui, chercher un patient
              ramènerait à aujourd'hui et ferait perdre la date visée. */}
            <input type="hidden" name="jour" value={jour} form="recherche-patient" />
            <div>
              <label htmlFor="q" className={ETIQUETTE}>
                Rechercher par nom, prénom ou téléphone
              </label>
              <div className="flex gap-3">
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={recherche}
                  onChange={(e) => rechercherEnTapant(e.target.value)}
                  placeholder="Ex. Dupont, 0690…"
                  form="recherche-patient"
                  autoComplete="off"
                  className={cn(CHAMP, 'flex-1')}
                />
                <button
                  type="submit"
                  form="recherche-patient"
                  className="h-11 rounded-full border border-[#dde9e6] bg-white px-8 text-sm font-semibold hover:bg-[#f5f9f8]"
                >
                  Rechercher
                </button>
              </div>
            </div>

            {nouveau ? (
              <div className="flex items-center justify-between rounded-2xl border border-[#d3e6e1] bg-[#f2f8f6] px-5 py-4">
                <p className="font-semibold">{nouveau.libelle}</p>
                <p className="text-sm font-semibold text-[#387a70]">✓ Fiche créée et retenue</p>
                <input type="hidden" name="patientId" value={nouveau.id} />
              </div>
            ) : recherche && patients.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune fiche ne correspond. Créez-la ci-dessous.</p>
            ) : patients.length > 0 ? (
              <fieldset className="overflow-hidden rounded-2xl border border-[#e0ebe8]">
                <legend className="sr-only">Fiches trouvées</legend>
                {(repliee ? patients.filter((p) => p.id === patientId) : patients).map((p) => {
                  const retenu = p.id === patientId
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-4 border-b border-border px-5 py-3.5 last:border-b-0',
                        retenu ? 'bg-primary/10' : 'hover:bg-muted/50',
                      )}
                    >
                      <input
                        type="radio"
                        name="patientId"
                        value={p.id}
                        checked={retenu}
                        onChange={() => {
                          setPatientId(p.id)
                          setListeOuverte(false)
                        }}
                        required
                        className="sr-only"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {p.prenom} {p.nom}
                          {/* Le blocage ne vise que la réservation en ligne (Q27) :
                            au comptoir, le rendez-vous reste possible. */}
                          {p.reservationBloquee ? (
                            <span className="ml-3 rounded-sm bg-etat-erreur-fond px-2 py-0.5 text-xs font-medium text-etat-erreur">
                              réservation en ligne bloquée
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {afficherTelephone(p.telephone)}
                          {p.derniereVisite ? ` · dernière visite le ${dateVisite.format(p.derniereVisite)}` : ''}
                          {p.profilComplet ? '' : ' · fiche à compléter'}
                        </span>
                      </span>
                      {retenu ? <span className="text-sm font-semibold text-[#387a70]">✓ Fiche retenue</span> : null}
                    </label>
                  )
                })}
                {repliee && patients.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setListeOuverte(true)}
                    className="w-full px-5 py-3 text-left text-sm font-semibold text-[#387a70] hover:bg-muted/50"
                  >
                    Changer de patient ({patients.length} fiches trouvées)
                  </button>
                ) : null}
              </fieldset>
            ) : null}

            {/* Un rendez-vous peut se prendre pour quelqu'un qui n'est pas encore
              au fichier : nom et téléphone suffisent, le reste se complète à sa
              venue (Q33). */}
            {nouveau ? null : (
              <div>
                <button
                  type="button"
                  aria-expanded={creation}
                  onClick={() => setCreation((c) => !c)}
                  className="text-sm font-semibold text-[#387a70] underline-offset-4 hover:underline"
                >
                  + Le patient n’est pas au fichier
                </button>
                {creation ? (
                  <div className="mt-4 space-y-4 rounded-2xl bg-[#f5f9f8] p-5">
                    {etatPatient.erreur ? (
                      <Message ton="erreur" role="alert">
                        {etatPatient.erreur}
                      </Message>
                    ) : null}
                    <div className="grid gap-4 sm:grid-cols-3">
                      {[
                        ['nom-patient', 'nom', 'Nom'],
                        ['prenom-patient', 'prenom', 'Prénom'],
                        ['telephone-patient', 'telephone', 'Téléphone'],
                      ].map(([id, nom, libelle]) => (
                        <div key={id}>
                          <label htmlFor={id} className={ETIQUETTE}>
                            {libelle}
                          </label>
                          <input id={id} name={nom} form="creation-patient" autoComplete="off" className={CHAMP} />
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <button
                        type="submit"
                        form="creation-patient"
                        className="h-10 rounded-full border border-[#dde9e6] bg-white px-5 text-sm font-semibold hover:bg-[#f5f9f8]"
                      >
                        Créer la fiche
                      </button>
                      <p className="text-sm text-muted-foreground">
                        La date de naissance se complétera à sa venue : c’est elle qui distingue deux homonymes.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="carte-douce space-y-5 px-5 py-6 sm:px-7">
            <TitreAlveole id="titre-rendez-vous" icone={CalendarDays}>
              Rendez-vous
            </TitreAlveole>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="praticienId" className={ETIQUETTE}>
                  Praticien
                </label>
                <select
                  id="praticienId"
                  name="praticienId"
                  required
                  value={praticienId}
                  onChange={(e) => {
                    setPraticienId(e.currentTarget.value)
                    // Le motif retenu n'est peut-être pas pratiqué par le suivant.
                    setMotifId('')
                  }}
                  className={CHAMP}
                >
                  <option value="">Choisir…</option>
                  {praticiens.map((p) => (
                    <option key={p.id} value={p.id}>
                      Dr {p.prenom} {p.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="motifId" className={ETIQUETTE}>
                  Motif
                </label>
                <select
                  id="motifId"
                  name="motifId"
                  required
                  value={motifId}
                  onChange={(e) => setMotifId(e.currentTarget.value)}
                  disabled={!praticien}
                  className={CHAMP}
                >
                  <option value="">{praticien ? 'Choisir…' : 'Choisir d’abord un praticien'}</option>
                  {motifsDuPraticien.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.libelle}
                    </option>
                  ))}
                </select>
                {praticien && motifsDuPraticien.length === 0 ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Aucun acte n’est encore associé à ce praticien.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr]">
              <div>
                <label htmlFor="siteId" className={ETIQUETTE}>
                  Cabinet
                </label>
                <select
                  id="siteId"
                  name="siteId"
                  required
                  defaultValue={etat.valeurs?.siteId || siteParDefaut || (sites.length === 1 ? sites[0]!.id : '')}
                  className={CHAMP}
                >
                  {sites.length === 1 ? null : <option value="">Choisir…</option>}
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom.replace(/^Cabinet (de |d’|d')/, '')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="jour-rdv" className={ETIQUETTE}>
                  Date
                </label>
                <input
                  id="jour-rdv"
                  name="jour"
                  type="date"
                  required
                  defaultValue={etat.valeurs?.jour || jour}
                  className={CHAMP}
                />
              </div>
              <div>
                <label htmlFor="heure" className={ETIQUETTE}>
                  Heure
                </label>
                {/* `step` est en SECONDES : 60 laisse saisir n'importe quelle
                  minute. Un pas au quart d'heure ferait rejeter 09h20 par le
                  navigateur, sans message — or le cabinet rattrape ses avances
                  et ses retards à la minute (Q22). */}
                <input
                  id="heure"
                  name="heure"
                  type="time"
                  step={60}
                  required
                  defaultValue={etat.valeurs?.heure ?? heureParDefaut ?? undefined}
                  className={CHAMP}
                />
              </div>
            </div>

            {suggestions ? (
              <div>
                <p className={ETIQUETTE}>Prochains créneaux libres</p>
                {suggestions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun créneau libre sur deux semaines pour ce praticien et cet acte, dans ce cabinet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((c) => {
                      const retenu = champs.jour === c.jour && champs.heure === c.heure
                      return (
                        <button
                          key={`${c.jour} ${c.heure}`}
                          type="button"
                          aria-pressed={retenu}
                          onClick={() => choisirCreneau(c)}
                          className={cn(
                            'chiffres h-9 rounded-full border px-3.5 text-sm transition-colors',
                            retenu ? 'choix-actif' : 'border-[#dde9e6] bg-white text-[#387a70] hover:border-[#387a70]',
                          )}
                        >
                          {c.libelle}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="dureeMinutes" className={ETIQUETTE}>
                  Durée différente (facultatif)
                </label>
                <input
                  id="dureeMinutes"
                  name="dureeMinutes"
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  defaultValue={etat.valeurs?.dureeMinutes}
                  placeholder={duree ? `${duree} min (durée du motif)` : 'Durée du motif'}
                  aria-describedby="aide-duree"
                  className={CHAMP}
                />
                <p id="aide-duree" className="mt-1.5 text-[0.8125rem] text-muted-foreground">
                  À ne renseigner que pour s’écarter de la durée prévue sur ce rendez-vous précis.
                </p>
              </div>
              <div>
                <label htmlFor="note" className={ETIQUETTE}>
                  Note
                </label>
                <textarea
                  id="note"
                  name="note"
                  rows={3}
                  maxLength={1000}
                  defaultValue={etat.valeurs?.note}
                  className="champ h-auto rounded-[1.25rem] px-4 py-2.5"
                />
              </div>
            </div>
          </section>

          {/* Deux gestes que le cabinet a réservés au praticien (Q19, Q23). Le
            service les refuse à qui n'est pas praticien : les cacher n'est pas
            la protection, c'est la lisibilité. */}
          {/* Pour la secrétaire, l'encadré n'apparaît que si le créneau est vraiment plein (tour du 20/10). */}
          {estPraticien || (apercu.etat === 'refuse' && apercu.planningPlein) ? (
            <section className="carte-douce space-y-5 px-5 py-6 sm:px-7">
              <TitreAlveole id="titre-exceptions" icone={LockKeyhole}>
                Exceptions réservées au praticien
              </TitreAlveole>
              {estPraticien ? (
                <div className="space-y-3">
                  <label className="flex items-center gap-3">
                    <input type="checkbox" name="surbooking" className="size-[1.125rem] accent-[#387a70]" />
                    Urgence ajoutée sur un planning complet
                  </label>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" name="horsHoraire" className="size-[1.125rem] accent-[#387a70]" />
                    Hors des horaires d’ouverture
                  </label>
                </div>
              ) : (
                <div className="rounded-2xl border-l-4 border-muted-foreground/50 bg-[#f5f9f8] px-5 py-4">
                  <p className="font-medium">Planning complet : seul le praticien de cet agenda peut ajouter une urgence.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Demandez-lui de l’enregistrer depuis sa session. Idem pour un rendez-vous hors des horaires
                    d’ouverture.
                  </p>
                </div>
              )}
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="h-11 bouton-principal px-5 text-sm font-semibold">
              Enregistrer le rendez-vous
            </button>
            <Link
              href={`/tableau-de-bord/agenda?date=${jour}`}
              className="flex h-11 items-center rounded-full border border-[#dde9e6] bg-white px-5 text-sm font-semibold hover:bg-[#f5f9f8]"
            >
              Annuler
            </Link>
          </div>
        </form>

        <Recapitulatif
          jour={champs.jour}
          heure={champs.heure}
          aujourdHui={aujourdHui}
          apercu={apercu}
          patient={patientRetenu}
          motif={motif?.libelle ?? null}
          praticien={praticien ? `Dr ${praticien.prenom} ${praticien.nom}` : null}
          site={site?.nom ?? null}
          estPraticien={estPraticien}
          surbooking={champs.surbooking}
        />
      </div>
    </>
  )
}

function Recapitulatif({
  jour,
  heure,
  aujourdHui,
  apercu,
  patient,
  motif,
  praticien,
  site,
  estPraticien,
  surbooking,
}: {
  jour: string
  heure: string
  aujourdHui: string
  apercu: ApercuVue
  patient: string | null
  motif: string | null
  praticien: string | null
  site: string | null
  estPraticien: boolean
  surbooking: boolean
}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(jour) ? jourEnToutesLettres(jour).replace(/ \d{4}$/, '') : null
  const plage =
    apercu.etat === 'libre'
      ? `${heureCabinet(new Date(apercu.debut))} – ${heureCabinet(new Date(apercu.fin))} · ${apercu.duree} min`
      : heure
        ? `${heure}${apercu.etat === 'refuse' && apercu.duree ? ` · ${apercu.duree} min` : ''}`
        : null

  return (
    <aside
      aria-label="Récapitulatif"
      aria-live="polite"
      className="carte-douce self-start overflow-hidden xl:sticky xl:top-8"
    >
      <div className="fond-v2-uni px-7 py-6">
        <p className="text-xs font-bold tracking-[0.12em] text-encre/80 uppercase">Récapitulatif</p>
        <p className="mt-2 font-heading text-[1.75rem] leading-tight font-extrabold first-letter:uppercase">
          {date ?? 'Date à choisir'}
        </p>
        <p className="mt-1 font-medium text-encre/85">
          {plage ?? 'Heure à choisir'}
          {jour === aujourdHui && plage ? ' · aujourd’hui' : ''}
        </p>
      </div>

      <div className="px-7 pt-6 pb-7">
        <div className="space-y-1 rounded-2xl border-l-4 border-primary bg-[#eef5fc] px-4 py-3.5 text-sm">
          <p className="text-[0.9375rem] font-semibold">{patient ?? 'Patient à choisir'}</p>
          <p className="text-muted-foreground">{motif ?? 'Motif à choisir'}</p>
          <p className="pt-3 text-primary">{praticien ?? 'Praticien à choisir'}</p>
          <p className="text-muted-foreground">
            {site ?? 'Cabinet à choisir'}
            {apercu.etat === 'libre' ? ` · ${apercu.fauteuil.toLowerCase()}` : ''}
          </p>
        </div>

        <div className="mt-5 text-sm">
          {apercu.etat === 'incomplet' ? (
            <p className="text-muted-foreground">
              Le créneau sera vérifié dès que praticien, motif, cabinet, date et heure seront choisis.
            </p>
          ) : apercu.etat === 'libre' && surbooking ? (
            <>
              <p className="font-medium text-etat-alerte">Planning complet : urgence ajoutée par-dessus.</p>
              <p className="mt-2 text-muted-foreground">Exception réservée au praticien, tracée au journal.</p>
            </>
          ) : apercu.etat === 'libre' ? (
            <>
              <p className="font-medium text-etat-succes">Créneau libre — aucun conflit.</p>
              <p className="mt-2 text-muted-foreground">
                Le patient recevra un SMS de confirmation, puis un rappel 2 jours avant.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-etat-alerte">
                {apercu.planningPlein && !estPraticien
                  ? 'Planning complet : seul le praticien de cet agenda peut ajouter une urgence.'
                  : apercu.raison}
              </p>
              {apercu.planningPlein && estPraticien ? (
                <p className="mt-2 text-muted-foreground">
                  Pour l’ajouter quand même, cochez « Urgence ajoutée sur un planning complet ».
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
