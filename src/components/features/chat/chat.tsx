'use client'

import { ArrowLeft, Bell, BellOff, Plus, Search, SendHorizontal, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useEffect, useLayoutEffect, useOptimistic, useRef, useState } from 'react'

import { useChat } from '@/components/features/chat/chat-en-direct'
import { cn } from '@/lib/utils'
import { chercherCitationsAction, envoyerMessageAction, marquerLuAction } from '@/server/actions/chat'
import type { Citation, CitationTrouvee, Collegue } from '@/server/queries/chat'

// Le chat interne (D82, maquette du 28/10) : à gauche les collègues, à droite la conversation. Au téléphone, l'un
// puis l'autre.

export type ConversationVue = {
  collegue: Collegue
  dernier: { texte: string; quand: string; deMoi: boolean } | null
  nonLus: number
}
export type MessageVue = {
  id: string
  texte: string
  heure: string
  deMoi: boolean
  citation: Citation | null
}
export type JourVue = { jour: string; libelle: string; messages: MessageVue[] }

type Cite = {
  type: 'patient' | 'rendezVous'
  id: string
  titre: string
  detail: string
}

function Avatar({ collegue, petit }: { collegue: Collegue; petit?: boolean }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: collegue.couleur ?? '#387a70' }}
      className={cn(
        'hexagone grid shrink-0 place-items-center font-heading font-extrabold text-white',
        petit ? 'h-[2.375rem] w-[2.125rem] text-[0.75rem]' : 'h-[2.875rem] w-10 text-[0.8125rem]',
      )}
    >
      {collegue.initiales}
    </span>
  )
}

function BoutonSon() {
  const { sonCoupe, basculerSon } = useChat()
  const Icone = sonCoupe ? BellOff : Bell
  return (
    <button
      type="button"
      onClick={basculerSon}
      aria-pressed={sonCoupe}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full border border-[#dde9e6] bg-white px-3.5 text-[0.8125rem] font-semibold hover:bg-[#f5f9f8]',
        sonCoupe && 'text-muted-foreground',
      )}
    >
      <Icone aria-hidden className="size-4" strokeWidth={1.8} />
      {sonCoupe ? 'Son coupé' : 'Son activé'}
    </button>
  )
}

