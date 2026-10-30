'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'
import { useActionState, useEffect, useRef } from 'react'

import { SaisieCode } from '@/components/features/auth/saisie-code'
import { Message } from '@/components/ui/message'
import { construireIcs, identifiantEvenement, nomFichierIcs } from '@/lib/ics'
import {
  type EtatReservation,
  confirmerReservationAction,
  demarrerReservationAction,
} from '@/server/actions/reservation'

// Les deux derniers temps de la réservation : coordonnées, puis code reçu.
//
// Deux formulaires successifs et non un seul écran : le code n'existe pas
// encore quand le patient tape son nom, et le lui demander d'emblée donnerait un
// champ vide qu'il ne saurait pas remplir.
//
// ⚠ Rien n'est réservé tant que le code n'est pas rendu. C'est dit à l'écran :
// un patient qui ferme l'onglet après avoir laissé son numéro doit savoir qu'il
// n'a pas de rendez-vous.
//
// Le code et la confirmation passent en plein écran (maquette du 13/10) : le
// conteneur porte `data-plein-ecran`, et la page masque le reste du parcours
// par `group-has-[[data-plein-ecran]]` — les étapes déjà choisies n'ont plus
// rien à proposer une fois le SMS parti.

/** Ce qu'il faut pour écrire le .ics et le récapitulatif, et que le patient a déjà sous les yeux. */
export type RepereRendezVous = {
  siteNom: string
  siteAdresse: string | null
  motifLibelle: string | null
  /** « Mercredi 14 octobre » et « 10:00 », à l'heure du cabinet. */
  jour: string
  heure: string
  praticienNom: string | null
}

const bouton =
  'h-12 bouton-principal px-6 font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-60'

export function FormulaireReservation({
  siteId,
  motifId,
  praticienId,
  debut,
  ...repere
}: {
  siteId: string
  motifId: string
  praticienId: string
  debut: string
} & RepereRendezVous) {
  const [etat, action, enCours] = useActionState<EtatReservation, FormData>(demarrerReservationAction, {})

  if (etat.confirme) return <Confirmation {...etat.confirme} repere={repere} />
  if (etat.id) return <EtapeCode id={etat.id} masque={etat.masque ?? ''} repere={repere} />

  return (
    <form action={action} className="space-y-6">
      {etat.erreur ? (
        <Message ton="erreur" role="alert">
          {etat.erreur}
        </Message>
      ) : null}

      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="motifId" value={motifId} />
      <input type="hidden" name="praticienId" value={praticienId} />
      <input type="hidden" name="debut" value={debut} />

      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="prenom" className="block text-sm font-medium">
            Prénom
          </label>
          <input
            id="prenom"
            name="prenom"
            required
            autoComplete="given-name"
            defaultValue={etat.valeurs?.prenom}
            className="champ"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="nom" className="block text-sm font-medium">
            Nom
          </label>
          <input
            id="nom"
            name="nom"
            required
            autoComplete="family-name"
            defaultValue={etat.valeurs?.nom}
            className="champ"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="telephone" className="block text-sm font-medium">
            Téléphone mobile
          </label>
          <input
            id="telephone"
            name="telephone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="06 90 12 34 56"
            defaultValue={etat.valeurs?.telephone}
            aria-describedby="aide-tel"
            className="champ"
          />
          <p id="aide-tel" className="text-[0.8125rem] text-muted-foreground">
            Comme vous le tapez d’habitude, par exemple 0690 12 34 56. C’est sur ce numéro que vous recevrez votre code.
          </p>
        </div>
      </div>

      <button type="submit" disabled={enCours} className={`lien-action ${bouton}`}>
        {enCours ? 'Envoi…' : 'Recevoir mon code'}
      </button>
      <p className="text-sm text-muted-foreground">Votre rendez-vous ne sera réservé qu’une fois le code saisi.</p>
    </form>
  )
}

function Recapitulatif({ repere }: { repere: RepereRendezVous }) {
  return (
    <div className="rounded-[1.75rem] bg-[#edf6f3] px-6 py-6">
      <p className="font-heading text-xl font-semibold">
        {repere.jour} · {repere.heure}
      </p>
      {repere.motifLibelle ? <p className="mt-2 text-[0.9375rem]">{repere.motifLibelle}</p> : null}
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">
        {repere.praticienNom ? `${repere.praticienNom} · ` : null}
        {repere.siteNom.charAt(0).toLowerCase() + repere.siteNom.slice(1)}
      </p>
    </div>
  )
}

