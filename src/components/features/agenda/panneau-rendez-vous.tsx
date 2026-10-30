'use client'

import type { NiveauUrgence, StatutRendezVous } from '@prisma/client'
import { Check, Copy, Pencil, Phone, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Message } from '@/components/ui/message'
import { decalerJour } from '@/lib/dates'
import { euros, eurosSaisie } from '@/lib/euros'
import { NIVEAU_URGENCE } from '@/lib/niveaux-urgence'
import { LIBELLE_STATUT, PARCOURS, TEINTE_STATUT } from '@/lib/statuts'
import { cn } from '@/lib/utils'
import {
  type EtatAgenda,
  type FicheRendezVousVue,
  type JourDeCreneaux,
  changerStatutAction,
  corrigerMontantAction,
  corrigerNiveauUrgenceAction,
  creneauxPourDeplacerAction,
  deplacerRendezVousAction,
  lireFicheRendezVousAction,
  modifierRendezVousAction,
  refuserAnnulationAction,
  validerAnnulationAction,
} from '@/server/actions/agenda'

// Fiche d'un rendez-vous (maquette validée par Marving le 19/10) : un clic sur
// sa carte, en vue jour, semaine ou mois, ouvre ce panneau à droite. Tout ce
// qu'on fait d'un rendez-vous se fait ici — faire avancer le patient dans son
// parcours, le déplacer, le dupliquer, l'annuler ou trancher une demande.
//
// La fiche est lue à l'ouverture, côté serveur (droits, portée D5, journal D9),
// et non transportée avec chaque carte : l'agenda n'envoie au navigateur que ce
// qu'il affiche. Les gestes passent par les Server Actions existantes — le
// panneau n'invente aucune règle, il ne montre que les gestes autorisés.

/** Les étapes de la frise (Q24). Absent et annulé sont des sorties, pas des étapes. */
const ETAPES: StatutRendezVous[] = ['CONFIRME', 'SALLE_ATTENTE', 'AU_FAUTEUIL', 'TERMINE', 'EN_CAISSE']

const LIBELLE_ETAPE: Partial<Record<StatutRendezVous, string>> = {
  CONFIRME: 'Confirmé',
  SALLE_ATTENTE: 'Arrivé',
  AU_FAUTEUIL: 'Au fauteuil',
  TERMINE: 'Terminé',
  EN_CAISSE: 'En caisse',
}

/** Le geste suivant, en un clic — le libellé dit ce qui se passe, pas le nom du statut. */
const ETAPE_SUIVANTE: Partial<Record<StatutRendezVous, { statut: StatutRendezVous; libelle: string }>> = {
  A_CONFIRMER: { statut: 'CONFIRME', libelle: 'Confirmer le rendez-vous' },
  CONFIRME: { statut: 'SALLE_ATTENTE', libelle: 'Le patient est arrivé' },
  SALLE_ATTENTE: { statut: 'AU_FAUTEUIL', libelle: 'Installer au fauteuil' },
  AU_FAUTEUIL: { statut: 'TERMINE', libelle: 'Soin terminé' },
  TERMINE: { statut: 'EN_CAISSE', libelle: 'Passé en caisse' },
}

const PEUT_ETRE_ABSENT: StatutRendezVous[] = ['A_CONFIRMER', 'CONFIRME', 'SALLE_ATTENTE']

type Contexte = {
  ouvrir: (id: string) => void
  selection: string | null
  /** Statuts que la fiche connaît déjà et que l'agenda, rechargé, n'affiche pas encore. */
  provisoires: Record<string, StatutRendezVous>
}

const ContexteFiche = createContext<Contexte>({ ouvrir: () => {}, selection: null, provisoires: {} })

/** Pour les cartes de l'agenda : ouvrir la fiche, et savoir laquelle est ouverte. */
export function useFicheRendezVous() {
  return useContext(ContexteFiche)
}

/**
 * Les rendez-vous d'une vue, avec le statut que la fiche vient d'appliquer (tour
 * du 20/10) : sans lui, la carte restait « À confirmer » deux à trois secondes
 * sous une fiche qui disait déjà « Annulation demandée ».
 */
export function useStatutsAJour<T extends { id: string; statut: StatutRendezVous }>(liste: T[]): T[] {
  const { provisoires } = useContext(ContexteFiche)
  return useMemo(
    () =>
      liste.map((r) =>
        provisoires[r.id] && provisoires[r.id] !== r.statut ? { ...r, statut: provisoires[r.id]! } : r,
      ),
    [liste, provisoires],
  )
}

/**
 * Les attributs qu'une carte reçoit pour s'ouvrir au clavier (Entrée, Espace).
 * Le clic, lui, est posé par chaque vue : c'est elle qui écarte le clic qui suit
 * la fin d'un glisser-déposer, pour ne pas ouvrir la fiche par-dessus le
 * déplacement. Une grille qui prend d'abord certaines touches (le déplacement au
 * clavier) pose son propre `onKeyDown` et finit par `ouvrirAuClavier`.
 */
export function attributsCarte(
  id: string,
  ouvrir: (id: string) => void,
): React.HTMLAttributes<HTMLElement> & { 'data-rdv': string } {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-haspopup': 'dialog',
    // La fiche refermée rend le focus à sa carte (`rendreFocus`).
    'data-rdv': id,
    onKeyDown: (e) => ouvrirAuClavier(e, id, ouvrir),
  }
}

