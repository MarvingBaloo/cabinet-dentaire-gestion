'use client'

import type { NiveauUrgence } from '@prisma/client'
import { ArrowUp, Phone, RotateCcw, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'

import { cn } from '@/lib/utils'
import {
  confirmerDepuisAssistantAction,
  envoyerMessageAssistantAction,
  proposerSuiviAction,
  reserverDepuisAssistantAction,
  transmettreDemandeAction,
} from '@/server/actions/assistant'
import type { PropositionVue, VueConversation } from '@/server/assistant/urgences'

// La bulle de l'assistant des urgences (D77, maquette du 24/10, entrée C1) : une pastille « Urgence dentaire ? »
// en bas à droite de chaque page du site, qui ouvre la conversation par-dessus la page — tout l'écran sur un
// téléphone. La conversation survit au changement de page (mémoire de l'onglet).

const ACCUEIL = 'Bonjour, je suis l’assistant du cabinet. Dites-moi ce qui vous arrive : je vous trouve le bon créneau.'
const CLE = 'assistant-urgences'

const NIVEAU: Record<NiveauUrgence, { titre: string; couleur: string; fond: string }> = {
  VITALE: { titre: 'Appelez le 15 maintenant', couleur: '#B42318', fond: '#FBEAE8' },
  URGENCE_FORTE: { titre: 'Urgence forte · sous 48 heures', couleur: '#C2410C', fond: '#FFF1E6' },
  URGENCE_SIMPLE: { titre: 'Urgence · sous 72 heures', couleur: '#B45309', fond: '#FEF3E2' },
  DIFFERABLE: { titre: 'Peut attendre quelques jours', couleur: '#9A6412', fond: '#FDF3E1' },
  NON_URGENT: { titre: 'Pas une urgence', couleur: '#2C6B62', fond: '#E4F1EE' },
}

type Reservation = { index: number; reservationId?: string; masque?: string }

function lireMemoire(): VueConversation | null {
  try {
    const brut = sessionStorage.getItem(CLE)
    return brut ? (JSON.parse(brut) as VueConversation) : null
  } catch {
    return null
  }
}

function ecrireMemoire(vue: VueConversation | null) {
  try {
    if (vue) sessionStorage.setItem(CLE, JSON.stringify(vue))
    else sessionStorage.removeItem(CLE)
  } catch {
    // Navigation privée : la conversation ne survivra pas au changement de page, rien de plus.
  }
}

export function AssistantUrgences() {
  const [ouvert, setOuvert] = useState(false)
  const [vue, setVue] = useState<VueConversation | null>(null)
  const [enAttente, setEnAttente] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [saisie, setSaisie] = useState('')
  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [enCours, demarrer] = useTransition()
  const fil = useRef<HTMLDivElement>(null)
  const champ = useRef<HTMLTextAreaElement>(null)
  const pastille = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Lue après le premier rendu : le serveur ne connaît pas la mémoire de l'onglet.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVue(lireMemoire())
  }, [])

  useEffect(() => {
    fil.current?.scrollTo({ top: fil.current.scrollHeight, behavior: 'smooth' })
  }, [vue, enAttente, reservation, erreur])

  useEffect(() => {
    if (!ouvert) return
    champ.current?.focus()
    const surTouche = (e: KeyboardEvent) => e.key === 'Escape' && fermer()
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [ouvert])

  function fermer() {
    setOuvert(false)
    requestAnimationFrame(() => pastille.current?.focus())
  }

  function majVue(v: VueConversation) {
    setVue(v)
    ecrireMemoire(v)
  }

  function envoyer(texte: string) {
    const propre = texte.trim()
    if (!propre || enCours) return
    setErreur(null)
    setSaisie('')
    setEnAttente(propre)
    demarrer(async () => {
      const r = await envoyerMessageAssistantAction(vue?.id ?? null, propre)
      setEnAttente(null)
      if (r.vue) majVue(r.vue)
      else {
        setErreur(r.erreur ?? 'Une erreur est survenue.')
        setSaisie(propre)
      }
    })
  }

  function recommencer() {
    setVue(null)
    ecrireMemoire(null)
    setReservation(null)
    setErreur(null)
  }

  const messages = vue?.messages ?? [{ role: 'assistant' as const, texte: ACCUEIL }]
  const derniere = messages.at(-1)
  const choix = !vue?.niveau && !enAttente && derniere?.role === 'assistant' ? (derniere.choix ?? []) : []
  const termine = Boolean(vue?.niveau)

  return (
    <>
      {!ouvert ? (
        <button
          ref={pastille}
          type="button"
          onClick={() => setOuvert(true)}
          aria-haspopup="dialog"
          className="fixed right-4 bottom-4 z-50 flex items-center gap-2.5 rounded-full bg-[#387a70] py-3 pr-5 pl-3.5 text-sm font-bold text-white shadow-[0_14px_30px_-10px_rgba(44,95,88,0.7)] transition-transform hover:scale-[1.03] md:right-6 md:bottom-6"
        >
          <span aria-hidden className="hexagone grid size-[30px] place-items-center bg-white text-base text-[#387a70]">
            !
          </span>
          Urgence dentaire ?
        </button>
      ) : null}

      {ouvert ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="titre-assistant"
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white md:inset-auto md:right-6 md:bottom-6 md:h-[min(42rem,calc(100dvh-3rem))] md:w-[26rem] md:rounded-[1.625rem] md:border md:border-[#e3ecea] md:shadow-[0_30px_70px_-30px_rgba(36,51,47,0.45)]"
        >
          <header className="flex items-center gap-3 bg-gradient-to-br from-[#387a70] to-[#2c6b62] px-5 py-4 text-white">
            <span aria-hidden className="hexagone grid size-[38px] place-items-center bg-white font-heading text-sm font-bold text-[#387a70]">
              MG
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="titre-assistant" className="font-heading text-base font-semibold">
                Assistant du cabinet
              </h2>
              <p className="text-xs opacity-85">Répond tout de suite, jour et nuit</p>
            </div>
            {vue ? (
              <button
                type="button"
                onClick={recommencer}
                title="Recommencer"
                className="grid size-8 place-items-center rounded-full bg-white/20 hover:bg-white/30"
              >
                <RotateCcw aria-hidden className="size-4" />
                <span className="sr-only">Recommencer</span>
              </button>
            ) : null}
            <button type="button" onClick={fermer} className="grid size-8 place-items-center rounded-full bg-white/20 hover:bg-white/30">
              <X aria-hidden className="size-4" />
              <span className="sr-only">Fermer</span>
            </button>
          </header>

          <div ref={fil} aria-live="polite" className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-[#fbfaf7] px-4 py-4">
            {messages.map((m, i) => {
              // Le verdict : la réponse au dernier message du patient. Le suivi ou la demande transmise viennent après.
              const verdict = termine && i === messages.findLastIndex((x) => x.role === 'patient') + 1 && m.role === 'assistant'
              if (verdict && vue?.niveau) return <Verdict key={i} niveau={vue.niveau} texte={m.texte} />
              return (
                <p
                  key={i}
                  className={cn(
                    'max-w-[85%] rounded-[1.125rem] px-3.5 py-2.5 text-[0.84rem] leading-snug',
                    m.role === 'patient'
                      ? 'self-end rounded-br-md bg-[#387a70] text-white'
                      : 'self-start rounded-bl-md border border-[#e3ecea] bg-white',
                  )}
                >
                  {m.texte}
                </p>
              )
            })}
            {enAttente ? (
              <>
                <p className="max-w-[85%] self-end rounded-[1.125rem] rounded-br-md bg-[#387a70] px-3.5 py-2.5 text-[0.84rem] text-white">
                  {enAttente}
                </p>
                <p aria-label="L’assistant écrit" className="flex gap-1 self-start rounded-[1.125rem] border border-[#e3ecea] bg-white px-4 py-3.5">
                  {[0, 1, 2].map((k) => (
                    <span key={k} className="size-1.5 animate-pulse rounded-full bg-[#b9c9c5]" style={{ animationDelay: `${k * 150}ms` }} />
                  ))}
                </p>
              </>
            ) : null}
            {choix.length ? (
              <div className="flex flex-wrap gap-2 self-start">
                {choix.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => envoyer(c)}
                    className="rounded-full border-[1.5px] border-[#387a70] bg-white px-3.5 py-1.5 text-[0.8rem] font-semibold text-[#2c6b62] hover:bg-[#e4f1ee]"
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}

            {vue?.niveau === 'VITALE' ? (
              <a href="tel:15" className="flex items-center justify-center gap-2 rounded-full bg-[#b42318] px-4 py-3 font-bold text-white">
                <Phone aria-hidden className="size-4" /> Appeler le 15
              </a>
            ) : null}
            {vue?.suiviPossible ? (
              <button
                type="button"
                disabled={enCours}
                onClick={() =>
                  demarrer(async () => {
                    const r = await proposerSuiviAction(vue.id)
                    if (r.vue) majVue(r.vue)
                    else setErreur(r.erreur ?? 'Une erreur est survenue.')
                  })
                }
                className="self-start rounded-full border-[1.5px] border-[#387a70] bg-white px-4 py-2 text-[0.8rem] font-semibold text-[#2c6b62] hover:bg-[#e4f1ee]"
              >
                Après l’hôpital : prendre un rendez-vous de suivi
              </button>
            ) : null}
            {vue?.demande === 'possible' ? <Demande conversationId={vue.id} transmise={majVue} /> : null}
            {vue?.niveau === 'NON_URGENT' ? (
              <Link href="/rendez-vous" className="self-start rounded-full bouton-principal px-4 py-2.5 text-sm font-bold text-white">
                Prendre rendez-vous →
              </Link>
            ) : null}

            {vue?.reserve ? (
              <div className="rounded-[1.125rem] border-[1.5px] border-[#2c6b62] bg-[#e4f1ee] px-4 py-3.5 text-[0.84rem]">
                <p className="font-heading font-bold text-[#2c6b62]">✓ C’est réservé</p>
                <p className="mt-1.5">
                  <b>
                    {vue.reserve.jour}, {vue.reserve.heure}
                  </b>
                  , {vue.reserve.praticien}. Vous recevez la confirmation par SMS.
                </p>
                <p className="mt-1.5">Si cela s’aggrave, ou si vous avez du mal à avaler ou à respirer : appelez le 15.</p>
              </div>
            ) : vue && vue.propositions.length ? (
              <Propositions
                conversationId={vue.id}
                propositions={vue.propositions}
                reservation={reservation}
                choisir={(index) => setReservation({ index })}
                apresCode={(r) => setReservation(r)}
                confirme={(v) => {
                  setReservation(null)
                  majVue(v)
                }}
              />
            ) : null}

            {erreur ? (
              <p role="alert" className="rounded-[1.125rem] border border-[#f1c9c4] bg-[#fbeae8] px-3.5 py-2.5 text-[0.8rem] text-[#b42318]">
                {erreur}
              </p>
            ) : null}
          </div>

          {!termine ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                envoyer(saisie)
              }}
              className="flex items-end gap-2.5 border-t border-[#e8eeec] bg-white px-4 py-3"
            >
              <label htmlFor="message-assistant" className="sr-only">
                Votre message
              </label>
              <textarea
                ref={champ}
                id="message-assistant"
                rows={1}
                maxLength={600}
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    envoyer(saisie)
                  }
                }}
                placeholder="Écrivez votre message…"
                className="max-h-28 min-h-10 flex-1 resize-none rounded-[1.25rem] border-[1.5px] border-[#dce6e3] px-4 py-2.5 text-[0.84rem] outline-none focus:border-[#387a70]"
              />
              <button
                type="submit"
                disabled={enCours || !saisie.trim()}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-[#387a70] text-white disabled:opacity-50"
              >
                <ArrowUp aria-hidden className="size-4" />
                <span className="sr-only">Envoyer</span>
              </button>
            </form>
          ) : null}
          <p className="bg-white px-4 pt-1 pb-3 text-[0.7rem] leading-snug text-muted-foreground">
            <b className="text-[#b42318]">Urgence vitale :</b> appelez le 15. L’assistant ne remplace pas un avis médical.
          </p>
        </div>
      ) : null}
    </>
  )
}

