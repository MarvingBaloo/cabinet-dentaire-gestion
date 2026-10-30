'use server'

import { revalidatePath } from 'next/cache'

import { PermissionDeniedError } from '@/server/auth/permissions'
import { PorteeSiteError } from '@/server/auth/portee'
import { exigerContexte } from '@/server/auth/session-courante'
import {
  FauteuilHorsSiteError,
  FauteuilNonChoisiError,
  FauteuilOccupeError,
  PresenceEnConflitError,
  type RendezVousConcerne,
  RendezVousOrphelinsError,
  choisirFauteuil,
  enregistrerException,
  enregistrerJourSemaineType,
  supprimerException,
} from '@/server/services/presences'
import {
  choisirFauteuilSchema,
  enregistrerExceptionSchema,
  enregistrerJourSemaineTypeSchema,
  supprimerExceptionSchema,
} from '@/server/validation/presences'

// Server Actions et non routes API (D6, même principe que agenda.ts). Chacune
// commence par `exigerContexte` ; les gardes de permission et de portée sont
// dans le service (D4, D5).

export type RendezVousConcerneVue = {
  id: string
  debut: string
  fin: string
  patient: string
  motif: string
}

export type EtatPresence = {
  erreur?: string
  succes?: string
  /** La saisie reçue, renvoyée en cas de refus — sans quoi React remet le
   *  formulaire à zéro après l'action et fait retaper les sept champs d'une
   *  ligne pour une seule heure mal formée. */
  saisie?: Record<string, string>
  /** Peuplé uniquement par un refus Q5 : la liste à montrer pour que le
   *  personnel sache quoi déplacer ou annuler avant de réessayer. */
  rendezVousConcernes?: RendezVousConcerneVue[]
  /** Change à chaque refus : fait remonter le formulaire (`key`). */
  jeton?: string
}

function lire(donnees: FormData, champ: string): string {
  const v = donnees.get(champ)
  return typeof v === 'string' ? v : ''
}

function vue(rdv: RendezVousConcerne): RendezVousConcerneVue {
  return {
    id: rdv.id,
    debut: rdv.debut.toISOString(),
    fin: rdv.fin.toISOString(),
    patient: `${rdv.patientNom.toUpperCase()} ${rdv.patientPrenom}`,
    motif: rdv.motifLibelle,
  }
}

function premierProbleme(erreur: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const premier = erreur.issues[0]
  return `${premier?.path.join('.') ?? 'saisie'} : ${premier?.message ?? 'invalide'}`
}

/** Traduit les erreurs métier ; ce qui n'est pas traduit reste bruyant (même
 *  discipline que `messageErreur` dans actions/agenda.ts). */
function refusDe(e: unknown, saisie?: Record<string, string>): EtatPresence {
  const jeton = crypto.randomUUID()
  // `exactOptionalPropertyTypes` : la clé `saisie` doit être OMISE plutôt que
  // valoir `undefined` quand elle n'a rien à porter.
  const base: EtatPresence = saisie ? { saisie, jeton } : { jeton }

  if (e instanceof RendezVousOrphelinsError) {
    return { ...base, erreur: e.message, rendezVousConcernes: e.rendezVous.map(vue) }
  }
  if (e instanceof FauteuilHorsSiteError) return { ...base, erreur: e.message }
  if (e instanceof FauteuilNonChoisiError) return { ...base, erreur: e.message }
  if (e instanceof FauteuilOccupeError) return { ...base, erreur: e.message }
  if (e instanceof PresenceEnConflitError) return { ...base, erreur: e.message }
  if (e instanceof PorteeSiteError) return { ...base, erreur: 'Ce cabinet n’est pas dans votre périmètre.' }
  if (e instanceof PermissionDeniedError) {
    return { ...base, erreur: 'Vous n’avez pas le droit d’effectuer cette action.' }
  }
  throw e
}

const rafraichir = () => revalidatePath('/tableau-de-bord/presences')

