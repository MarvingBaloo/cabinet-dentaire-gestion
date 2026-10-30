'use client'

import { Pencil } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Message } from '@/components/ui/message'
import { jourEnToutesLettres } from '@/lib/dates'
import { TEXTE_NOTE_MAX, type NoteJourVue } from '@/lib/notes-jour'
import { badgeSite, couleurSite } from '@/lib/sites'
import {
  creerNoteJourAction,
  modifierNoteJourAction,
  supprimerNoteJourAction,
  type EtatNoteJour,
} from '@/server/actions/notes-jour'

type SiteVue = { id: string; code: string; nom: string }

const ETAT_INITIAL: EtatNoteJour = {}

const heureNote = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: 'America/Guadeloupe' })

const formatModification = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Guadeloupe',
})

function ChampTexte({ defaut, id }: { defaut: string; id: string }) {
  const [longueur, setLongueur] = useState(defaut.length)
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        Texte de la note
      </label>
      <textarea
        id={id}
        name="texte"
        required
        maxLength={TEXTE_NOTE_MAX}
        rows={4}
        defaultValue={defaut}
        onChange={(e) => setLongueur(e.target.value.length)}
        aria-describedby={`${id}-compteur`}
        className="w-full rounded-sm border border-border bg-background px-3 py-2 text-sm"
      />
      <p id={`${id}-compteur`} className="text-right text-xs text-muted-foreground tabular-nums">
        {longueur} / {TEXTE_NOTE_MAX} caractères
      </p>
    </div>
  )
}

function Erreur({ etat }: { etat: EtatNoteJour }) {
  return etat.erreur ? (
    <Message ton="alerte" role="alert">
      {etat.erreur}
    </Message>
  ) : null
}

