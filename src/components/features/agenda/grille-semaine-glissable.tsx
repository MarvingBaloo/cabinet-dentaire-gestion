'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { formatHeureMinutesISO, jourEnCourt, jourLocal, minutesDepuisMinuit } from '@/lib/dates'
import {
  DEBUT_GRILLE,
  FIN_GRILLE,
  HAUTEUR_PAS_SEMAINE,
  PAS,
  colonneDepuisX,
  deltaMinutesDepuisPixels,
  depasseLeSeuil,
  deplacementClavier,
  deplacerEntreJours,
  pixelsDepuisPlage,
  repartirEnCouloirs,
  type PresenceGrille,
  type PresenceNommee,
  type VerdictDepot,
  lienNouveauRendezVous,
  minutesDepuisY,
  verdictDepot,
} from '@/lib/glisser-agenda'
import { DEPLACABLE_PAR_GLISSER, ESTOMPE, RAISON_FIGE } from '@/lib/statuts'
import { cn } from '@/lib/utils'
import { type EtatAgenda, deplacerRendezVousAction, revenirAvantDeplacementAction } from '@/server/actions/agenda'

import {
  APPUI_LONG_MS,
  type Bandeau,
  BandeauGeste,
  CLAVIER,
  MODE_EMPLOI_CLAVIER,
  useBlocageDefilement,
  useEssaiFige,
} from './bandeau-geste'
import { CarteRendezVousSemaine, type RendezVousSemaineVue } from './carte-rendez-vous-semaine'
import { ContenuRendezVous, classesRendezVous, fondRendezVous } from './habillage-rendez-vous'
import { attributsCarte, ouvrirAuClavier, rendreFocus, useFicheRendezVous, useStatutsAJour } from './panneau-rendez-vous'

// Couche interactive de la vue semaine : glisser une carte vers un autre jour
// et une autre heure, au pas de 15 minutes. Même montage que la vue jour
// (`grille-jour-glissable.tsx`) : un seul geste à la fois, état partagé entre
// colonnes, Échap annule. Le lâcher appelle `deplacerRendezVousAction` avec le
// fauteuil où le praticien se trouve le jour visé (23/10 : jusque-là le fauteuil
// d'origine, refusé dès que le praticien changeait de fauteuil d'un jour à l'autre).
// Le 23/10 aussi, comme la vue jour : la carte suit le pointeur, une place interdite
// se voit pendant le geste, un bandeau confirme avec « Annuler », appui long au doigt.
//
// Le 24/10 : au clavier aussi — les flèches sur la carte qui a le focus (← → le jour, ↑ ↓ l'heure), Entrée valide,
// Échap annule ; une carte figée dit pourquoi elle ne bouge pas. Le formulaire « Décaler à » de la fiche reste le
// moyen de déplacer un rendez-vous figé.

type Geste = {
  id: string
  pointerId: number
  startX: number
  startY: number
  col0Left: number
  colWidth: number
  debutOrigine: number
  finOrigine: number
  colonneOrigine: number
  aFranchiSeuil: boolean
  candidateColonne: number
  candidateDebut: number
  candidateFin: number
  phase: 'glisse' | 'envoi'
  verdict: VerdictDepot
}