export async function enregistrerJourSemaineTypeAction(
  _precedent: EtatPresence,
  donnees: FormData,
): Promise<EtatPresence> {
  const ctx = await exigerContexte()

  const saisie = {
    praticienId: lire(donnees, 'praticienId'),
    jourSemaine: lire(donnees, 'jourSemaine'),
    actif: lire(donnees, 'actif'),
    siteId: lire(donnees, 'siteId'),
    fauteuilId: lire(donnees, 'fauteuilId'),
    heureDebut: lire(donnees, 'heureDebut'),
    heureFin: lire(donnees, 'heureFin'),
    pauseDebut: lire(donnees, 'pauseDebut'),
    pauseFin: lire(donnees, 'pauseFin'),
  }

  const analyse = enregistrerJourSemaineTypeSchema.safeParse({
    praticienId: saisie.praticienId,
    jourSemaine: Number(saisie.jourSemaine),
    // Case à cocher native : absente du FormData quand elle n'est pas cochée.
    actif: donnees.get('actif') === 'on',
    siteId: saisie.siteId || undefined,
    fauteuilId: saisie.fauteuilId || undefined,
    heureDebut: saisie.heureDebut || undefined,
    heureFin: saisie.heureFin || undefined,
    pauseDebut: saisie.pauseDebut || undefined,
    pauseFin: saisie.pauseFin || undefined,
  })
  if (!analyse.success) return { erreur: premierProbleme(analyse.error), saisie, jeton: crypto.randomUUID() }

  try {
    await enregistrerJourSemaineType(ctx, analyse.data)
    rafraichir()
    return { succes: 'Présence enregistrée.' }
  } catch (e) {
    return refusDe(e, saisie)
  }
}

export async function enregistrerExceptionAction(
  _precedent: EtatPresence,
  donnees: FormData,
): Promise<EtatPresence> {
  const ctx = await exigerContexte()

  const saisie = {
    praticienId: lire(donnees, 'praticienId'),
    date: lire(donnees, 'date'),
    type: lire(donnees, 'type'),
    motif: lire(donnees, 'motif'),
    siteId: lire(donnees, 'siteId'),
    fauteuilId: lire(donnees, 'fauteuilId'),
    heureDebut: lire(donnees, 'heureDebut'),
    heureFin: lire(donnees, 'heureFin'),
  }

  const analyse = enregistrerExceptionSchema.safeParse({
    praticienId: saisie.praticienId,
    date: saisie.date,
    type: saisie.type,
    motif: saisie.motif || undefined,
    siteId: saisie.siteId || undefined,
    fauteuilId: saisie.fauteuilId || undefined,
    heureDebut: saisie.heureDebut || undefined,
    heureFin: saisie.heureFin || undefined,
  })
  if (!analyse.success) return { erreur: premierProbleme(analyse.error), saisie, jeton: crypto.randomUUID() }

  try {
    await enregistrerException(ctx, analyse.data)
    rafraichir()
    return { succes: 'Exception enregistrée.' }
  } catch (e) {
    return refusDe(e, saisie)
  }
}

export async function supprimerExceptionAction(
  _precedent: EtatPresence,
  donnees: FormData,
): Promise<EtatPresence> {
  const ctx = await exigerContexte()

  const analyse = supprimerExceptionSchema.safeParse({ id: donnees.get('id') })
  if (!analyse.success) return { erreur: premierProbleme(analyse.error), jeton: crypto.randomUUID() }

  try {
    await supprimerException(ctx, analyse.data)
    rafraichir()
    return { succes: 'Exception supprimée.' }
  } catch (e) {
    return refusDe(e)
  }
}

export async function choisirFauteuilAction(_precedent: EtatPresence, donnees: FormData): Promise<EtatPresence> {
  const ctx = await exigerContexte()

  const analyse = choisirFauteuilSchema.safeParse({
    praticienId: lire(donnees, 'praticienId'),
    siteId: lire(donnees, 'siteId'),
    fauteuilId: lire(donnees, 'fauteuilId'),
  })
  if (!analyse.success) return { erreur: 'Choisissez un fauteuil.', jeton: crypto.randomUUID() }

  try {
    const { rendezVous } = await choisirFauteuil(ctx, analyse.data)
    rafraichir()
    return {
      succes:
        rendezVous > 0
          ? `Fauteuil enregistré. ${rendezVous} rendez-vous à venir ${rendezVous > 1 ? 'passent' : 'passe'} sur ce fauteuil.`
          : 'Fauteuil enregistré.',
    }
  } catch (e) {
    return refusDe(e)
  }
}