function EtapeCode({ id, masque, repere }: { id: string; masque: string; repere: RepereRendezVous }) {
  const [etat, action, enCours] = useActionState<EtatReservation, FormData>(confirmerReservationAction, {})

  if (etat.confirme) return <Confirmation {...etat.confirme} repere={repere} />

  return (
    <div data-plein-ecran className="grid gap-10 lg:grid-cols-2">
      <form action={action} className="carte-douce space-y-8 px-6 py-10 sm:px-10">
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            Étape 5 · Vos coordonnées
          </p>
          <h2 id="titre-code" className="mt-4 font-heading text-[2.5rem] leading-tight font-bold">
            Votre code
          </h2>
          <p id="aide-code" className="mt-2 text-[0.9375rem] text-muted-foreground">
            Un code à six chiffres vient d’être envoyé au {masque}.
          </p>
        </div>

        {etat.erreur ? (
          <Message ton="erreur" role="alert">
            {etat.erreur}
          </Message>
        ) : null}

        <input type="hidden" name="id" value={etat.id ?? id} />
        <div className="max-w-[28.5rem]">
          <SaisieCode name="code" idLibelle="titre-code" decritPar="aide-code" />
        </div>

        <div className="max-w-[28.5rem] space-y-5">
          <button type="submit" disabled={enCours} className={`${bouton} w-full`}>
            {enCours ? 'Vérification…' : 'Confirmer mon rendez-vous'}
          </button>
          <Link href="/rendez-vous" className="inline-block text-sm font-medium text-primary hover:underline">
            ← Recommencer
          </Link>
        </div>

        <Recapitulatif repere={repere} />
      </form>
    </div>
  )
}

function Confirmation({ debut, fin, repere }: { debut: string; fin: string; repere: RepereRendezVous }) {
  // Fabriqué au clic et non au rendu : c'est là qu'on a le droit de lire
  // l'horloge, et le patient qui n'en veut pas ne paie rien pour ce fichier.
  const telecharger = () => {
    const debutDate = new Date(debut)
    const ics = construireIcs({
      debut: debutDate,
      fin: new Date(fin),
      titre: repere.motifLibelle ? `${repere.motifLibelle} — ${repere.siteNom}` : `Rendez-vous — ${repere.siteNom}`,
      // L'adresse reste `null` tant que le cabinet ne l'a pas donnée : mieux
      // vaut un événement sans lieu qu'un lieu inventé (src/config/cabinet.ts).
      lieu: repere.siteAdresse ? `${repere.siteNom} — ${repere.siteAdresse}` : repere.siteNom,
      description: 'Rendez-vous pris en ligne. En cas d’empêchement, prévenez le cabinet au plus tôt.',
      // Aucun identifiant de rendez-vous ici : il n'a pas à sortir du serveur.
      uid: identifiantEvenement(),
      horodatage: new Date(),
    })

    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = nomFichierIcs(debutDate)
    a.click()
    URL.revokeObjectURL(url)
  }

  // La page était descendue jusqu'au code : la confirmation s'ouvre par son haut.
  const haut = useRef<HTMLDivElement>(null)
  useEffect(() => {
    haut.current?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <div data-plein-ecran className="grid gap-10 lg:grid-cols-2">
      {/* « C'est réservé. » d'abord (tour du 20/10) : sur téléphone, il venait après le récapitulatif. */}
      <div
        ref={haut}
        role="status"
        className="fond-menthe scroll-mt-6 rounded-[1.75rem] border border-[#cfe9e4] px-6 py-10 sm:px-10"
      >
        <span className="hexagone grid h-[5rem] w-[4.375rem] place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70]">
          <Check aria-hidden className="size-8 text-white" strokeWidth={2.5} />
        </span>
        <p className="mt-8 font-heading text-[length:var(--texte-titre-2)] leading-tight font-bold">C’est réservé.</p>
        <p className="mt-5 text-lg leading-relaxed text-foreground/85">
          {repere.jour} à {repere.heure}, au {repere.siteNom.charAt(0).toLowerCase() + repere.siteNom.slice(1)}
          {repere.praticienNom ? `, avec le ${repere.praticienNom}` : null}.
        </p>
        <p className="mt-4 text-[0.9375rem] text-muted-foreground">
          Un SMS de confirmation vous est envoyé, puis un rappel deux jours avant.
        </p>
        <div className="mt-12 flex flex-col items-start gap-6">
          <button
            type="button"
            onClick={telecharger}
            className="h-12 bouton-principal px-5 text-[0.9375rem] font-medium text-primary-foreground"
          >
            Ajouter à mon agenda
          </button>
          <Link href="/" className="lien-action text-[0.9375rem] font-semibold text-[#387a70]">
            Retour au site
          </Link>
        </div>
      </div>
      <div className="carte-douce space-y-8 px-6 py-10 sm:px-10">
        <p className="text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase">Votre rendez-vous</p>
        <Recapitulatif repere={repere} />
        <p className="text-sm text-muted-foreground">
          Pour l’annuler ou le déplacer, rendez-vous sur{' '}
          <Link href="/mes-rendez-vous" className="font-semibold text-[#387a70] hover:underline">
            « Mes rendez-vous »
          </Link>{' '}
          avec ce même numéro.
        </p>
      </div>
    </div>
  )
}