export function GrilleSemaineGlissable({
  jours,
  rendezVous: rendezVousRecus,
  consolide,
  peutDeplacer,
  peutCreer = false,
  presences = [],
  occupation = [],
  siteId = null,
  aujourdHui,
  hauteur,
}: {
  jours: string[]
  rendezVous: RendezVousSemaineVue[]
  consolide: boolean
  peutDeplacer: boolean
  peutCreer?: boolean
  presences?: PresenceGrille[]
  occupation?: PresenceNommee[]
  siteId?: string | null
  aujourdHui: string
  hauteur: number
}) {
  const router = useRouter()
  const { ouvrir, selection } = useFicheRendezVous()
  const rendezVous = useStatutsAJour(rendezVousRecus)
  const vientDeGlisser = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const gesteRef = useRef<Geste | null>(null)
  const [geste, setGeste] = useState<Geste | null>(null)
  const [enVol, setEnVol] = useState(false)
  const [bandeau, setBandeau] = useState<Bandeau | null>(null)
  const fermerBandeau = useCallback(() => setBandeau(null), [])
  const essai = useEssaiFige(setBandeau)
  const refocaliser = useRef<string | null>(null)
  const attente = useRef<{ timer: number; pointerId: number; x: number; y: number } | null>(null)
  useBlocageDefilement(containerRef, () => gesteRef.current?.phase === 'glisse')
  // La case survolée, pour le repère « + 10:15 » : un clic à cet endroit y crée le rendez-vous.
  const [survol, setSurvol] = useState<{ colonne: number; minutes: number } | null>(null)

  const definirGeste = useCallback((suivant: Geste | null) => {
    gesteRef.current = suivant
    setGeste(suivant)
  }, [])

  // Rafraîchie : les rendez-vous du serveur sont arrivés, l'aperçu figé après un déplacement réussi s'efface.
  const avantRafraichissement = useRef<typeof rendezVousRecus | null>(null)
  useEffect(() => {
    if (avantRafraichissement.current && rendezVousRecus !== avantRafraichissement.current) {
      avantRafraichissement.current = null
      definirGeste(null)
    }
    if (refocaliser.current) {
      rendreFocus(refocaliser.current)
      refocaliser.current = null
    }
  }, [rendezVousRecus, definirGeste])
  useEffect(() => {
    if (geste?.phase !== 'envoi' || enVol) return
    const t = setTimeout(() => definirGeste(null), 5000)
    return () => clearTimeout(t)
  }, [geste, enVol, definirGeste])

  useEffect(() => {
    if (!geste || geste.phase !== 'glisse' || !geste.aFranchiSeuil) return
    // À la capture, et la touche marquée prise : la fiche ouverte, qui se ferme elle aussi sur Échap, reste ouverte.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      definirGeste(null)
      setBandeau(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [geste, definirGeste])


  const parJour = useMemo(
    () =>
      jours.map((jour) => {
        const duJour = rendezVous.filter((r) => jourLocal(r.debut) === jour)
        const couloirs = repartirEnCouloirs(
          duJour.map((r) => ({
            debut: minutesDepuisMinuit(r.debut, jour),
            fin: minutesDepuisMinuit(r.fin, jour),
          })),
        )
        return duJour.map((rdv, i) => ({ rdv, ...couloirs[i]! }))
      }),
    [jours, rendezVous],
  )

  const places = useMemo(
    () =>
      rendezVous.map((r) => {
        const jour = jourLocal(r.debut)
        return {
          id: r.id,
          praticienId: r.praticien.id,
          fauteuilId: r.fauteuil.id,
          jour,
          debut: minutesDepuisMinuit(r.debut, jour),
          fin: minutesDepuisMinuit(r.fin, jour),
          libere: ESTOMPE.includes(r.statut),
          patient: `${r.patient.prenom} ${r.patient.nom}`,
        }
      }),
    [rendezVous],
  )
  const rdvEnGeste = geste ? rendezVous.find((r) => r.id === geste.id) : undefined

  function verdictPour(rdv: RendezVousSemaineVue, colonne: number, debut: number, fin: number): VerdictDepot {
    return verdictDepot(
      {
        id: rdv.id,
        praticienId: rdv.praticien.id,
        praticienNom: rdv.praticien.nom,
        jour: jours[colonne]!,
        debut,
        fin,
        fauteuilId: null,
        exception: Boolean(rdv.surbooking || rdv.horsHoraire || rdv.motif.estUrgence),
      },
      occupation,
      places,
    )
  }

  function annulerAttente() {
    if (attente.current) window.clearTimeout(attente.current.timer)
    attente.current = null
  }

  function demarrer(e: React.PointerEvent<HTMLElement>, rdv: RendezVousSemaineVue, colonne: number, jour: string) {
    if (gesteRef.current || enVol) return
    if (!peutDeplacer || !DEPLACABLE_PAR_GLISSER.includes(rdv.statut)) return
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const cible = e.currentTarget
    const { pointerId, clientX, clientY } = e
    // Au doigt, un appui long : un appui bref reste un toucher (la fiche s'ouvre), un glissement rapide fait défiler.
    if (e.pointerType === 'touch') {
      annulerAttente()
      attente.current = {
        pointerId,
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          attente.current = null
          if (lancer(cible, pointerId, clientX, clientY, rdv, colonne, jour)) navigator.vibrate?.(12)
        }, APPUI_LONG_MS),
      }
      return
    }
    lancer(cible, pointerId, clientX, clientY, rdv, colonne, jour)
  }

  function lancer(
    cible: HTMLElement,
    pointerId: number,
    x: number,
    y: number,
    rdv: RendezVousSemaineVue,
    colonne: number,
    jour: string,
  ) {
    const premiere = containerRef.current?.querySelector<HTMLElement>('[data-jour-index="0"]')
    const rect = premiere?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return false

    const debut = minutesDepuisMinuit(rdv.debut, jour)
    const fin = minutesDepuisMinuit(rdv.fin, jour)

    try {
      cible.setPointerCapture(pointerId)
    } catch {
      return false
    }
    setBandeau(null)
    definirGeste({
      id: rdv.id,
      pointerId,
      startX: x,
      startY: y,
      col0Left: rect.left,
      colWidth: rect.width,
      debutOrigine: debut,
      finOrigine: fin,
      colonneOrigine: colonne,
      aFranchiSeuil: false,
      candidateColonne: colonne,
      candidateDebut: debut,
      candidateFin: fin,
      phase: 'glisse',
      verdict: { ok: true, fauteuilId: rdv.fauteuil.id },
    })
    return true
  }

  function bouger(e: React.PointerEvent<HTMLElement>) {
    const a = attente.current
    if (a && a.pointerId === e.pointerId && depasseLeSeuil(e.clientX - a.x, e.clientY - a.y, 8)) annulerAttente()
    const g = gesteRef.current
    if (!g || g.pointerId !== e.pointerId || g.phase !== 'glisse') return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (!g.aFranchiSeuil && !depasseLeSeuil(dx, dy)) return
    e.preventDefault()

    const delta = deltaMinutesDepuisPixels(dy, HAUTEUR_PAS_SEMAINE)
    const visee = colonneDepuisX(e.clientX - g.col0Left, g.colWidth, jours.length)
    const r = deplacerEntreJours({ debut: g.debutOrigine, fin: g.finOrigine }, g.candidateColonne, delta, visee)
    const rdv = rendezVous.find((x) => x.id === g.id)
    definirGeste({
      ...g,
      aFranchiSeuil: true,
      candidateColonne: r.colonne,
      candidateDebut: r.debut,
      candidateFin: r.fin,
      verdict: rdv ? verdictPour(rdv, r.colonne, r.debut, r.fin) : g.verdict,
    })
  }

  async function lacher(e: React.PointerEvent<HTMLElement>, rdv: RendezVousSemaineVue) {
    if (attente.current?.pointerId === e.pointerId) {
      annulerAttente()
      return
    }
    const g = gesteRef.current
    if (!g || g.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)

    if (g.aFranchiSeuil) vientDeGlisser.current = true
    if (!g.aFranchiSeuil) {
      definirGeste(null)
      return
    }
    await envoyer(g, rdv)
  }

  /** Le lâcher, à la souris, au doigt ou par Entrée au clavier : refusé sur place, ou envoyé au serveur. */
  async function envoyer(g: Geste, rdv: RendezVousSemaineVue) {
    if (g.candidateColonne === g.colonneOrigine && g.candidateDebut === g.debutOrigine && g.candidateFin === g.finOrigine) {
      definirGeste(null)
      if (g.pointerId === CLAVIER) setBandeau(null)
      return
    }
    if (!g.verdict.ok) {
      setBandeau({ ton: 'erreur', message: g.verdict.raison })
      definirGeste(null)
      return
    }

    definirGeste({ ...g, phase: 'envoi' })
    setEnVol(true)

    const jourVise = jours[g.candidateColonne] ?? jours[g.colonneOrigine]!
    const donnees = new FormData()
    donnees.set('id', g.id)
    donnees.set('jour', jourVise)
    donnees.set('heure', formatHeureMinutesISO(g.candidateDebut))
    donnees.set('dureeMinutes', String(g.candidateFin - g.candidateDebut))
    donnees.set('fauteuilId', g.verdict.fauteuilId ?? rdv.fauteuil.id)

    try {
      const resultat = await deplacerRendezVousAction({} as EtatAgenda, donnees)
      if (resultat.erreur) setBandeau({ ton: 'erreur', message: resultat.erreur })
      else {
        avantRafraichissement.current = rendezVousRecus
        if (g.pointerId === CLAVIER) refocaliser.current = g.id
        const prevenu = rdv.statut === 'A_CONFIRMER' || rdv.statut === 'CONFIRME'
        setBandeau({
          ton: 'info',
          message: `${rdv.patient.prenom} ${rdv.patient.nom} : ${jourEnCourt(jourVise)} à ${formatHeureMinutesISO(g.candidateDebut)}${prevenu ? ' — le patient sera prévenu par SMS dans 5 minutes.' : '.'}`,
          action: { libelle: 'Annuler', faire: () => void revenir(rdv, g) },
        })
        router.refresh()
      }
      if (resultat.erreur) definirGeste(null)
    } catch {
      setBandeau({ ton: 'erreur', message: 'Le déplacement a échoué. Réessayez.' })
      definirGeste(null)
    } finally {
      // Réussi : la carte reste à sa nouvelle place jusqu'à l'état du serveur (effet « rafraîchie »).
      setEnVol(false)
    }
  }

  /** Le rendez-vous revient à sa place d'avant, sans SMS (le service vérifie que c'est bien ce retour-là). */
  async function revenir(rdv: RendezVousSemaineVue, g: Geste) {
    avantRafraichissement.current = null
    definirGeste(null)
    const donnees = new FormData()
    donnees.set('id', rdv.id)
    donnees.set('jour', jours[g.colonneOrigine]!)
    donnees.set('heure', formatHeureMinutesISO(g.debutOrigine))
    donnees.set('dureeMinutes', String(g.finOrigine - g.debutOrigine))
    donnees.set('fauteuilId', rdv.fauteuil.id)
    const resultat = await revenirAvantDeplacementAction(donnees)
    setBandeau(resultat.erreur ? { ton: 'erreur', message: resultat.erreur } : { ton: 'info', message: 'Déplacement annulé.' })
    router.refresh()
  }

  /** Une touche sur la carte qui a le focus : les flèches la déplacent, Entrée valide (Échap : voir plus haut). */
  function toucheCarte(e: React.KeyboardEvent<HTMLElement>, rdv: RendezVousSemaineVue, eligible: boolean): boolean {
    if (e.altKey || e.metaKey || e.ctrlKey) return false
    const g = gesteRef.current
    if (g && g.pointerId === CLAVIER && g.id === rdv.id && g.phase === 'glisse') {
      if (e.key === 'Enter') {
        void envoyer(g, rdv)
        return true
      }
      const visee = deplacementClavier(
        e.key,
        e.shiftKey,
        { colonne: g.candidateColonne, debut: g.candidateDebut, fin: g.candidateFin },
        jours.length,
      )
      if (!visee) return false
      definirGeste({
        ...g,
        candidateColonne: visee.colonne,
        candidateDebut: visee.debut,
        candidateFin: visee.fin,
        verdict: verdictPour(rdv, visee.colonne, visee.debut, visee.fin),
      })
      return true
    }
    if (!peutDeplacer || gesteRef.current || enVol || !e.key.startsWith('Arrow')) return false
    if (!eligible) {
      setBandeau({ ton: 'erreur', message: RAISON_FIGE[rdv.statut] ?? 'Ce rendez-vous ne se déplace pas.' })
      return true
    }
    const jour = jourLocal(rdv.debut)
    const colonne = jours.indexOf(jour)
    if (colonne === -1) return false
    const debut = minutesDepuisMinuit(rdv.debut, jour)
    const fin = minutesDepuisMinuit(rdv.fin, jour)
    const visee = deplacementClavier(e.key, e.shiftKey, { colonne, debut, fin }, jours.length)
    if (!visee) return false
    setBandeau(MODE_EMPLOI_CLAVIER)
    definirGeste({
      id: rdv.id,
      pointerId: CLAVIER,
      startX: 0,
      startY: 0,
      col0Left: 0,
      colWidth: 0,
      debutOrigine: debut,
      finOrigine: fin,
      colonneOrigine: colonne,
      aFranchiSeuil: true,
      candidateColonne: visee.colonne,
      candidateDebut: visee.debut,
      candidateFin: visee.fin,
      phase: 'glisse',
      verdict: verdictPour(rdv, visee.colonne, visee.debut, visee.fin),
    })
    return true
  }

  /** La carte perd le focus en plein déplacement au clavier : il est abandonné, comme sur Échap. */
  function quitterCarte(rdv: RendezVousSemaineVue) {
    const g = gesteRef.current
    if (g?.pointerId === CLAVIER && g.id === rdv.id && g.phase === 'glisse') {
      definirGeste(null)
      setBandeau(null)
    }
  }

  return (
    <>
      <BandeauGeste bandeau={bandeau} fermer={fermerBandeau} />

      <div
        ref={containerRef}
        className="grid"
        style={{ gridTemplateColumns: `repeat(${jours.length}, minmax(9rem, 1fr))`, height: hauteur }}
      >
        {jours.map((jour, colonne) => {
          const apercu = geste && geste.aFranchiSeuil && geste.candidateColonne === colonne ? geste : null
          return (
            <div
              key={jour}
              data-jour-index={colonne}
              className={cn(
                'relative border-l border-border/50',
                jour === aujourdHui && 'bg-[#f2f8f6]',
                peutCreer && 'cursor-pointer',
              )}
              style={{ height: hauteur }}
              // Les cartes arrêtent leur clic : ce qui arrive ici est un clic sur une case vide.
              onClick={
                peutCreer
                  ? (e) => {
                      const minutes = minutesDepuisY(
                        e.clientY - e.currentTarget.getBoundingClientRect().top,
                        HAUTEUR_PAS_SEMAINE,
                      )
                      router.push(lienNouveauRendezVous({ jour, minutes, presences, siteId }))
                    }
                  : undefined
              }
              onMouseMove={
                peutCreer
                  ? (e) => {
                      if (geste || (e.target as HTMLElement).closest('article')) return setSurvol(null)
                      const minutes = minutesDepuisY(
                        e.clientY - e.currentTarget.getBoundingClientRect().top,
                        HAUTEUR_PAS_SEMAINE,
                      )
                      if (survol?.colonne !== colonne || survol.minutes !== minutes) setSurvol({ colonne, minutes })
                    }
                  : undefined
              }
              onMouseLeave={peutCreer ? () => setSurvol(null) : undefined}
            >
              {survol?.colonne === colonne && !geste ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute right-0.5 left-0.5 border border-dashed border-primary/60 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary"
                  style={{
                    top: ((survol.minutes - DEBUT_GRILLE) / PAS) * HAUTEUR_PAS_SEMAINE,
                    height: HAUTEUR_PAS_SEMAINE * 2,
                  }}
                >
                  + {formatHeureMinutesISO(survol.minutes)}
                </div>
              ) : null}
              {parJour[colonne]!.map(({ rdv, couloir, couloirs }) => {
                const debut = minutesDepuisMinuit(rdv.debut, jour)
                const fin = minutesDepuisMinuit(rdv.fin, jour)
                const haut = ((Math.max(debut, DEBUT_GRILLE) - DEBUT_GRILLE) / PAS) * HAUTEUR_PAS_SEMAINE
                const bas = ((Math.min(fin, FIN_GRILLE) - DEBUT_GRILLE) / PAS) * HAUTEUR_PAS_SEMAINE
                if (bas <= 0 || haut >= hauteur) return null
                const h = Math.max(bas - haut, 20)
                const eligible = peutDeplacer && DEPLACABLE_PAR_GLISSER.includes(rdv.statut)
                // Figée : elle ne se glisse pas, et le dit au survol et quand on essaie (`useEssaiFige`).
                const fige = peutDeplacer && !eligible

                return (
                  <CarteRendezVousSemaine
                    key={rdv.id}
                    rdv={rdv}
                    hauteur={h}
                    consolide={consolide}
                    {...attributsCarte(rdv.id, ouvrir)}
                    onKeyDown={(e) => {
                      if (!toucheCarte(e, rdv, eligible)) return ouvrirAuClavier(e, rdv.id, ouvrir)
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onBlur={() => quitterCarte(rdv)}
                    title={fige ? RAISON_FIGE[rdv.statut] : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const apresEssai = essai.clicApresEssai()
                      if (vientDeGlisser.current || apresEssai) {
                        vientDeGlisser.current = false
                        return
                      }
                      ouvrir(rdv.id)
                    }}
                    onPointerDown={eligible ? (e) => demarrer(e, rdv, colonne, jour) : fige ? (e) => essai.appui(e, rdv.id) : undefined}
                    onPointerMove={eligible ? bouger : fige ? (e) => essai.glisse(e, rdv.id, rdv.statut) : undefined}
                    onPointerUp={eligible ? (e) => void lacher(e, rdv) : fige ? (e) => essai.lache(e) : undefined}
                    onPointerCancel={
                      eligible
                        ? () => {
                            annulerAttente()
                            definirGeste(null)
                          }
                        : fige
                          ? () => essai.abandon()
                          : undefined
                    }
                    onContextMenu={eligible ? (e) => (attente.current || gesteRef.current) && e.preventDefault() : undefined}
                    className={cn(
                      '[-webkit-touch-callout:none]',
                      eligible ? 'cursor-grab active:cursor-grabbing' : essai.refuse === rdv.id ? 'cursor-not-allowed' : 'cursor-pointer',
                      // Sa place d'origine reste marquée pendant que la carte voyage.
                      geste?.id === rdv.id && geste.aFranchiSeuil && 'opacity-40 outline-2 outline-offset-[-2px] outline-dashed',
                      selection === rdv.id && 'ring-2 ring-primary',
                      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                    )}
                    style={{
                      top: haut,
                      left: `calc(${(couloir / couloirs) * 100}% + 2px)`,
                      width: `calc(${100 / couloirs}% - 4px)`,
                      outlineColor: rdv.praticien.couleur,
                    }}
                  />
                )
              })}

              {apercu && rdvEnGeste
                ? (() => {
                    const pix = pixelsDepuisPlage(
                      { debut: apercu.candidateDebut, fin: apercu.candidateFin },
                      DEBUT_GRILLE,
                      PAS,
                      HAUTEUR_PAS_SEMAINE,
                    )
                    const hauteurFantome = Math.max(pix.hauteur, 20)
                    const ok = apercu.verdict.ok
                    return (
                      <>
                        {/* La carte elle-même, au jour et à l'heure visés ; rouge si la place est interdite. */}
                        <div
                          aria-hidden
                          className={cn(
                            classesRendezVous(rdvEnGeste.statut, false),
                            'pointer-events-none right-0.5 left-0.5 z-20 px-2 shadow-xl ring-2',
                            ok ? 'ring-white/80' : 'ring-etat-erreur',
                          )}
                          style={{
                            top: pix.top,
                            height: hauteurFantome,
                            ...(ok ? fondRendezVous(rdvEnGeste.praticien.couleur, rdvEnGeste.statut) : { backgroundColor: '#FBEAE8' }),
                          }}
                        >
                          <ContenuRendezVous
                            debut={formatHeureMinutesISO(apercu.candidateDebut)}
                            fin={formatHeureMinutesISO(apercu.candidateFin)}
                            prenom={rdvEnGeste.patient.prenom}
                            nom={rdvEnGeste.patient.nom}
                            motif={rdvEnGeste.motif.libelle}
                            statut={rdvEnGeste.statut}
                            couleur={ok ? rdvEnGeste.praticien.couleur : '#B42318'}
                            hauteur={hauteurFantome}
                            urgence={false}
                          />
                        </div>
                        {!apercu.verdict.ok ? (
                          <p
                            aria-hidden
                            className="pointer-events-none absolute right-0.5 left-0.5 z-30 rounded-xl bg-etat-erreur px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg"
                            style={{ top: pix.top + hauteurFantome + 4 }}
                          >
                            {apercu.verdict.raison}
                          </p>
                        ) : null}
                      </>
                    )
                  })()
                : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