function FormulaireCreation({
  jour,
  sites,
  siteIdCreation,
  fermer,
}: {
  jour: string
  sites: SiteVue[]
  siteIdCreation: string | null
  fermer: () => void
}) {
  const [etat, action, enCours] = useActionState(creerNoteJourAction, ETAT_INITIAL)
  useEffect(() => {
    if (etat.succes) fermer()
  }, [etat.succes, fermer])

  const id = `note-creation-${jour}`
  return (
    <form key={etat.jeton} action={action} className="space-y-3">
      <input type="hidden" name="jour" value={jour} />
      {siteIdCreation ? (
        <input type="hidden" name="siteId" value={siteIdCreation} />
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${id}-site`} className="text-sm font-medium">
            Cabinet
          </label>
          <select
            key={etat.jeton}
            id={`${id}-site`}
            name="siteId"
            required
            defaultValue={etat.saisie?.siteId ?? ''}
            className="h-9 w-full rounded-sm border border-border bg-background px-2 text-sm"
          >
            <option value="" disabled>
              Choisir un cabinet
            </option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </select>
        </div>
      )}
      <ChampTexte id={id} defaut={etat.saisie?.texte ?? ''} />
      <Erreur etat={etat} />
      <Button type="submit" disabled={enCours}>
        Ajouter la note
      </Button>
    </form>
  )
}

function FormulaireModification({ note, fermer }: { note: NoteJourVue; fermer: () => void }) {
  const [etat, action, enCours] = useActionState(modifierNoteJourAction, ETAT_INITIAL)
  useEffect(() => {
    if (etat.succes) fermer()
  }, [etat.succes, fermer])

  return (
    <form key={etat.jeton} action={action} className="space-y-3">
      <input type="hidden" name="id" value={note.id} />
      <ChampTexte id={`note-texte-${note.id}`} defaut={etat.saisie?.texte ?? note.texte} />
      <Erreur etat={etat} />
      <Button type="submit" disabled={enCours}>
        Enregistrer
      </Button>
    </form>
  )
}

function FormulaireSuppression({ id, fermer }: { id: string; fermer: () => void }) {
  const [etat, action, enCours] = useActionState(supprimerNoteJourAction, ETAT_INITIAL)
  useEffect(() => {
    if (etat.succes) fermer()
  }, [etat.succes, fermer])

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Erreur etat={etat} />
      <Button type="submit" variant="outline" disabled={enCours}>
        Supprimer la note
      </Button>
    </form>
  )
}

export function NotesJour({
  jour,
  notes,
  sites,
  siteIdCreation,
  afficherBadge,
  peutCreer,
  peutModifier,
  peutSupprimer,
  variante,
}: {
  jour: string
  notes: NoteJourVue[]
  sites: SiteVue[]
  siteIdCreation: string | null
  afficherBadge: boolean
  peutCreer: boolean
  peutModifier: boolean
  peutSupprimer: boolean
  variante: 'colonne' | 'entete' | 'panneau'
}) {
  // « creation » ou l'id d'une note ; null = fermé.
  const [ouvert, setOuvert] = useState<string | null>(null)
  const fermer = () => setOuvert(null)

  const note = ouvert && ouvert !== 'creation' ? notes.find((n) => n.id === ouvert) : undefined
  const enCreation = ouvert === 'creation'
  const lettres = jourEnToutesLettres(jour)

  if (notes.length === 0 && !peutCreer) return null

  const fenetre = (
    <Dialog open={ouvert !== null && (enCreation || note !== undefined)} onOpenChange={(o) => !o && fermer()}>
      <DialogContent>
        {enCreation ? (
          <>
            <DialogHeader>
              <DialogTitle>Nouvelle note</DialogTitle>
              <DialogDescription>{lettres}</DialogDescription>
            </DialogHeader>
            <FormulaireCreation jour={jour} sites={sites} siteIdCreation={siteIdCreation} fermer={fermer} />
          </>
        ) : note ? (
          <>
            <DialogHeader>
              <DialogTitle>Note du {lettres}</DialogTitle>
              <DialogDescription>
                {note.site.nom} — {note.auteur}, modifiée le {formatModification.format(new Date(note.modifieeLe))}
              </DialogDescription>
            </DialogHeader>
            {peutModifier ? (
              <FormulaireModification note={note} fermer={fermer} />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{note.texte}</p>
            )}
            {peutSupprimer ? <FormulaireSuppression id={note.id} fermer={fermer} /> : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )

  // Panneau de gauche du planning (maquettes du 13/10) : les notes du jour
  // affiché, en entier, signées.
  if (variante === 'panneau') {
    return (
      <div className="space-y-2">
        {notes.length === 0 ? <p className="text-sm text-muted-foreground">Aucune note pour ce jour.</p> : null}
        {notes.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setOuvert(n.id)}
            className="block w-full rounded-sm border-l-[3px] border-etat-alerte bg-background px-4 py-3 text-left text-sm hover:bg-muted/50"
          >
            {afficherBadge ? (
              <span className="mb-1 block text-[0.6875rem] font-semibold text-muted-foreground">{n.site.nom}</span>
            ) : null}
            <span className="block whitespace-pre-wrap text-foreground">{n.texte}</span>
            <span className="mt-2 block text-xs text-muted-foreground">
              {n.auteur} · {heureNote.format(new Date(n.modifieeLe))}
            </span>
          </button>
        ))}
        {peutCreer ? (
          <button
            type="button"
            onClick={() => setOuvert('creation')}
            aria-label={`Ajouter une note au ${lettres}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            + Ajouter une note
          </button>
        ) : null}
        {fenetre}
      </div>
    )
  }

  return (
    <div
      className={
        variante === 'colonne'
          ? 'flex min-w-0 flex-col items-start gap-0.5'
          : 'flex flex-wrap items-center gap-x-4 gap-y-1'
      }
    >
      {notes.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => setOuvert(n.id)}
          className={`flex min-w-0 items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground ${
            variante === 'colonne' ? 'w-full' : 'max-w-full sm:max-w-md'
          }`}
        >
          <Pencil aria-hidden className="size-3 shrink-0" />
          {afficherBadge ? (
            <span
              className="shrink-0 px-1 text-[9px] font-semibold text-white"
              style={{ backgroundColor: couleurSite(n.site.code) }}
              title={n.site.nom}
            >
              <span className="sr-only">{n.site.nom} : </span>
              <span aria-hidden>{badgeSite(n.site.code, n.site.nom)}</span>
            </span>
          ) : null}
          <span className="truncate">{n.texte}</span>
        </button>
      ))}
      {peutCreer ? (
        <button
          type="button"
          onClick={() => setOuvert('creation')}
          aria-label={`Ajouter une note au ${lettres}`}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          + note
        </button>
      ) : null}

      {fenetre}
    </div>
  )
}
