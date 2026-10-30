'use server'

import { revalidatePath } from 'next/cache'

import { PermissionDeniedError } from '@/server/auth/permissions'
import { PorteeSiteError } from '@/server/auth/portee'
import { exigerContexte } from '@/server/auth/session-courante'
import type { RendezVousConcerneVue } from '@/server/actions/presences'
import {
  IndisponibiliteBloqueeError,
  PeriodeInvalideError,
  creerIndisponibilite,
  supprimerIndisponibilite,
} from '@/server/services/indisponibilites'
import {
  creerIndisponibiliteSchema,
  supprimerIndisponibiliteSchema,
} from '@/server/validation/indisponibilites'
import type { RendezVousConcerne } from '@/server/services/presences'

// Server Actions et non routes API (D6, même principe qu'agenda.ts et
// presences.ts). Chacune commence par `exigerContexte` ; les gardes de
// permission et de portée sont dans le service (D4, D5).

export type EtatIndisponibilite = {
  erreur?: string
  succes?: string
  /** La saisie reçue, renvoyée en cas de refus — même règle que partout
   *  ailleurs (CLAUDE.md) : sans quoi React vide le formulaire et fait
   *  retaper la saisie pour une seule erreur. */
  saisie?: Record<string, string>
  /** Peuplé uniquement par un refus Q5 : la liste des rendez-vous à déplacer
   *  ou annuler avant de pouvoir enregistrer. */
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

function refusDe(e: unknown, saisie?: Record<string, string>): EtatIndisponibilite {
  const jeton = crypto.randomUUID()
  const base: EtatIndisponibilite = saisie ? { saisie, jeton } : { jeton }

  if (e instanceof IndisponibiliteBloqueeError) {
    return { ...base, erreur: e.message, rendezVousConcernes: e.rendezVous.map(vue) }
  }
  if (e instanceof PeriodeInvalideError) return { ...base, erreur: e.message }
  if (e instanceof PorteeSiteError) return { ...base, erreur: 'Ce cabinet n’est pas dans votre périmètre.' }
  if (e instanceof PermissionDeniedError) {
    return { ...base, erreur: 'Vous n’avez pas le droit d’effectuer cette action.' }
  }
  throw e
}

function premierProbleme(erreur: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const premier = erreur.issues[0]
  return `${premier?.path.join('.') ?? 'saisie'} : ${premier?.message ?? 'invalide'}`
}

const rafraichir = () => revalidatePath('/tableau-de-bord/indisponibilites')

export async function creerIndisponibiliteAction(
  _precedent: EtatIndisponibilite,
  donnees: FormData,
): Promise<EtatIndisponibilite> {
  const ctx = await exigerContexte()

  const saisie = {
    type: lire(donnees, 'type'),
    praticienId: lire(donnees, 'praticienId'),
    siteId: lire(donnees, 'siteId'),
    joursEntiers: lire(donnees, 'joursEntiers'),
    dateDebut: lire(donnees, 'dateDebut'),
    dateFin: lire(donnees, 'dateFin'),
    heureDebut: lire(donnees, 'heureDebut'),
    heureFin: lire(donnees, 'heureFin'),
    motif: lire(donnees, 'motif'),
  }

  const analyse = creerIndisponibiliteSchema.safeParse({
    type: saisie.type,
    praticienId: saisie.praticienId || undefined,
    siteId: saisie.siteId || undefined,
    // Case à cocher native : absente du FormData quand elle n'est pas cochée.
    joursEntiers: donnees.get('joursEntiers') === 'on',
    dateDebut: saisie.dateDebut,
    dateFin: saisie.dateFin || undefined,
    heureDebut: saisie.heureDebut || undefined,
    heureFin: saisie.heureFin || undefined,
    motif: saisie.motif || undefined,
  })
  if (!analyse.success) return { erreur: premierProbleme(analyse.error), saisie, jeton: crypto.randomUUID() }

  try {
    await creerIndisponibilite(ctx, analyse.data)
    rafraichir()
    return { succes: 'Indisponibilité enregistrée.' }
  } catch (e) {
    return refusDe(e, saisie)
  }
}

export async function supprimerIndisponibiliteAction(
  _precedent: EtatIndisponibilite,
  donnees: FormData,
): Promise<EtatIndisponibilite> {
  const ctx = await exigerContexte()

  const analyse = supprimerIndisponibiliteSchema.safeParse({ id: donnees.get('id') })
  if (!analyse.success) return { erreur: premierProbleme(analyse.error), jeton: crypto.randomUUID() }

  try {
    await supprimerIndisponibilite(ctx, analyse.data)
    rafraichir()
    return { succes: 'Indisponibilité supprimée.' }
  } catch (e) {
    return refusDe(e)
  }
}