export function ouvrirAuClavier(e: React.KeyboardEvent<HTMLElement>, id: string, ouvrir: (id: string) => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    e.stopPropagation()
    ouvrir(id)
  }
}

/** Remet le focus sur la carte d'un rendez-vous, une fois l'écran redessiné (fiche refermée, carte déplacée). */
export function rendreFocus(id: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-rdv="${CSS.escape(id)}"]`)?.focus())
}

/**
 * Enveloppe l'agenda. `signature` change quand les rendez-vous affichés
 * changent (geste, agenda en direct D61) : la fiche ouverte se relit alors,
 * pour ne jamais montrer un statut dépassé.
 */
export function FicheRendezVousProvider({
  children,
  signature,
  initiale = null,
  annonce = null,
}: {
  children: React.ReactNode
  signature: string
  /** Rendez-vous à ouvrir d'emblée (`?rdv=` dans l'adresse, depuis la fiche d'un patient). */
  initiale?: string | null
  /** Message affiché à l'ouverture de `initiale` : « Rendez-vous enregistré » au retour du formulaire. */
  annonce?: string | null
}) {
  const [selection, setSelection] = useState<string | null>(initiale)
  // Un second clic sur le rendez-vous dont la fiche est ouverte la referme (24/10) ; un clic sur un autre la remplace.
  const ouvrir = useCallback((id: string) => setSelection((s) => (s === id ? null : id)), [])
  const fermer = useCallback(() => {
    setSelection(null)
    if (selection) rendreFocus(selection)
  }, [selection])
  // Valables jusqu'au rechargement de l'agenda : la `signature` change, la vérité du serveur reprend la main.
  const [provisoires, setProvisoires] = useState<{ signature: string; statuts: Record<string, StatutRendezVous> }>({
    signature,
    statuts: {},
  })
  const statuts = provisoires.signature === signature ? provisoires.statuts : {}
  const noterStatut = useCallback(
    (id: string, statut: StatutRendezVous) =>
      setProvisoires((p) => ({
        signature,
        statuts: { ...(p.signature === signature ? p.statuts : {}), [id]: statut },
      })),
    [signature],
  )

  return (
    <ContexteFiche.Provider value={{ ouvrir, selection, provisoires: statuts }}>
      {children}
      {selection ? (
        <PanneauRendezVous
          key={selection}
          id={selection}
          signature={signature}
          onFermer={fermer}
          onStatut={noterStatut}
          annonce={selection === initiale ? annonce : null}
        />
      ) : null}
    </ContexteFiche.Provider>
  )
}

const libelle = 'text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase'

/** Ce que le patient a dit à l'assistant des urgences (D77), son niveau, et la correction du cabinet. */
function SectionAssistant({
  assistant,
  corrigeable,
  corriger,
}: {
  assistant: NonNullable<FicheRendezVousVue['assistant']>
  corrigeable: boolean
  corriger: (niveau: NiveauUrgence) => void
}) {
  return (
    <section aria-label="Demande à l’assistant" className="space-y-4">
      <div className="rounded-2xl border border-[#e3ecea] bg-[#f7f6f2] px-4 py-3.5">
        <p className="flex items-center gap-2 text-[0.8125rem] font-bold">
          <span aria-hidden className="hexagone grid size-[22px] place-items-center bg-[#387a70] text-[9px] text-white">
            IA
          </span>
          Demande à l’assistant · {assistant.le}
        </p>
        {assistant.resume.length ? (
          <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[0.875rem]">
            {assistant.resume.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}
        {assistant.raison ? (
          <p className="mt-2.5 text-[0.8125rem]">
            <span className="font-semibold">Pourquoi ce créneau :</span> {assistant.raison}
          </p>
        ) : null}
        <details className="mt-2.5 text-[0.8125rem]">
          <summary className="cursor-pointer font-semibold text-[#387a70]">Lire la conversation</summary>
          <ol className="mt-2 space-y-1.5">
            {assistant.messages.map((m, i) => (
              <li key={i}>
                <span className="font-semibold">{m.role === 'patient' ? 'Patient' : 'Assistant'} :</span> {m.texte}
              </li>
            ))}
          </ol>
        </details>
      </div>
      <div>
        <p className={libelle}>Niveau d’urgence</p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Niveau d’urgence">
          {(Object.keys(NIVEAU_URGENCE) as NiveauUrgence[]).map((n) => {
            const actif = assistant.niveau === n
            return (
              <button
                key={n}
                type="button"
                aria-pressed={actif}
                disabled={!corrigeable || actif}
                onClick={() => corriger(n)}
                className={cn(
                  'rounded-full border-[1.5px] px-3 py-1 text-xs font-bold disabled:cursor-default',
                  actif ? 'text-white' : 'border-border text-muted-foreground hover:border-foreground/40',
                )}
                style={actif ? { background: NIVEAU_URGENCE[n].couleur, borderColor: NIVEAU_URGENCE[n].couleur } : undefined}
              >
                {NIVEAU_URGENCE[n].libelle}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {assistant.niveauAssistant && assistant.niveau !== assistant.niveauAssistant
            ? `Corrigé par le cabinet — l’assistant avait dit « ${NIVEAU_URGENCE[assistant.niveauAssistant].libelle} ».`
            : 'Donné par l’assistant. Corrigé par le cabinet, il sert aussi à mesurer sa justesse.'}
        </p>
      </div>
    </section>
  )
}

function PanneauRendezVous({
  id,
  signature,
  onFermer,
  onStatut,
  annonce,
}: {
  id: string
  signature: string
  onFermer: () => void
  onStatut: (id: string, statut: StatutRendezVous) => void
  annonce: string | null
}) {
  const router = useRouter()
  const [fiche, setFiche] = useState<FicheRendezVousVue | null>(null)
  const [erreurLecture, setErreurLecture] = useState<string | null>(null)
  const [resultat, setResultat] = useState<EtatAgenda>(annonce ? { succes: annonce } : {})
  const [enCours, demarrer] = useTransition()
  const [version, setVersion] = useState(0)
  // Les gestes qui ne se rattrapent pas d'un clic passent par une confirmation (tour du 20/10 : la boîte
  // grise du navigateur détonnait, et « absent » était collé sous le bouton principal).
  const [confirmation, setConfirmation] = useState<{
    titre: string
    texte: string
    bouton: string
    agir: () => void
  } | null>(null)
  const titre = useRef<HTMLHeadingElement>(null)
  const [edition, setEdition] = useState(false)

  // Lecture à l'ouverture, après chaque geste (`version`) et à chaque changement
  // de l'agenda affiché (`signature`). Une réponse arrivée après une lecture
  // plus récente est ignorée.
  useEffect(() => {
    let actif = true
    void lireFicheRendezVousAction(id).then((r) => {
      if (!actif) return
      if (r.fiche) {
        setFiche(r.fiche)
        onStatut(r.fiche.id, r.fiche.statut)
        setErreurLecture(null)
      } else {
        setErreurLecture(r.erreur ?? 'Rendez-vous introuvable.')
      }
    })
    return () => {
      actif = false
    }
  }, [id, signature, version, onStatut])

  useEffect(() => {
    titre.current?.focus()
    const surTouche = (e: KeyboardEvent) => {
      // Déjà prise : Échap annulait un déplacement au clavier, la fiche reste ouverte.
      if (e.key === 'Escape' && !e.defaultPrevented) onFermer()
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [onFermer])

  function envoyer(action: (p: EtatAgenda, d: FormData) => Promise<EtatAgenda>, champs: Record<string, string>) {
    const donnees = new FormData()
    for (const [k, v] of Object.entries(champs)) donnees.set(k, v)
    demarrer(async () => {
      const r = await action({}, donnees)
      setResultat(r)
      if (!r.erreur) {
        router.refresh()
        setVersion((v) => v + 1)
      }
    })
  }

  function modifier(champs: Record<string, string>) {
    const donnees = new FormData()
    for (const [k, v] of Object.entries(champs)) donnees.set(k, v)
    demarrer(async () => {
      const r = await modifierRendezVousAction({}, donnees)
      setResultat(r)
      if (!r.erreur) {
        setEdition(false)
        router.refresh()
        setVersion((v) => v + 1)
      }
    })
  }

  const statut = fiche?.statut
  const suivante = statut ? ETAPE_SUIVANTE[statut] : undefined
  const rang = statut ? ETAPES.indexOf(statut === 'A_CONFIRMER' ? 'CONFIRME' : statut) : -1
  const termine = statut === 'ANNULE' || statut === 'ABSENT'
  const enAttente = statut === 'ANNULATION_DEMANDEE'
  // Un rendez-vous honoré, manqué ou annulé ne se modifie plus (27/10) : il se duplique.
  const modifiable =
    fiche?.modification != null && !termine && !enAttente && statut !== 'TERMINE' && statut !== 'EN_CAISSE'

  return (
    <aside
      aria-label={fiche ? `Rendez-vous de ${fiche.patient.prenomNom}` : 'Rendez-vous'}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[27rem] flex-col border-l border-border bg-background shadow-2xl"
    >
      <header className="flex items-start gap-4 border-b border-border px-7 pt-6 pb-5">
        <div className="min-w-0 flex-1">
          <p className={libelle}>Rendez-vous</p>
          <h2
            ref={titre}
            tabIndex={-1}
            className="mt-2 font-heading text-[1.5rem] leading-tight font-semibold outline-none"
          >
            {fiche?.jourLong ?? '…'}
          </h2>
          {fiche ? (
            <p className="mt-1 flex flex-wrap items-center gap-3 text-[0.9375rem]">
              <span className="chiffres">
                {fiche.heureDebut} – {fiche.heureFin}
              </span>
              <span
                className={cn('rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold', TEINTE_STATUT[fiche.statut])}
              >
                {LIBELLE_STATUT[fiche.statut]}
              </span>
              {fiche.urgence ? <span className="text-[0.8125rem] font-medium text-etat-alerte">Urgence</span> : null}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onFermer}
          className="-mr-2 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X aria-hidden className="size-5" />
          <span className="sr-only">Fermer</span>
        </button>
      </header>

      <div className="flex-1 space-y-8 overflow-y-auto px-7 py-6">
        {erreurLecture ? (
          <Message ton="erreur" role="alert">
            {erreurLecture}
          </Message>
        ) : !fiche ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <>
            <section aria-label="Patient">
              <p className="font-heading text-xl font-bold">{fiche.patient.prenomNom}</p>
              {fiche.patient.age ? <p className="mt-0.5 text-sm text-muted-foreground">{fiche.patient.age}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.9375rem]">
                <a
                  href={`tel:${fiche.patient.telephone.replace(/\s/g, '')}`}
                  className="inline-flex items-center gap-2 font-medium text-[#387a70] hover:underline"
                >
                  <Phone aria-hidden className="size-4" />
                  <span className="chiffres">{fiche.patient.telephone}</span>
                </a>
                <span
                  className={cn(
                    'text-sm',
                    fiche.patient.manquements > 0 ? 'text-etat-alerte' : 'text-muted-foreground',
                  )}
                >
                  {fiche.patient.manquements === 0
                    ? 'Aucune absence'
                    : `${fiche.patient.manquements} absence${fiche.patient.manquements > 1 ? 's' : ''} ou annulation${fiche.patient.manquements > 1 ? 's' : ''}`}
                </span>
              </div>
              <Link
                href={`/tableau-de-bord/patients/${fiche.patient.id}`}
                className="lien-action mt-3 inline-flex text-sm font-semibold text-[#387a70]"
              >
                Fiche du patient
              </Link>
            </section>

            {fiche.assistant ? (
              <SectionAssistant
                assistant={fiche.assistant}
                corrigeable={fiche.droits.modifie}
                corriger={(niveau) => {
                  demarrer(async () => {
                    const r = await corrigerNiveauUrgenceAction(fiche.id, niveau)
                    setResultat(r)
                    if (!r.erreur) {
                      router.refresh()
                      setVersion((v) => v + 1)
                    }
                  })
                }}
              />
            ) : null}

            {enAttente && fiche.demande ? (
              <section
                aria-label="Demande d’annulation"
                className="space-y-4 rounded-2xl bg-etat-erreur-fond px-5 py-4"
              >
                <p className="text-[0.9375rem] text-etat-erreur">
                  Annulation demandée par {fiche.demande.par}, {fiche.demande.le}. Le créneau reste réservé jusqu’à la
                  décision du praticien.
                </p>
                {fiche.droits.tranche ? (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={enCours}
                      onClick={() => envoyer(validerAnnulationAction, { id: fiche.id })}
                      className="h-10 rounded-full bg-etat-erreur px-4 text-sm font-semibold text-white hover:bg-etat-erreur/90 disabled:opacity-60"
                    >
                      Valider l’annulation
                    </button>
                    <button
                      type="button"
                      disabled={enCours}
                      onClick={() => envoyer(refuserAnnulationAction, { id: fiche.id })}
                      className="h-10 rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8] disabled:opacity-60"
                    >
                      Refuser, garder le rendez-vous
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {!enAttente ? (
              <section aria-label="Parcours du patient">
                <p className={libelle}>Parcours</p>
                {termine ? (
                  <p className="mt-3 text-[0.9375rem] text-muted-foreground">
                    {statut === 'ABSENT' ? 'Le patient ne s’est pas présenté.' : 'Ce rendez-vous est annulé.'}
                  </p>
                ) : (
                  <ol className="mt-4 flex items-start">
                    {ETAPES.map((etape, i) => {
                      const fait = rang >= 0 && i < rang
                      const courant = i === rang && statut !== 'A_CONFIRMER'
                      return (
                        <li key={etape} className="relative flex flex-1 flex-col items-center text-center">
                          {i > 0 ? (
                            <span
                              aria-hidden
                              className={cn(
                                'absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2',
                                fait || courant ? 'bg-[#387a70]' : 'bg-border',
                              )}
                            />
                          ) : null}
                          <span
                            aria-current={courant ? 'step' : undefined}
                            className={cn(
                              'relative grid size-7 place-items-center rounded-full border-2 text-xs font-bold',
                              fait && 'choix-actif',
                              courant && 'border-[#387a70] bg-background text-[#387a70] ring-4 ring-[#387a70]/15',
                              !fait && !courant && 'border-border bg-background text-muted-foreground',
                            )}
                          >
                            {fait ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : i + 1}
                          </span>
                          <span
                            className={cn(
                              'mt-2 text-[0.75rem] leading-tight',
                              courant ? 'font-semibold' : 'text-muted-foreground',
                            )}
                          >
                            {LIBELLE_ETAPE[etape]}
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                )}
                {statut === 'TERMINE' && fiche.droits.modifie ? (
                  <PassageEnCaisse
                    prixCentimes={fiche.caisse.prixCentimes}
                    enCours={enCours}
                    onValider={(montant) =>
                      envoyer(changerStatutAction, {
                        id: fiche.id,
                        statut: 'EN_CAISSE',
                        ...(montant === null ? {} : { montant }),
                      })
                    }
                  />
                ) : suivante && fiche.droits.modifie ? (
                  <button
                    type="button"
                    disabled={enCours}
                    onClick={() => envoyer(changerStatutAction, { id: fiche.id, statut: suivante.statut })}
                    className="lien-action mt-6 h-12 w-full justify-center bouton-principal text-[0.9375rem] disabled:opacity-60"
                  >
                    {suivante.libelle}
                  </button>
                ) : null}
                {fiche.droits.modifie ? (
                  <AutresActions
                    key={fiche.statut}
                    statut={fiche.statut}
                    enCours={enCours}
                    onChoisir={(s) => envoyer(changerStatutAction, { id: fiche.id, statut: s })}
                    onAbsent={
                      statut && PEUT_ETRE_ABSENT.includes(statut)
                        ? () =>
                            setConfirmation({
                              titre: 'Le patient ne s’est pas présenté ?',
                              texte: `${fiche.patient.prenomNom} sera noté absent. L’absence compte pour le blocage de la réservation en ligne.`,
                              bouton: 'Noter l’absence',
                              agir: () => envoyer(changerStatutAction, { id: fiche.id, statut: 'ABSENT' }),
                            })
                        : null
                    }
                  />
                ) : null}
              </section>
            ) : null}

            {edition && modifiable ? (
              <FormulaireModifier
                fiche={fiche}
                enCours={enCours}
                onEnregistrer={modifier}
                onAnnuler={() => {
                  setEdition(false)
                  setResultat({})
                }}
              />
            ) : (
              <>
                <section aria-label="Détails">
                  <p className={libelle}>Détails</p>
                  <dl className="mt-4 space-y-3.5 text-[0.9375rem]">
                    <Ligne terme="Acte">{fiche.acte}</Ligne>
                    <Ligne terme="Praticien">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: fiche.praticien.couleur }}
                        />
                        {fiche.praticien.nom}
                      </span>
                    </Ligne>
                    <Ligne terme="Lieu">
                      {fiche.cabinet} · {fiche.fauteuil}
                    </Ligne>
                    <Ligne terme="Note">
                      <span className={fiche.note ? undefined : 'text-muted-foreground'}>{fiche.note ?? 'Aucune'}</span>
                    </Ligne>
                    {statut === 'EN_CAISSE' ? (
                      <Ligne terme="Encaissé">
                        <MontantEncaisse
                          key={fiche.caisse.montantCentimes ?? 'aucun'}
                          montantCentimes={fiche.caisse.montantCentimes}
                          corrigeable={fiche.droits.modifie}
                          enCours={enCours}
                          onCorriger={(montant) => envoyer(corrigerMontantAction, { id: fiche.id, montant })}
                        />
                      </Ligne>
                    ) : null}
                    <Ligne terme="Origine">
                      <span className="text-muted-foreground">{fiche.origine}</span>
                    </Ligne>
                  </dl>
                </section>

                {fiche.droits.modifie && !termine && !enAttente ? (
                  <section aria-label="Déplacer">
                    <p className={libelle}>Déplacer</p>
                    <FormulaireDeplacer
                      key={`${fiche.jour} ${fiche.heureDebut}`}
                      fiche={fiche}
                      enCours={enCours}
                      onDeplacer={(jour, heure) => envoyer(deplacerRendezVousAction, { id: fiche.id, jour, heure })}
                    />
                    <p className="mt-2 text-[0.8125rem] text-muted-foreground">Ou glissez la carte dans l’agenda.</p>
                  </section>
                ) : null}
              </>
            )}
          </>
        )}
      </div>

      {/* Hors de la zone qui défile (tour du 20/10) : « Déplacer » est tout en bas
          de la fiche, et un refus affiché en haut passait inaperçu. */}
      {fiche ? (
        <div aria-live="polite" className="px-7 empty:hidden">
          {resultat.erreur ? (
            <Message ton="erreur" role="alert" className="mb-3">
              {resultat.erreur}
            </Message>
          ) : resultat.succes ? (
            <Message ton="succes" role="status" className="mb-3">
              {resultat.succes}
            </Message>
          ) : null}
        </div>
      ) : null}

      {/* Dupliquer reste possible pour un rendez-vous honoré, manqué ou annulé : c'est
          précisément l'usage visé, reprendre un rendez-vous (lot 5). */}
      {fiche ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-7 py-4">
          {fiche.droits.modifie ? (
            <div className="flex flex-wrap items-center gap-4">
              {modifiable ? (
                <button
                  type="button"
                  aria-pressed={edition}
                  disabled={enCours}
                  onClick={() => {
                    setEdition((e) => !e)
                    setResultat({})
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8] disabled:opacity-60"
                >
                  <Pencil aria-hidden className="size-4" /> Modifier
                </button>
              ) : null}
              <Link
                href={`/tableau-de-bord/agenda/dupliquer/${fiche.id}?jour=${fiche.jour}`}
                className="inline-flex items-center gap-2 text-sm font-medium hover:underline"
              >
                <Copy aria-hidden className="size-4" /> Dupliquer
              </Link>
            </div>
          ) : (
            <span />
          )}
          {fiche.droits.annule && !enAttente && !termine ? (
            <button
              type="button"
              disabled={enCours}
              onClick={() => {
                setConfirmation(
                  fiche.droits.annuleDirectement
                    ? {
                        titre: `Annuler le rendez-vous de ${fiche.patient.prenomNom} ?`,
                        texte: 'Le patient est prévenu par SMS et le créneau est proposé à la liste d’attente.',
                        bouton: 'Annuler le rendez-vous',
                        agir: () => envoyer(changerStatutAction, { id: fiche.id, statut: 'ANNULE' }),
                      }
                    : {
                        titre: `Demander l’annulation du rendez-vous de ${fiche.patient.prenomNom} ?`,
                        texte: 'Le praticien devra la valider. D’ici là, le créneau reste réservé.',
                        bouton: 'Demander l’annulation',
                        agir: () => envoyer(changerStatutAction, { id: fiche.id, statut: 'ANNULE' }),
                      },
                )
              }}
              className="h-10 rounded-full border border-etat-erreur/30 bg-white px-4 text-sm font-semibold text-etat-erreur hover:bg-etat-erreur-fond disabled:opacity-60"
            >
              {fiche.droits.annuleDirectement ? 'Annuler le rendez-vous' : 'Demander l’annulation'}
            </button>
          ) : null}
        </footer>
      ) : null}

      <Dialog open={confirmation !== null} onOpenChange={(o) => !o && setConfirmation(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="font-heading text-xl font-bold">{confirmation?.titre}</DialogTitle>
            <DialogDescription className="text-[0.9375rem]">{confirmation?.texte}</DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmation(null)}
              className="h-10 rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8]"
            >
              Retour
            </button>
            <button
              type="button"
              onClick={() => {
                confirmation?.agir()
                setConfirmation(null)
              }}
              className="h-10 rounded-full bg-etat-erreur px-4 text-sm font-semibold text-white hover:bg-etat-erreur/90"
            >
              {confirmation?.bouton}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

function FormulaireDeplacer({
  fiche,
  enCours,
  onDeplacer,
}: {
  fiche: FicheRendezVousVue
  enCours: boolean
  onDeplacer: (jour: string, heure: string) => void
}) {
  // Les créneaux libres d'abord (tour du 20/10) : choisir plutôt que deviner, donc plus de refus.
  const [creneaux, setCreneaux] = useState<JourDeCreneaux[] | null>(null)
  const [depuis, setDepuis] = useState<string | undefined>(undefined)
  const [choix, setChoix] = useState<{ jour: string; libelle: string; heure: string } | null>(null)
  // Un créneau tous les quarts d'heure noie la colonne : huit par jour, le reste à la demande.
  const [deplies, setDeplies] = useState<string[]>([])
  useEffect(() => {
    let actif = true
    void creneauxPourDeplacerAction(fiche.id, depuis).then((l) => actif && setCreneaux(l))
    return () => {
      actif = false
    }
  }, [fiche.id, depuis])
  const suivant = creneaux?.length ? decalerJour(creneaux[creneaux.length - 1]!.jour, 1) : undefined

  return (
    <div className="mt-3 space-y-4">
      {creneaux === null ? (
        <p className="text-sm text-muted-foreground">Recherche des créneaux libres…</p>
      ) : creneaux.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun créneau libre dans les trois semaines qui viennent.</p>
      ) : (
        <>
          {creneaux.map((j) => (
            <div key={j.jour}>
              <p className="text-sm font-semibold">{j.libelle}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(deplies.includes(j.jour) ? j.heures : j.heures.slice(0, 8)).map((h) => {
                  const actif = choix?.jour === j.jour && choix?.heure === h
                  return (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={actif}
                      onClick={() => setChoix({ jour: j.jour, libelle: j.libelle, heure: h })}
                      className={cn(
                        'chiffres h-9 rounded-full border px-3.5 text-sm font-medium transition-colors',
                        actif ? 'choix-actif' : 'border-[#dde9e6] bg-white text-[#387a70] hover:border-[#387a70]',
                      )}
                    >
                      {h}
                    </button>
                  )
                })}
                {!deplies.includes(j.jour) && j.heures.length > 8 ? (
                  <button
                    type="button"
                    onClick={() => setDeplies((d) => [...d, j.jour])}
                    className="h-9 px-2 text-sm font-semibold text-[#387a70] hover:underline"
                  >
                    + {j.heures.length - 8} autres
                  </button>
                ) : null}
              </div>
              {choix?.jour === j.jour ? (
                <Confirmation
                  choix={choix}
                  fiche={fiche}
                  enCours={enCours}
                  onDeplacer={onDeplacer}
                  onAnnuler={() => setChoix(null)}
                />
              ) : null}
            </div>
          ))}
          {suivant ? (
            <button
              type="button"
              onClick={() => {
                setCreneaux(null)
                setDepuis(suivant)
              }}
              className="text-sm font-semibold text-[#387a70] hover:underline"
            >
              Voir les jours suivants →
            </button>
          ) : null}
        </>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Autre jour ou heure précise
        </summary>
        <DeplacerALaMain fiche={fiche} enCours={enCours} onDeplacer={onDeplacer} />
      </details>
    </div>
  )
}

/** Sous le jour choisi, et non en bas de la liste : là où l'œil vient de cliquer. */
function Confirmation({
  choix,
  fiche,
  enCours,
  onDeplacer,
  onAnnuler,
}: {
  choix: { jour: string; libelle: string; heure: string }
  fiche: FicheRendezVousVue
  enCours: boolean
  onDeplacer: (jour: string, heure: string) => void
  onAnnuler: () => void
}) {
  return (
    <div className="mt-3 rounded-2xl border border-[#d3e6e1] bg-[#f2f8f6] px-4 py-3.5">
      <p className="font-semibold">
        {choix.libelle} · {choix.heure}
      </p>
      <p className="text-[0.8125rem] text-muted-foreground">
        au lieu de {fiche.jourLong.toLowerCase()} · {fiche.heureDebut} — le patient est prévenu par SMS
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={enCours}
          onClick={() => onDeplacer(choix.jour, choix.heure)}
          className="h-10 bouton-principal px-4 text-sm font-semibold disabled:opacity-60"
        >
          Déplacer ici
        </button>
        <button
          type="button"
          onClick={onAnnuler}
          className="h-10 rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8]"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

function DeplacerALaMain({
  fiche,
  enCours,
  onDeplacer,
}: {
  fiche: FicheRendezVousVue
  enCours: boolean
  onDeplacer: (jour: string, heure: string) => void
}) {
  const [jour, setJour] = useState(fiche.jour)
  const [heure, setHeure] = useState(fiche.heureDebut)
  return (
    <form
      className="mt-3 grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onDeplacer(jour, heure)
      }}
    >
      <div className="space-y-1.5">
        <label className="block text-sm font-medium" htmlFor="fiche-jour">
          Jour
        </label>
        <input
          id="fiche-jour"
          type="date"
          required
          value={jour}
          onChange={(e) => setJour(e.target.value)}
          className="champ rounded-full"
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium" htmlFor="fiche-heure">
          Heure
        </label>
        {/* À la minute (Q22) : 10h20 doit passer, sans refus muet du navigateur. */}
        <input
          id="fiche-heure"
          type="time"
          step={60}
          required
          value={heure}
          onChange={(e) => setHeure(e.target.value)}
          className="champ rounded-full"
        />
      </div>
      <button
        type="submit"
        disabled={enCours || (jour === fiche.jour && heure === fiche.heureDebut)}
        className="col-span-2 h-10 justify-self-start rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8] disabled:opacity-50"
      >
        Déplacer
      </button>
    </form>
  )
}

function Ligne({ terme, children }: { terme: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3">
      <dt className="text-muted-foreground">{terme}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** Le recours pour un cas hors du parcours : un absent qui arrive en retard, une étape cliquée par erreur. */
function AutresActions({
  statut,
  enCours,
  onChoisir,
  onAbsent,
}: {
  statut: StatutRendezVous
  enCours: boolean
  onChoisir: (s: StatutRendezVous) => void
  onAbsent: (() => void) | null
}) {
  const [choix, setChoix] = useState<StatutRendezVous>(statut)
  // L'annulation a son propre bouton (et sa propre règle, D17) : pas de raccourci par ce menu.
  const possibles = PARCOURS.filter((s) => s !== 'ANNULE')

  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Autres actions</summary>
      {onAbsent ? (
        <button
          type="button"
          disabled={enCours}
          onClick={onAbsent}
          className="mt-3 h-10 w-full rounded-full border border-etat-erreur/30 bg-white px-4 font-semibold text-etat-erreur hover:bg-etat-erreur-fond disabled:opacity-60"
        >
          Le patient ne s’est pas présenté
        </button>
      ) : null}
      <p className="mt-4 text-[0.8125rem] text-muted-foreground">Corriger le statut</p>
      <div className="mt-2 flex gap-2">
        <label htmlFor="fiche-statut" className="sr-only">
          Statut
        </label>
        <select
          id="fiche-statut"
          value={choix}
          onChange={(e) => setChoix(e.target.value as StatutRendezVous)}
          className="champ h-10 flex-1 rounded-full"
        >
          {possibles.map((s) => (
            <option key={s} value={s}>
              {LIBELLE_STATUT[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={enCours || choix === statut}
          onClick={() => onChoisir(choix)}
          className="h-10 rounded-full border border-[#dde9e6] bg-white px-4 font-semibold hover:bg-[#f5f9f8] disabled:opacity-50"
        >
          Appliquer
        </button>
      </div>
    </details>
  )
}

/** « Modifier » (27/10) : jour, heure, praticien, acte et note, enregistrés d'un coup avec les règles de la prise. */
function FormulaireModifier({
  fiche,
  enCours,
  onEnregistrer,
  onAnnuler,
}: {
  fiche: FicheRendezVousVue
  enCours: boolean
  onEnregistrer: (champs: Record<string, string>) => void
  onAnnuler: () => void
}) {
  const m = fiche.modification!
  const [praticienId, setPraticienId] = useState(m.praticienId)
  const [motifId, setMotifId] = useState(m.motifId)
  const [jour, setJour] = useState(fiche.jour)
  const [heure, setHeure] = useState(fiche.heureDebut)
  const [note, setNote] = useState(fiche.note ?? '')
  const pratiques = m.praticiens.find((p) => p.id === praticienId)?.motifs ?? []
  const motifs = m.motifs.filter((x) => pratiques.includes(x.id) || x.id === m.motifId)
  const pratique = pratiques.includes(motifId)
  // Sous le parcours, le formulaire s'ouvrait hors de vue : on y descend, premier champ prêt à la saisie.
  const formulaire = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formulaire.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    formulaire.current?.querySelector('select')?.focus({ preventScroll: true })
  }, [])

  return (
    <form
      ref={formulaire}
      aria-label="Modifier le rendez-vous"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onEnregistrer({ id: fiche.id, praticienId, motifId, jour, heure, note })
      }}
    >
      <p className={libelle}>Modifier le rendez-vous</p>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium" htmlFor="modifier-acte">
          Acte
        </label>
        <select
          id="modifier-acte"
          value={motifId}
          onChange={(e) => setMotifId(e.target.value)}
          className="champ rounded-full"
        >
          {motifs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.libelle}
            </option>
          ))}
        </select>
      </div>
      {m.praticiens.length > 1 ? (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium" htmlFor="modifier-praticien">
            Praticien
          </label>
          <select
            id="modifier-praticien"
            value={praticienId}
            onChange={(e) => setPraticienId(e.target.value)}
            className="champ rounded-full"
          >
            {m.praticiens.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {!pratique ? (
        <p className="text-[0.8125rem] text-etat-alerte">Ce praticien ne pratique pas cet acte : choisissez-en un autre.</p>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium" htmlFor="modifier-jour">
            Jour
          </label>
          <input
            id="modifier-jour"
            type="date"
            required
            value={jour}
            onChange={(e) => setJour(e.target.value)}
            className="champ rounded-full"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium" htmlFor="modifier-heure">
            Heure
          </label>
          {/* À la minute (Q22), comme « Déplacer » : 10h20 doit passer. */}
          <input
            id="modifier-heure"
            type="time"
            step={60}
            required
            value={heure}
            onChange={(e) => setHeure(e.target.value)}
            className="champ rounded-full"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium" htmlFor="modifier-note">
          Note
        </label>
        <textarea
          id="modifier-note"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="champ rounded-2xl"
        />
      </div>
      {jour !== fiche.jour || heure !== fiche.heureDebut ? (
        <p className="text-[0.8125rem] text-muted-foreground">Le patient est prévenu par SMS du nouvel horaire.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={enCours || !pratique}
          className="h-10 bouton-principal px-4 text-sm font-semibold disabled:opacity-60"
        >
          Enregistrer
        </button>
        <button
          type="button"
          onClick={onAnnuler}
          className="h-10 rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8]"
        >
          Annuler
        </button>
      </div>
    </form>
  )
}

/**
 * Le passage en caisse (D81, maquette du 28/10) : le prix du soin, validé d'un clic, ou un autre montant si le
 * praticien a fait plus. C'est ce montant que compte la rétrocession.
 */
function PassageEnCaisse({
  prixCentimes,
  enCours,
  onValider,
}: {
  prixCentimes: number | null
  enCours: boolean
  /** `null` : le prix du soin ; sinon le montant saisi, tel quel (« 62,50 »). */
  onValider: (montant: string | null) => void
}) {
  const [autre, setAutre] = useState(prixCentimes === null)
  const [saisie, setSaisie] = useState(eurosSaisie(prixCentimes))
  return (
    <div className="mt-6 rounded-2xl border-[1.5px] border-[#cfe3df] bg-[#f2f8f6] px-4 py-3.5">
      <p className="text-sm">Montant du soin</p>
      {autre ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onValider(saisie)
          }}
        >
          <label className="sr-only" htmlFor="montant-caisse">
            Montant en euros
          </label>
          <input
            id="montant-caisse"
            inputMode="decimal"
            required
            autoFocus
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            className="champ chiffres w-28 rounded-full text-right"
          />
          <span className="text-sm">€</span>
          <button type="submit" disabled={enCours} className="h-10 bouton-principal px-4 text-sm font-semibold disabled:opacity-60">
            Passé en caisse
          </button>
          {prixCentimes === null ? (
            <p className="w-full text-[0.8125rem] text-muted-foreground">
              Pas encore de prix pour ce soin : l’administrateur le fixe dans Réglages → Rétrocession.
            </p>
          ) : null}
        </form>
      ) : (
        <>
          <p className="chiffres font-heading text-[2rem] leading-tight font-bold">{euros(prixCentimes!)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={enCours}
              onClick={() => onValider(null)}
              className="h-10 bouton-principal px-4 text-sm font-semibold disabled:opacity-60"
            >
              Passé en caisse — {euros(prixCentimes!)}
            </button>
            <button
              type="button"
              onClick={() => setAutre(true)}
              className="h-10 rounded-full border border-[#dde9e6] bg-white px-4 text-sm font-semibold hover:bg-[#f5f9f8]"
            >
              Autre montant
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Le montant encaissé, et sa correction (une erreur de saisie, un soin de plus). */
function MontantEncaisse({
  montantCentimes,
  corrigeable,
  enCours,
  onCorriger,
}: {
  montantCentimes: number | null
  corrigeable: boolean
  enCours: boolean
  onCorriger: (montant: string) => void
}) {
  const [edition, setEdition] = useState(false)
  const [saisie, setSaisie] = useState(eurosSaisie(montantCentimes))
  if (edition) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onCorriger(saisie)
        }}
      >
        <label className="sr-only" htmlFor="montant-corrige">
          Montant encaissé en euros
        </label>
        <input
          id="montant-corrige"
          inputMode="decimal"
          required
          autoFocus
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          className="champ chiffres h-9 w-24 rounded-full py-1 text-right"
        />
        <span>€</span>
        <button type="submit" disabled={enCours} className="h-9 bouton-principal px-3.5 text-sm font-semibold disabled:opacity-60">
          Enregistrer
        </button>
      </form>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-3">
      <span className={cn('chiffres font-semibold', montantCentimes === null && 'font-normal text-etat-alerte')}>
        {montantCentimes === null ? 'Sans montant' : euros(montantCentimes)}
      </span>
      {corrigeable ? (
        <button type="button" onClick={() => setEdition(true)} className="text-sm font-semibold text-[#387a70] hover:underline">
          Corriger
        </button>
      ) : null}
    </span>
  )
}
