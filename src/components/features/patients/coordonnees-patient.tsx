'use client'

import { IdCard } from 'lucide-react'
import { useActionState, useState } from 'react'

import { TitreAlveole } from '@/components/features/patients/alveoles'

import { Message } from '@/components/ui/message'
import { afficherTelephone } from '@/lib/telephone'
import { type EtatPatient, modifierPatientAction } from '@/server/actions/patients'

// Coordonnées d'un patient, en lecture puis en saisie (« Modifier », fiche
// patient du 19/10). La fiche devient complète dès que la date de naissance est
// renseignée — même règle qu'à la création (Q33).

type Coordonnees = {
  id: string
  nom: string
  prenom: string
  telephone: string
  /** `AAAA-MM-JJ`, ou chaîne vide. */
  dateNaissance: string
  email: string
  representantLegal: string
  telephoneRepresentant: string
  creeLe: string
}

export function CoordonneesPatient({ patient, peutModifier }: { patient: Coordonnees; peutModifier: boolean }) {
  const [edition, setEdition] = useState(false)
  const [etat, action, enCours] = useActionState<EtatPatient, FormData>(async (precedent, donnees) => {
    const r = await modifierPatientAction(precedent, donnees)
    if (r.succes) setEdition(false)
    return r
  }, {})
  const v = (champ: keyof Coordonnees) => etat.valeurs?.[champ] ?? patient[champ]

  return (
    <section aria-labelledby="titre-coordonnees" className="carte-douce px-6 py-6 sm:px-7">
      <div className="flex items-center justify-between gap-3">
        <TitreAlveole id="titre-coordonnees" icone={IdCard}>
          Coordonnées
        </TitreAlveole>
        {peutModifier && !edition ? (
          <button
            type="button"
            onClick={() => setEdition(true)}
            className="text-sm font-semibold text-[#387a70] hover:underline"
          >
            Modifier
          </button>
        ) : null}
      </div>

      {etat.succes && !edition ? (
        <Message ton="succes" role="status" className="mt-4">
          {etat.succes}
        </Message>
      ) : null}

      {edition ? (
        <form action={action} className="mt-4 space-y-4">
          {etat.erreur ? (
            <Message ton="erreur" role="alert">
              {etat.erreur}
            </Message>
          ) : null}
          <input type="hidden" name="id" value={patient.id} />
          <div className="grid grid-cols-2 gap-3">
            <Champ nom="prenom" libelle="Prénom" valeur={v('prenom')} requis />
            <Champ nom="nom" libelle="Nom" valeur={v('nom')} requis />
          </div>
          <Champ nom="telephone" libelle="Téléphone" valeur={v('telephone')} type="tel" requis />
          <Champ nom="email" libelle="E-mail" valeur={v('email')} type="email" />
          <Champ
            nom="dateNaissance"
            libelle="Date de naissance"
            valeur={v('dateNaissance')}
            type="date"
            aide="Elle distingue deux homonymes : la fiche est complète dès qu’elle est renseignée."
          />
          <Champ
            nom="representantLegal"
            libelle="Représentant légal"
            valeur={v('representantLegal')}
            aide="Pour un patient de moins de 12 ans."
          />
          <Champ
            nom="telephoneRepresentant"
            libelle="Téléphone du représentant"
            valeur={v('telephoneRepresentant')}
            type="tel"
          />
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={enCours}
              className="h-10 bouton-principal px-4 text-sm font-medium disabled:opacity-60"
            >
              {enCours ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => setEdition(false)}
              className="h-10 rounded-full border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
            >
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <dl className="mt-5 space-y-3 text-[0.9375rem]">
          <div>
            <dt className="text-sm text-muted-foreground">Téléphone</dt>
            <dd className="chiffres">{afficherTelephone(patient.telephone)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">E-mail</dt>
            <dd className={patient.email ? undefined : 'text-muted-foreground'}>{patient.email || 'Non renseigné'}</dd>
          </div>
          {patient.representantLegal ? (
            <div>
              <dt className="text-sm text-muted-foreground">Représentant légal</dt>
              <dd>
                {patient.representantLegal}
                {patient.telephoneRepresentant ? ` · ${afficherTelephone(patient.telephoneRepresentant)}` : null}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-sm text-muted-foreground">Fiche créée le</dt>
            <dd>{patient.creeLe}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

function Champ({
  nom,
  libelle: texte,
  valeur,
  type = 'text',
  requis = false,
  aide,
}: {
  nom: string
  libelle: string
  valeur: string
  type?: string
  requis?: boolean
  aide?: string
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`fiche-${nom}`} className="block text-sm font-medium">
        {texte}
      </label>
      <input
        id={`fiche-${nom}`}
        name={nom}
        type={type}
        required={requis}
        defaultValue={valeur}
        aria-describedby={aide ? `aide-${nom}` : undefined}
        className="champ bg-background"
      />
      {aide ? (
        <p id={`aide-${nom}`} className="text-[0.8125rem] text-muted-foreground">
          {aide}
        </p>
      ) : null}
    </div>
  )
}
