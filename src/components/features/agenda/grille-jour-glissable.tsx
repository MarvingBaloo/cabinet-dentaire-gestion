'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { formatHeureMinutesISO, minutesDepuisMinuit } from '@/lib/dates'
import {
  DEBUT_GRILLE,
  FIN_GRILLE,
  HAUTEUR_LIGNE,
  HAUTEUR_PAS,
  PAS,
  colonneDepuisX,
  deltaMinutesDepuisPixels,
  depasseLeSeuil,
  deplacementClavier,
  deplacerPlage,
  pixelsDepuisPlage,
  redimensionnerFin,
  type PresenceGrille,
  type PresenceNommee,
  type VerdictDepot,
  lienNouveauRendezVous,
  minutesDepuisY,
  repartirEnCouloirs,
  verdictDepot,
} from '@/lib/glisser-agenda'
import { niveauRetenu } from '@/lib/niveaux-urgence'
import { DEPLACABLE_PAR_GLISSER, ESTOMPE, LIBELLE_STATUT, RAISON_FIGE } from '@/lib/statuts'
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
import type { FauteuilVue, RendezVousVue } from './grille-jour'
import { ContenuRendezVous, classesRendezVous, fondRendezVous } from './habillage-rendez-vous'
import { attributsCarte, ouvrirAuClavier, rendreFocus, useFicheRendezVous, useStatutsAJour } from './panneau-rendez-vous'

// Couche interactive de la vue jour (lot 6) : glisser-déposer pour changer
// heure/fauteuil, poignée basse pour redimensionner (changer la fin).
//
// Volontairement UN SEUL composant client, plutôt qu'un composant par bloc :
// le geste en cours (au plus un à la fois) et le message d'erreur sont un état
// partagé entre toutes les colonnes — un contexte React ou des composants
// séparés n'auraient fait que déplacer cette coordination ailleurs, pour le
// même résultat. `grille-jour.tsx` (serveur) reste responsable de l'en-tête,
// de la colonne des heures et de la mise en page qui ne bouge jamais ; il ne
// délègue à ce composant que les colonnes de fauteuils, dans une cellule de
// grille qui les couvre toutes (`gridColumn: 2 / span n`), avec une grille
// imbriquée aux MÊMES largeurs de colonnes — c'est ce qui permet à ce
// composant de mesurer et de repositionner sans jamais désaligner l'en-tête
// ni la colonne des heures.
//
// Le 23/10 : la carte elle-même suit le pointeur ; une place interdite se voit pendant le geste, en rouge et avec
// sa raison (`verdictDepot`), et le lâcher y est refusé sans appel au serveur ; un bandeau confirme le déplacement
// avec « Annuler » ; au doigt, le geste démarre après un appui long ; la poignée de durée se montre au survol.
//
// Le 24/10 : le même déplacement au clavier — une flèche sur la carte qui a le focus fait apparaître la carte
// fantôme, Entrée valide, Échap annule (`deplacementClavier`) ; et une carte figée dit pourquoi elle ne bouge pas.
//
// Ce que ce composant NE remplace PAS : `DerouleJour` reste la version conforme
// RGAA de la même journée, et le formulaire « Déplacer » de la fiche du
// rendez-vous (`panneau-rendez-vous.tsx`) reste le moyen de déplacer un rendez-vous figé.

type Mode = 'deplacer' | 'redimensionner'

type Geste = {
  id: string
  mode: Mode
  pointerId: number
  startX: number
  startY: number
  /** Bord gauche et largeur de la première colonne de fauteuil, mesurés au
   *  début du geste : point de repère pour `colonneDepuisX` (D11 — le
   *  fauteuil reste déduit côté serveur, ce repère ne sert qu'à choisir QUEL
   *  fauteuil demander). */
  col0Left: number
  colWidth: number
  debutOrigine: number
  finOrigine: number
  fauteuilIndexOrigine: number
  /** Faux tant que le seuil de quelques pixels n'est pas franchi : en dessous,
   *  c'est un clic, pas un glisser. */
  aFranchiSeuil: boolean
  candidateDebut: number
  candidateFin: number
  candidateFauteuilIndex: number
  /** 'glisse' pendant le geste, 'envoi' entre le lâcher et la réponse du
   *  serveur — l'aperçu reste affiché figé le temps de la réponse. */
  phase: 'glisse' | 'envoi'
  /** La place visée est-elle permise ? Recalculé à chaque mouvement. */
  verdict: VerdictDepot
}