function Verdict({ niveau, texte }: { niveau: NiveauUrgence; texte: string }) {
  const n = NIVEAU[niveau]
  return (
    <div className="rounded-[1.125rem] border-[1.5px] px-4 py-3.5" style={{ borderColor: n.couleur, background: n.fond }}>
      <p className="flex items-center gap-2 font-heading text-[0.95rem] font-bold" style={{ color: n.couleur }}>
        <span aria-hidden className="size-2.5 rounded-full" style={{ background: n.couleur }} />
        {n.titre}
      </p>
      <p className="mt-1.5 text-[0.82rem] leading-snug">{texte}</p>
    </div>
  )
}

function Propositions({
  conversationId,
  propositions,
  reservation,
  choisir,
  apresCode,
  confirme,
}: {
  conversationId: string
  propositions: PropositionVue[]
  reservation: Reservation | null
  choisir: (index: number) => void
  apresCode: (r: Reservation) => void
  confirme: (v: VueConversation) => void
}) {
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, demarrer] = useTransition()
  const choisie = reservation ? propositions.find((p) => p.index === reservation.index) : undefined

  if (!choisie) {
    return (
      <div className="flex flex-col gap-2">
        {propositions.map((p) => (
          <button
            key={p.index}
            type="button"
            onClick={() => choisir(p.index)}
            className="flex items-center gap-3 rounded-[0.875rem] border border-[#e3ecea] bg-white px-3 py-2.5 text-left hover:border-[#387a70]"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-heading text-[0.95rem] font-bold">
                {p.jour}, {p.heure}
              </span>
              <span className="block text-xs text-muted-foreground">
                {p.praticien} · Marie-Galante · {p.duree} min
              </span>
            </span>
            <span className="text-xs font-bold text-[#2c6b62]">Je prends →</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[1.125rem] border border-[#e3ecea] bg-white px-4 py-3.5">
      <p className="text-[0.84rem]">
        <b>
          {choisie.jour}, {choisie.heure}
        </b>{' '}
        · {choisie.praticien}
      </p>
      {!reservation?.reservationId ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            setErreur(null)
            demarrer(async () => {
              const r = await reserverDepuisAssistantAction({
                conversationId,
                index: choisie.index,
                prenom: String(f.get('prenom') ?? ''),
                nom: String(f.get('nom') ?? ''),
                telephone: String(f.get('telephone') ?? ''),
              })
              if (r.reservationId) apresCode({ index: choisie.index, reservationId: r.reservationId, ...(r.masque ? { masque: r.masque } : {}) })
              else setErreur(r.erreur ?? 'Une erreur est survenue.')
            })
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <input name="prenom" required autoComplete="given-name" placeholder="Prénom" aria-label="Prénom" className="champ h-10 text-sm" />
            <input name="nom" required autoComplete="family-name" placeholder="Nom" aria-label="Nom" className="champ h-10 text-sm" />
          </div>
          <input name="telephone" required type="tel" autoComplete="tel" placeholder="Portable" aria-label="Portable" className="champ h-10 text-sm" />
          <button type="submit" disabled={enCours} className="h-10 bouton-principal text-sm font-bold text-white disabled:opacity-60">
            Recevoir le code par SMS
          </button>
          <button type="button" onClick={() => choisir(-1)} className="text-xs text-muted-foreground underline">
            Un autre créneau
          </button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const code = String(new FormData(e.currentTarget).get('code') ?? '')
            setErreur(null)
            demarrer(async () => {
              const r = await confirmerDepuisAssistantAction({ conversationId, reservationId: reservation.reservationId!, code })
              if (r.confirme && r.vue) confirme(r.vue)
              else setErreur(r.erreur ?? 'Une erreur est survenue.')
            })
          }}
        >
          <label htmlFor="code-assistant" className="text-[0.8rem]">
            Code envoyé au {reservation.masque} :
          </label>
          <input
            id="code-assistant"
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="champ h-10 text-center font-heading text-lg tracking-[0.4em]"
          />
          <button type="submit" disabled={enCours} className="h-10 bouton-principal text-sm font-bold text-white disabled:opacity-60">
            Confirmer le rendez-vous
          </button>
        </form>
      )}
      {erreur ? (
        <p role="alert" className="text-[0.8rem] text-[#b42318]">
          {erreur}
        </p>
      ) : null}
    </div>
  )
}

/** Rien de libre dans le délai : le patient laisse ses coordonnées, la demande part au praticien (D79). */
function Demande({ conversationId, transmise }: { conversationId: string; transmise: (v: VueConversation) => void }) {
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, demarrer] = useTransition()
  return (
    <form
      className="flex flex-col gap-2 rounded-[1.125rem] border border-[#e3ecea] bg-white px-4 py-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        setErreur(null)
        demarrer(async () => {
          const r = await transmettreDemandeAction({
            conversationId,
            prenom: String(f.get('prenom') ?? ''),
            nom: String(f.get('nom') ?? ''),
            telephone: String(f.get('telephone') ?? ''),
          })
          if (r.vue) transmise(r.vue)
          else setErreur(r.erreur ?? 'Une erreur est survenue.')
        })
      }}
    >
      <p className="text-[0.8rem] font-semibold">Pour que le cabinet vous rappelle :</p>
      <div className="grid grid-cols-2 gap-2">
        <input name="prenom" required autoComplete="given-name" placeholder="Prénom" aria-label="Prénom" className="champ h-10 text-sm" />
        <input name="nom" required autoComplete="family-name" placeholder="Nom" aria-label="Nom" className="champ h-10 text-sm" />
      </div>
      <input name="telephone" required type="tel" autoComplete="tel" placeholder="Portable" aria-label="Portable" className="champ h-10 text-sm" />
      <button type="submit" disabled={enCours} className="h-10 bouton-principal text-sm font-bold text-white disabled:opacity-60">
        Transmettre ma demande au praticien
      </button>
      {erreur ? (
        <p role="alert" className="text-[0.8rem] text-[#b42318]">
          {erreur}
        </p>
      ) : null}
    </form>
  )
}