function ListeCollegues({ conversations, ouverteId }: { conversations: ConversationVue[]; ouverteId: string | null }) {
  const [filtre, setFiltre] = useState('')
  const mots = filtre.trim().toLowerCase()
  const visibles = mots ? conversations.filter((c) => c.collegue.nom.toLowerCase().includes(mots)) : conversations
  return (
    <aside
      aria-label="Collègues"
      className={cn(
        'min-h-0 w-full flex-col border-r border-[#e3ecea] bg-white lg:flex lg:w-[22.5rem] lg:shrink-0',
        ouverteId ? 'hidden' : 'flex',
      )}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
        <h1 className="font-heading text-2xl font-extrabold">Chat</h1>
        <BoutonSon />
      </div>
      <div className="relative mx-5 mb-3">
        <label htmlFor="filtre-collegues" className="sr-only">
          Chercher un collègue
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          id="filtre-collegues"
          type="search"
          autoComplete="off"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          placeholder="Chercher un collègue"
          className="champ h-10 rounded-full border-[#dde9e6] bg-white pl-10 text-[0.9375rem]"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {visibles.map((c) => {
          const ouverte = c.collegue.id === ouverteId
          // La conversation ouverte est en train d'être lue : sa pastille n'a plus lieu d'être.
          const nonLus = ouverte ? 0 : c.nonLus
          return (
            <li key={c.collegue.id} className="border-t border-[#f0f4f3]">
              <Link
                href={`/tableau-de-bord/chat/${c.collegue.id}`}
                aria-current={ouverte ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 px-5 py-3 hover:bg-[#f5f9f8]',
                  ouverte && 'bg-[#e4f1ee] hover:bg-[#e4f1ee]',
                )}
              >
                <Avatar collegue={c.collegue} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[0.9375rem] font-semibold">{c.collegue.nom}</span>
                    {c.dernier ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{c.dernier.quand}</span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 block truncate text-[0.8125rem]',
                      nonLus > 0 ? 'font-semibold text-encre' : 'text-muted-foreground',
                    )}
                  >
                    {c.dernier
                      ? `${c.dernier.deMoi ? 'Vous : ' : ''}${c.dernier.texte}`
                      : `${c.collegue.role} · aucune conversation`}
                  </span>
                </span>
                {nonLus > 0 ? (
                  <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#c2410c] px-1.5 text-[0.6875rem] font-bold text-white">
                    <span className="sr-only">Non lus : </span>
                    {nonLus}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
        {visibles.length === 0 ? (
          <li className="px-5 py-4 text-sm text-muted-foreground">
            {conversations.length === 0
              ? 'Aucun collègue n’a de compte actif.'
              : `Personne ne s’appelle « ${filtre.trim()} ».`}
          </li>
        ) : null}
      </ul>
    </aside>
  )
}

function CarteCitation({ citation, deMoi }: { citation: Citation; deMoi: boolean }) {
  if (!citation.accessible) {
    return (
      <span
        className={cn(
          'mt-2 block rounded-2xl px-3 py-2 text-[0.8125rem]',
          deMoi ? 'bg-white/90 text-muted-foreground' : 'bg-[#f2f5f4] text-muted-foreground',
        )}
      >
        Fiche d’un patient que vous ne suivez pas
      </span>
    )
  }
  return (
    <Link
      href={citation.href}
      className="mt-2 flex items-center gap-3 rounded-2xl border border-[#cfe4df] bg-[#f2f8f6] px-3 py-2.5 text-encre hover:bg-[#e4f1ee]"
    >
      <span aria-hidden className="hexagone h-[1.875rem] w-[1.625rem] shrink-0 bg-[#cfe4df]" />
      <span className="min-w-0 flex-1">
        <span className="block font-heading text-[0.875rem] font-bold">{citation.titre}</span>
        <span className="block text-[0.8125rem] text-muted-foreground">{citation.detail}</span>
      </span>
      <span className="shrink-0 text-[0.8125rem] font-bold text-[#387a70]">Ouvrir →</span>
    </Link>
  )
}

function CiterPatient({ onChoisir, onFermer }: { onChoisir: (c: Cite) => void; onFermer: () => void }) {
  const [terme, setTerme] = useState('')
  const [resultats, setResultats] = useState<CitationTrouvee[] | null>(null)
  const boite = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (terme.trim().length < 2) return
    let encore = true
    const minuterie = setTimeout(() => {
      void chercherCitationsAction(terme).then((r) => {
        if (encore) setResultats(r)
      })
    }, 200)
    return () => {
      encore = false
      clearTimeout(minuterie)
    }
  }, [terme])

  useEffect(() => {
    const dehors = (e: PointerEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) onFermer()
    }
    document.addEventListener('pointerdown', dehors)
    return () => document.removeEventListener('pointerdown', dehors)
  }, [onFermer])

  const liste = terme.trim().length >= 2 ? resultats : null

  return (
    <div
      ref={boite}
      role="dialog"
      aria-label="Citer un patient"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onFermer()
      }}
      className="absolute right-0 bottom-full left-0 z-20 mb-2 rounded-[1.25rem] border border-[#dfe9e6] bg-white p-3 shadow-[0_30px_60px_-20px_rgb(36_51_47/0.35)] sm:left-auto sm:w-[30rem]"
    >
      <label htmlFor="citer-patient" className="sr-only">
        Nom, prénom ou téléphone du patient
      </label>
      <input
        id="citer-patient"
        type="search"
        autoFocus
        autoComplete="off"
        value={terme}
        onChange={(e) => setTerme(e.target.value)}
        placeholder="Nom, prénom ou téléphone du patient"
        className="champ h-10 rounded-full border-[#dde9e6] bg-white px-4 text-[0.9375rem]"
      />
      {liste ? (
        <ul className="mt-2 max-h-72 overflow-y-auto">
          {liste.length === 0 ? (
            <li className="px-2 py-2 text-sm text-muted-foreground">Aucun patient ne correspond.</li>
          ) : null}
          {liste.map((r) => (
            <li key={r.patient.id}>
              <button
                type="button"
                onClick={() =>
                  onChoisir({
                    type: 'patient',
                    id: r.patient.id,
                    titre: r.patient.nom,
                    detail: 'Fiche du patient',
                  })
                }
                className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left hover:bg-[#f2f8f6]"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{r.patient.nom}</span>
                  <span className="block text-[0.8125rem] text-muted-foreground">{r.patient.detail}</span>
                </span>
              </button>
              {r.rendezVous.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    onChoisir({
                      type: 'rendezVous',
                      id: v.id,
                      titre: `${r.patient.nom} · ${v.libelle}`,
                      detail: v.detail,
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-2xl py-1.5 pr-2.5 pl-8 text-left text-[0.875rem] hover:bg-[#f2f8f6]"
                >
                  <span aria-hidden className="text-muted-foreground">
                    ↳
                  </span>
                  <span>
                    <b>{v.libelle}</b> · {v.detail}
                  </span>
                </button>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 px-2 text-[0.8125rem] text-muted-foreground">
          Le patient, ou l’un de ses rendez-vous : un clic sur la carte ouvrira sa fiche.
        </p>
      )}
    </div>
  )
}

function Conversation({
  collegue,
  jours,
  aujourdhui,
  avaitNonLus,
}: {
  collegue: Collegue
  jours: JourVue[]
  aujourdhui: string
  avaitNonLus: boolean
}) {
  const router = useRouter()
  const { majNonLus } = useChat()
  const [texte, setTexte] = useState('')
  const [cite, setCite] = useState<Cite | null>(null)
  const [citer, setCiter] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const fil = useRef<HTMLDivElement>(null)
  const champ = useRef<HTMLTextAreaElement>(null)

  const [joursAffiches, ajouter] = useOptimistic(jours, (avant: JourVue[], m: MessageVue) => {
    const dernier = avant.at(-1)
    if (dernier?.jour === aujourdhui) return [...avant.slice(0, -1), { ...dernier, messages: [...dernier.messages, m] }]
    return [...avant, { jour: aujourdhui, libelle: 'Aujourd’hui', messages: [m] }]
  })
  const total = joursAffiches.reduce((n, j) => n + j.messages.length, 0)

  useLayoutEffect(() => {
    fil.current?.scrollTo({ top: fil.current.scrollHeight })
  }, [total])

  useEffect(() => {
    if (!avaitNonLus) return
    void marquerLuAction(collegue.id).then((n) => {
      majNonLus(n)
      router.refresh()
    })
  }, [avaitNonLus, collegue.id, majNonLus, router])

  function envoyer() {
    const contenu = texte.trim()
    if (!contenu) return
    const citation = cite
    setErreur(null)
    setTexte('')
    setCite(null)
    startTransition(async () => {
      ajouter({
        id: `envoi-${Date.now()}`,
        texte: contenu,
        heure: new Intl.DateTimeFormat('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Guadeloupe',
        }).format(new Date()),
        deMoi: true,
        citation: citation
          ? {
              accessible: true,
              titre: citation.titre,
              detail: citation.detail,
              href: '#',
            }
          : null,
      })
      const r = await envoyerMessageAction({
        collegueId: collegue.id,
        texte: contenu,
        cite: citation ? { type: citation.type, id: citation.id } : null,
      })
      if (r.erreur) {
        // Le message ne part pas : on rend la saisie telle quelle, avec la raison.
        setErreur(r.erreur)
        setTexte(contenu)
        setCite(citation)
      }
    })
    champ.current?.focus()
  }

  return (
    <section aria-label={`Conversation avec ${collegue.nom}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-[4.5rem] shrink-0 items-center gap-3 border-b border-[#e3ecea] bg-white px-4 lg:px-6">
        <Link
          href="/tableau-de-bord/chat"
          className="-ml-1 grid size-9 place-items-center rounded-full text-[#387a70] hover:bg-[#f2f8f6] lg:hidden"
        >
          <ArrowLeft aria-hidden className="size-5" />
          <span className="sr-only">Retour aux collègues</span>
        </Link>
        <Avatar collegue={collegue} petit />
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">{collegue.nom}</h2>
          <p className="truncate text-[0.8125rem] text-muted-foreground">{collegue.role}</p>
        </div>
      </header>

      <div ref={fil} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6">
        {joursAffiches.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            Aucun message pour l’instant. Écrivez le premier ci-dessous.
          </p>
        ) : null}
        {joursAffiches.map((j) => (
          <div key={j.jour} className="flex flex-col gap-2.5">
            <p className="my-2 self-center rounded-full border border-[#e3ecea] bg-white px-3 py-0.5 text-xs font-semibold text-muted-foreground">
              {j.libelle}
            </p>
            {j.messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'max-w-[min(32.5rem,85%)] rounded-[1.125rem] px-3.5 py-2.5 text-[0.9375rem] leading-snug',
                  m.deMoi
                    ? 'self-end rounded-br-md bg-[#387a70] text-white'
                    : 'self-start rounded-bl-md border border-[#e3ecea] bg-white',
                )}
              >
                <p className="break-words whitespace-pre-wrap">{m.texte}</p>
                {m.citation ? <CarteCitation citation={m.citation} deMoi={m.deMoi} /> : null}
                <p
                  className={cn(
                    'mt-1 text-right text-[0.6875rem]',
                    m.deMoi ? 'text-white/75' : 'text-muted-foreground',
                  )}
                >
                  {m.heure}
                </p>
              </div>
            ))}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          envoyer()
        }}
        className="relative mx-3 mb-3 shrink-0 lg:mx-6 lg:mb-5"
      >
        {erreur ? (
          <p role="alert" className="mb-2 rounded-2xl bg-etat-erreur-fond px-4 py-2 text-sm text-etat-erreur">
            {erreur}
          </p>
        ) : null}
        {citer ? (
          <CiterPatient
            onFermer={() => setCiter(false)}
            onChoisir={(c) => {
              setCite(c)
              setCiter(false)
              champ.current?.focus()
            }}
          />
        ) : null}
        <div className="rounded-[1.375rem] border-[1.5px] border-[#dce6e3] bg-white focus-within:border-[#387a70]">
          {cite ? (
            <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border border-[#cfe4df] bg-[#f2f8f6] px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-heading text-[0.875rem] font-bold">{cite.titre}</span>
                <span className="block truncate text-[0.8125rem] text-muted-foreground">{cite.detail}</span>
              </span>
              <button
                type="button"
                onClick={() => setCite(null)}
                className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white"
              >
                <X aria-hidden className="size-4" />
                <span className="sr-only">Retirer la citation</span>
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2 py-2 pr-2 pl-4">
            <label htmlFor="message-chat" className="sr-only">
              Message à {collegue.nom}
            </label>
            <textarea
              ref={champ}
              id="message-chat"
              rows={1}
              value={texte}
              maxLength={2000}
              onChange={(e) => setTexte(e.target.value)}
              onKeyDown={(e) => {
                // Entrée envoie, Maj + Entrée passe à la ligne.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  envoyer()
                }
              }}
              placeholder={`Écrire à ${collegue.nom}…`}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[0.9375rem] outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
            <button
              type="button"
              aria-expanded={citer}
              onClick={() => setCiter((c) => !c)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#dde9e6] bg-white px-3 text-[0.8125rem] font-semibold hover:bg-[#f5f9f8]"
            >
              <Plus aria-hidden className="size-4" />
              <span className="hidden sm:inline">Citer un patient</span>
              <span className="sr-only sm:hidden">Citer un patient</span>
            </button>
            <button
              type="submit"
              disabled={!texte.trim()}
              className="bouton-principal inline-flex h-9 shrink-0 items-center gap-1.5 px-4 text-[0.8125rem] font-semibold disabled:opacity-50"
            >
              <SendHorizontal aria-hidden className="size-4 sm:hidden" />
              <span className="hidden sm:inline">Envoyer</span>
              <span className="sr-only sm:hidden">Envoyer</span>
            </button>
          </div>
        </div>
      </form>
    </section>
  )
}

export function Chat({
  conversations,
  ouverte,
}: {
  conversations: ConversationVue[]
  ouverte: { collegue: Collegue; jours: JourVue[]; aujourdhui: string } | null
}) {
  const avaitNonLus = ouverte
    ? (conversations.find((c) => c.collegue.id === ouverte.collegue.id)?.nonLus ?? 0) > 0
    : false
  return (
    // Hauteur de l'écran moins la barre du haut, et au téléphone la barre du bas : la conversation défile, pas la page.
    <div className="flex h-[calc(100dvh-8rem)] min-h-0 lg:h-[calc(100dvh-4rem)]">
      <ListeCollegues conversations={conversations} ouverteId={ouverte?.collegue.id ?? null} />
      {ouverte ? (
        <Conversation
          key={ouverte.collegue.id}
          collegue={ouverte.collegue}
          jours={ouverte.jours}
          aujourdhui={ouverte.aujourdhui}
          avaitNonLus={avaitNonLus}
        />
      ) : (
        <div className="hidden flex-1 place-items-center text-center text-muted-foreground lg:grid">
          <p>Choisissez un collègue pour lui écrire.</p>
        </div>
      )}
    </div>
  )
}