export function GrilleJourGlissable({
  jour,
  fauteuils,
  rendezVous: rendezVousRecus,
  hauteur,
  lignes,
  peutDeplacer,
  peutCreer = false,
  presences = [],
  occupation = [],
}: {
  jour: string
  fauteuils: FauteuilVue[]
  rendezVous: RendezVousVue[]
  hauteur: number
  lignes: number[]
  /** Vient du serveur (`hasPermission(ctx, 'agenda', 'update')`) — jamais
   *  deviné côté client : un compte sans le droit ne voit même pas le geste
   *  s'amorcer. */
  peutDeplacer: boolean
  /** Un clic sur une case vide ouvre « Nouveau rendez-vous » pré-rempli (19/10). */
  peutCreer?: boolean
  presences?: PresenceGrille[]
  /** Toutes les présences du jour, praticiens décochés compris, nommées : pour dire pendant le geste à qui est un
   *  fauteuil, ou quand le praticien est là. */
  occupation?: PresenceNommee[]
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
  // La carte déplacée au clavier reprend le focus à sa nouvelle place, une fois la grille redessinée.
  const refocaliser = useRef<string | null>(null)
  // Au doigt : l'appui en cours, avant que le geste ne démarre (voir `APPUI_LONG_MS`).
  const attente = useRef<{ timer: number; pointerId: number; x: number; y: number } | null>(null)
  useBlocageDefilement(containerRef, () => gesteRef.current?.phase === 'glisse')

  // Les rendez-vous de la journée, tels que les voit `verdictDepot`.
  const places = useMemo(
    () =>
      rendezVous.map((r) => ({
        id: r.id,
        praticienId: r.praticien.id,
        fauteuilId: r.fauteuil.id,
        jour,
        debut: minutesDepuisMinuit(r.debut, jour),
        fin: minutesDepuisMinuit(r.fin, jour),
        libere: ESTOMPE.includes(r.statut),
        patient: `${r.patient.prenom} ${r.patient.nom}`,
      })),
    [rendezVous, jour],
  )
  const rdvEnGeste = geste ? rendezVous.find((r) => r.id === geste.id) : undefined

  function verdictPour(rdv: RendezVousVue, debut: number, fin: number, fauteuilIndex: number): VerdictDepot {
    return verdictDepot(
      {
        id: rdv.id,
        praticienId: rdv.praticien.id,
        praticienNom: rdv.praticien.nom,
        jour,
        debut,
        fin,
        fauteuilId: fauteuils[fauteuilIndex]?.id ?? null,
        exception: rdv.surbooking || rdv.horsHoraire || rdv.motif.estUrgence,
      },
      occupation,
      places,
    )
  }

  function annulerAttente() {
    if (attente.current) window.clearTimeout(attente.current.timer)
    attente.current = null
  }
  // La case survolée, pour le repère « + 10:15 » : un clic à cet endroit y crée le rendez-vous.
  const [survol, setSurvol] = useState<{ index: number; minutes: number } | null>(null)

  /** Écrit `gesteRef` ET l'état d'un coup, TOUJOURS de façon synchrone dans le
   *  gestionnaire d'événement appelant — jamais via l'updater de `setGeste`.
   *  React peut exécuter un updater plus tard (pendant le rendu) ou deux fois
   *  (StrictMode) : `gesteRef.current` doit refléter le geste réel au moment
   *  même où l'événement pointeur est traité, sinon `lacher` peut lire une
   *  valeur périmée au `pointerup`. */
  const definirGeste = useCallback((suivant: Geste | null) => {
    gesteRef.current = suivant
    setGeste(suivant)
  }, [])

  // Rafraîchie : les rendez-vous du serveur sont arrivés, l'aperçu figé après un déplacement réussi s'efface. Au
  // pire au bout de cinq secondes, si le rafraîchissement n'apporte rien de neuf.
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

  // Échap annule le geste en cours — jamais celui d'un formulaire ordinaire :
  // l'écouteur n'existe que pendant un glisser effectif. Posé à la capture, et la touche marquée prise : la fiche
  // ouverte, qui se ferme elle aussi sur Échap, reste ouverte.
  useEffect(() => {
    if (!geste || geste.phase !== 'glisse' || !geste.aFranchiSeuil) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      definirGeste(null)
      setBandeau(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [geste, definirGeste])

  function demarrer(e: React.PointerEvent<HTMLElement>, rdv: RendezVousVue, mode: Mode) {
    // Un seul geste à la fois — y compris pendant l'attente de la réponse
    // du serveur (`gesteRef.current` reste non nul en phase 'envoi'). Lu sur
    // la ref, jamais sur l'état : au pointerdown suivant un pointerup très
    // rapproché, l'état peut ne pas encore avoir rendu le dernier geste.
    if (gesteRef.current || enVol) return
    if (!peutDeplacer) return
    if (!DEPLACABLE_PAR_GLISSER.includes(rdv.statut)) return
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
          if (lancer(cible, pointerId, clientX, clientY, rdv, mode)) navigator.vibrate?.(12)
        }, APPUI_LONG_MS),
      }
      return
    }
    lancer(cible, pointerId, clientX, clientY, rdv, mode)
  }

  function lancer(cible: HTMLElement, pointerId: number, x: number, y: number, rdv: RendezVousVue, mode: Mode) {
    const conteneur = containerRef.current
    if (!conteneur) return false
    const premiere = conteneur.querySelector<HTMLElement>('[data-fauteuil-index="0"]')
    const rect = premiere?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return false

    const index = fauteuils.findIndex((f) => f.id === rdv.fauteuil.id)
    if (index === -1) return false

    const debutMin = minutesDepuisMinuit(rdv.debut, jour)
    const finMin = minutesDepuisMinuit(rdv.fin, jour)

    try {
      cible.setPointerCapture(pointerId)
    } catch {
      // Le doigt a été levé pendant l'appui long : rien à capturer, rien à lancer.
      return false
    }
    setBandeau(null)
    definirGeste({
      id: rdv.id,
      mode,
      pointerId,
      startX: x,
      startY: y,
      col0Left: rect.left,
      colWidth: rect.width,
      debutOrigine: debutMin,
      finOrigine: finMin,
      fauteuilIndexOrigine: index,
      aFranchiSeuil: false,
      candidateDebut: debutMin,
      candidateFin: finMin,
      candidateFauteuilIndex: index,
      phase: 'glisse',
      verdict: { ok: true, fauteuilId: rdv.fauteuil.id },
    })
    return true
  }

  // Calcul SYNCHRONE à partir de `gesteRef.current`, et `preventDefault` posé
  // ici même : au pointermove suivant, pas dans un updater `setGeste` que
  // React peut rejouer plus tard (rendu différé) ou deux fois (StrictMode),
  // ce qui rendrait le `preventDefault` trop tardif pour empêcher la
  // sélection de texte / le défilement tactile.
  function bouger(e: React.PointerEvent<HTMLElement>) {
    const a = attente.current
    if (a && a.pointerId === e.pointerId && depasseLeSeuil(e.clientX - a.x, e.clientY - a.y, 8)) annulerAttente()
    const g = gesteRef.current
    if (!g || g.pointerId !== e.pointerId || g.phase !== 'glisse') return
    const deltaXTotal = e.clientX - g.startX
    const deltaYTotal = e.clientY - g.startY
    if (!g.aFranchiSeuil && !depasseLeSeuil(deltaXTotal, deltaYTotal)) return
    e.preventDefault()

    const deltaMin = deltaMinutesDepuisPixels(deltaYTotal)

    let suivant: Geste
    if (g.mode === 'deplacer') {
      const plage = deplacerPlage({ debut: g.debutOrigine, fin: g.finOrigine }, deltaMin)
      const colIndex = colonneDepuisX(e.clientX - g.col0Left, g.colWidth, fauteuils.length)
      suivant = {
        ...g,
        aFranchiSeuil: true,
        candidateDebut: plage.debut,
        candidateFin: plage.fin,
        candidateFauteuilIndex: colIndex ?? g.candidateFauteuilIndex,
      }
    } else {
      const fin = redimensionnerFin({ debut: g.debutOrigine, fin: g.finOrigine }, deltaMin)
      suivant = { ...g, aFranchiSeuil: true, candidateFin: fin }
    }
    const rdv = rendezVous.find((r) => r.id === g.id)
    if (rdv) suivant.verdict = verdictPour(rdv, suivant.candidateDebut, suivant.candidateFin, suivant.candidateFauteuilIndex)
    definirGeste(suivant)
  }

  async function lacher(e: React.PointerEvent<HTMLElement>) {
    // Doigt levé avant la fin de l'appui long : un simple toucher, la fiche s'ouvre au clic qui suit.
    if (attente.current?.pointerId === e.pointerId) {
      annulerAttente()
      return
    }
    const g = gesteRef.current
    if (!g || g.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    if (!g.aFranchiSeuil) {
      // Un simple clic : rien à envoyer, et rien sur le bloc ne doit
      // intercepter les événements clavier ou le comportement par défaut.
      definirGeste(null)
      return
    }
    // Un vrai glisser : le clic qui suit le lâcher n'ouvre pas la fiche.
    vientDeGlisser.current = true
    await envoyer(g)
  }

  /** Le lâcher, à la souris, au doigt ou par Entrée au clavier : refusé sur place, ou envoyé au serveur. */
  async function envoyer(g: Geste) {
    const rienNaChange =
      g.candidateDebut === g.debutOrigine &&
      g.candidateFin === g.finOrigine &&
      g.candidateFauteuilIndex === g.fauteuilIndexOrigine
    if (rienNaChange) {
      definirGeste(null)
      if (g.pointerId === CLAVIER) setBandeau(null)
      return
    }
    // Place interdite : refusée ici, avec la raison déjà affichée pendant le geste — le serveur n'est pas sollicité.
    if (!g.verdict.ok) {
      setBandeau({ ton: 'erreur', message: g.verdict.raison })
      definirGeste(null)
      return
    }

    definirGeste({ ...g, phase: 'envoi' })
    setEnVol(true)

    const rdv = rendezVous.find((r) => r.id === g.id)
    const fauteuilCible = fauteuils[g.candidateFauteuilIndex] ?? fauteuils[g.fauteuilIndexOrigine]
    const donnees = new FormData()
    donnees.set('id', g.id)
    donnees.set('jour', jour)
    donnees.set('heure', formatHeureMinutesISO(g.candidateDebut))
    donnees.set('dureeMinutes', String(g.candidateFin - g.candidateDebut))
    if (fauteuilCible) donnees.set('fauteuilId', fauteuilCible.id)

    try {
      const resultat = await deplacerRendezVousAction({} as EtatAgenda, donnees)
      if (resultat.erreur) {
        // Refusé : le bloc revient EXACTEMENT à sa place d'origine — on efface
        // simplement l'aperçu, et le rendu retombe sur les props serveur,
        // jamais touchées puisque rien n'a été écrit.
        setBandeau({ ton: 'erreur', message: resultat.erreur })
        definirGeste(null)
      } else {
        // La carte reste à sa nouvelle place jusqu'à ce que la grille reçoive l'état du serveur (voir l'effet
        // « rafraîchie ») : sans quoi elle revient un instant à l'ancienne, le temps du rafraîchissement.
        avantRafraichissement.current = rendezVousRecus
        if (g.pointerId === CLAVIER) refocaliser.current = g.id
        if (rdv) setBandeau(bandeauDeplace(rdv, g, fauteuilCible?.nom))
        // L'état affiché vient du serveur, jamais de l'aperçu optimiste seul :
        // `deplacerRendezVousAction` a déjà appelé `revalidatePath`, ce
        // `refresh()` est la garantie explicite que cette vue le reflète.
        router.refresh()
      }
    } catch {
      setBandeau({ ton: 'erreur', message: 'Le déplacement a échoué. Réessayez.' })
      definirGeste(null)
    } finally {
      setEnVol(false)
    }
  }

  /** « Jean-Marc Pelage : 11:00, Fauteuil 1 — le patient sera prévenu par SMS. » avec « Annuler ». */
  function bandeauDeplace(rdv: RendezVousVue, g: Geste, fauteuilNom: string | undefined): Bandeau {
    const nom = `${rdv.patient.prenom} ${rdv.patient.nom}`
    const heureChangee = g.candidateDebut !== g.debutOrigine
    const prevenu = heureChangee && (rdv.statut === 'A_CONFIRMER' || rdv.statut === 'CONFIRME')
    const message =
      g.candidateDebut === g.debutOrigine && g.candidateFauteuilIndex === g.fauteuilIndexOrigine
        ? `${nom} : jusqu’à ${formatHeureMinutesISO(g.candidateFin)}.`
        : `${nom} : ${formatHeureMinutesISO(g.candidateDebut)}${fauteuilNom && g.candidateFauteuilIndex !== g.fauteuilIndexOrigine ? `, ${fauteuilNom}` : ''}${prevenu ? ' — le patient sera prévenu par SMS dans 5 minutes.' : '.'}`
    return { ton: 'info', message, action: { libelle: 'Annuler', faire: () => void revenir(rdv, g) } }
  }

  /** Le rendez-vous revient à sa place d'avant, sans SMS (le service vérifie que c'est bien ce retour-là). */
  async function revenir(rdv: RendezVousVue, g: Geste) {
    avantRafraichissement.current = null
    definirGeste(null)
    const donnees = new FormData()
    donnees.set('id', rdv.id)
    donnees.set('jour', jour)
    donnees.set('heure', formatHeureMinutesISO(g.debutOrigine))
    donnees.set('dureeMinutes', String(g.finOrigine - g.debutOrigine))
    donnees.set('fauteuilId', rdv.fauteuil.id)
    const resultat = await revenirAvantDeplacementAction(donnees)
    setBandeau(resultat.erreur ? { ton: 'erreur', message: resultat.erreur } : { ton: 'info', message: 'Déplacement annulé.' })
    router.refresh()
  }

  function annuler() {
    annulerAttente()
    definirGeste(null)
  }

  /** Une touche sur la carte qui a le focus : les flèches la déplacent, Entrée valide (Échap : voir plus haut). */
  function toucheCarte(e: React.KeyboardEvent<HTMLElement>, rdv: RendezVousVue, eligible: boolean): boolean {
    if (e.altKey || e.metaKey || e.ctrlKey) return false
    const g = gesteRef.current
    if (g && g.pointerId === CLAVIER && g.id === rdv.id && g.phase === 'glisse') {
      if (e.key === 'Enter') {
        void envoyer(g)
        return true
      }
      const visee = deplacementClavier(
        e.key,
        e.shiftKey,
        { colonne: g.candidateFauteuilIndex, debut: g.candidateDebut, fin: g.candidateFin },
        fauteuils.length,
      )
      if (!visee) return false
      definirGeste({
        ...g,
        candidateDebut: visee.debut,
        candidateFin: visee.fin,
        candidateFauteuilIndex: visee.colonne,
        verdict: verdictPour(rdv, visee.debut, visee.fin, visee.colonne),
      })
      return true
    }
    if (!peutDeplacer || gesteRef.current || enVol || !e.key.startsWith('Arrow')) return false
    if (!eligible) {
      setBandeau({ ton: 'erreur', message: RAISON_FIGE[rdv.statut] ?? 'Ce rendez-vous ne se déplace pas.' })
      return true
    }
    const index = fauteuils.findIndex((f) => f.id === rdv.fauteuil.id)
    if (index === -1) return false
    const debut = minutesDepuisMinuit(rdv.debut, jour)
    const fin = minutesDepuisMinuit(rdv.fin, jour)
    const visee = deplacementClavier(e.key, e.shiftKey, { colonne: index, debut, fin }, fauteuils.length)
    if (!visee) return false
    setBandeau(MODE_EMPLOI_CLAVIER)
    definirGeste({
      id: rdv.id,
      mode: 'deplacer',
      pointerId: CLAVIER,
      startX: 0,
      startY: 0,
      col0Left: 0,
      colWidth: 0,
      debutOrigine: debut,
      finOrigine: fin,
      fauteuilIndexOrigine: index,
      aFranchiSeuil: true,
      candidateDebut: visee.debut,
      candidateFin: visee.fin,
      candidateFauteuilIndex: visee.colonne,
      phase: 'glisse',
      verdict: verdictPour(rdv, visee.debut, visee.fin, visee.colonne),
    })
    return true
  }

  /** La carte perd le focus en plein déplacement au clavier : il est abandonné, comme sur Échap. */
  function quitterCarte(rdv: RendezVousVue) {
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
        className="grid gap-px bg-border"
        style={{ gridTemplateColumns: `repeat(${fauteuils.length}, minmax(11rem, 1fr))`, height: hauteur }}
      >
        {fauteuils.map((f, index) => {
          const duFauteuil = rendezVous.filter((r) => r.fauteuil.id === f.id)
          // Une urgence forcée sur un créneau pris (tour du 20/10) : côte à côte, jamais l'une sur l'autre.
          const couloirs = repartirEnCouloirs(
            duFauteuil.map((r) => ({
              debut: minutesDepuisMinuit(r.debut, jour),
              fin: minutesDepuisMinuit(r.fin, jour),
            })),
          )
          const gesteIci = geste && geste.aFranchiSeuil && geste.candidateFauteuilIndex === index ? geste : null

          return (
            <div
              key={f.id}
              data-fauteuil-index={index}
              className={cn('relative bg-background', peutCreer && 'cursor-pointer')}
              style={{ height: hauteur }}
              // Les cartes arrêtent leur clic : ce qui arrive ici est un clic sur une case vide.
              onClick={
                peutCreer
                  ? (e) => {
                      const minutes = minutesDepuisY(
                        e.clientY - e.currentTarget.getBoundingClientRect().top,
                        HAUTEUR_PAS,
                      )
                      router.push(
                        lienNouveauRendezVous({ jour, minutes, presences, fauteuilId: f.id, siteId: f.site.id }),
                      )
                    }
                  : undefined
              }
              onMouseMove={
                peutCreer
                  ? (e) => {
                      if (geste || (e.target as HTMLElement).closest('article')) return setSurvol(null)
                      const minutes = minutesDepuisY(
                        e.clientY - e.currentTarget.getBoundingClientRect().top,
                        HAUTEUR_PAS,
                      )
                      if (survol?.index !== index || survol.minutes !== minutes) setSurvol({ index, minutes })
                    }
                  : undefined
              }
              onMouseLeave={peutCreer ? () => setSurvol(null) : undefined}
            >
              {survol?.index === index && !geste ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute right-1.5 left-1.5 rounded-sm border border-dashed border-primary/60 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
                  style={{ top: ((survol.minutes - DEBUT_GRILLE) / PAS) * HAUTEUR_PAS, height: HAUTEUR_PAS * 2 }}
                >
                  + {formatHeureMinutesISO(survol.minutes)}
                </div>
              ) : null}
              {lignes.slice(0, -1).map((m) => (
                <div key={m} className="border-t border-border/60" style={{ height: HAUTEUR_LIGNE }} />
              ))}

              {duFauteuil.map((rdv, i) => {
                const { couloir, couloirs: nbCouloirs } = couloirs[i]!
                const enGeste = geste?.id === rdv.id
                const debutMin = minutesDepuisMinuit(rdv.debut, jour)
                const finMin = minutesDepuisMinuit(rdv.fin, jour)
                const haut = ((Math.max(debutMin, DEBUT_GRILLE) - DEBUT_GRILLE) / PAS) * HAUTEUR_PAS
                const bas = ((Math.min(finMin, FIN_GRILLE) - DEBUT_GRILLE) / PAS) * HAUTEUR_PAS
                if (bas <= 0 || haut >= hauteur) return null

                const urgence = rdv.motif.estUrgence || rdv.surbooking
                const hauteurBloc = Math.max(bas - haut, 22)
                const eligible = peutDeplacer && DEPLACABLE_PAR_GLISSER.includes(rdv.statut)
                // Figée : elle ne se glisse pas, et le dit au survol et quand on essaie (`useEssaiFige`).
                const fige = peutDeplacer && !eligible

                return (
                  <article
                    key={rdv.id}
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
                    onPointerDown={eligible ? (e) => demarrer(e, rdv, 'deplacer') : fige ? (e) => essai.appui(e, rdv.id) : undefined}
                    onPointerMove={eligible ? bouger : fige ? (e) => essai.glisse(e, rdv.id, rdv.statut) : undefined}
                    onPointerUp={eligible ? lacher : fige ? (e) => essai.lache(e) : undefined}
                    onPointerCancel={eligible ? annuler : fige ? () => essai.abandon() : undefined}
                    onContextMenu={eligible ? (e) => (attente.current || gesteRef.current) && e.preventDefault() : undefined}
                    className={cn(
                      classesRendezVous(rdv.statut, urgence),
                      'group [-webkit-touch-callout:none]',
                      eligible ? 'cursor-grab active:cursor-grabbing' : essai.refuse === rdv.id ? 'cursor-not-allowed' : 'cursor-pointer',
                      // Sa place d'origine reste marquée pendant que la carte voyage.
                      enGeste && geste?.aFranchiSeuil && 'opacity-40 outline-2 outline-offset-[-2px] outline-dashed',
                      selection === rdv.id && 'ring-2 ring-primary',
                      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                    )}
                    style={{
                      top: haut,
                      height: hauteurBloc,
                      left: `calc(${(couloir / nbCouloirs) * 100}% + 6px)`,
                      width: `calc(${100 / nbCouloirs}% - 12px)`,
                      ...fondRendezVous(rdv.praticien.couleur, rdv.statut),
                      outlineColor: rdv.praticien.couleur,
                    }}
                  >
                    <ContenuRendezVous
                      debut={formatHeureMinutesISO(debutMin)}
                      fin={formatHeureMinutesISO(finMin)}
                      prenom={rdv.patient.prenom}
                      nom={rdv.patient.nom}
                      motif={rdv.motif.libelle}
                      statut={rdv.statut}
                      couleur={rdv.praticien.couleur}
                      hauteur={hauteurBloc}
                      urgence={urgence}
                      niveauIA={niveauRetenu(rdv.conversationAssistant)}
                    />
                    <span className="sr-only">
                      {rdv.motif.libelle} — {rdv.praticien.prenom} {rdv.praticien.nom} — statut :{' '}
                      {LIBELLE_STATUT[rdv.statut]}
                      {rdv.surbooking ? ' — urgence ajoutée sur un planning complet' : ''}
                    </span>

                    {eligible ? (
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          demarrer(e, rdv, 'redimensionner')
                        }}
                        onPointerMove={(e) => {
                          // Avec `setPointerCapture` sur la poignée, l'événement est
                          // retargeté sur elle mais continue de remonter jusqu'à
                          // l'article — qui porte lui aussi `onPointerMove`/`onPointerUp`
                          // pour son propre geste de déplacement. Sans cet arrêt, chaque
                          // pointermove/pointerup du redimensionnement appelait `bouger`/
                          // `lacher` deux fois.
                          e.stopPropagation()
                          bouger(e)
                        }}
                        onPointerUp={(e) => {
                          e.stopPropagation()
                          lacher(e)
                        }}
                        onPointerCancel={(e) => {
                          e.stopPropagation()
                          annuler()
                        }}
                        className="absolute inset-x-0 -bottom-0.5 h-3 cursor-ns-resize"
                        style={{ touchAction: 'none' }}
                        aria-hidden
                      >
                        {/* La poignée de durée : visible au survol, pour qu'on sache qu'on peut tirer. */}
                        <span className="pointer-events-none absolute bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-40" />
                      </div>
                    ) : null}
                  </article>
                )
              })}

              {gesteIci && rdvEnGeste
                ? (() => {
                    const pix = pixelsDepuisPlage({ debut: gesteIci.candidateDebut, fin: gesteIci.candidateFin })
                    const hauteurFantome = Math.max(pix.hauteur, 22)
                    const ok = gesteIci.verdict.ok
                    return (
                      <>
                        {/* La carte elle-même, à la place visée ; rouge si la place est interdite. */}
                        <div
                          aria-hidden
                          className={cn(
                            classesRendezVous(rdvEnGeste.statut, false),
                            'pointer-events-none right-1.5 left-1.5 z-20 shadow-xl ring-2',
                            ok ? 'ring-white/80' : 'ring-etat-erreur',
                          )}
                          style={{
                            top: pix.top,
                            height: hauteurFantome,
                            ...(ok ? fondRendezVous(rdvEnGeste.praticien.couleur, rdvEnGeste.statut) : { backgroundColor: '#FBEAE8' }),
                          }}
                        >
                          <ContenuRendezVous
                            debut={formatHeureMinutesISO(gesteIci.candidateDebut)}
                            fin={formatHeureMinutesISO(gesteIci.candidateFin)}
                            prenom={rdvEnGeste.patient.prenom}
                            nom={rdvEnGeste.patient.nom}
                            motif={rdvEnGeste.motif.libelle}
                            statut={rdvEnGeste.statut}
                            couleur={ok ? rdvEnGeste.praticien.couleur : '#B42318'}
                            hauteur={hauteurFantome}
                            urgence={false}
                          />
                        </div>
                        {!gesteIci.verdict.ok ? (
                          <p
                            aria-hidden
                            className="pointer-events-none absolute right-1.5 left-1.5 z-30 rounded-xl bg-etat-erreur px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
                            style={{ top: pix.top + hauteurFantome + 4 }}
                          >
                            {gesteIci.verdict.raison}
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
