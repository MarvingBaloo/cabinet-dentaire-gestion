import 'server-only'

import { Client } from 'pg'

import { env } from '@/config/env'
import { heureCabinet } from '@/lib/dates'
import type { AuthContext } from '@/server/auth/context'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'

// Agenda en direct (D61). Le déclencheur `rendez_vous_notifier_agenda` signale
// chaque changement sur le canal `agenda` ; UNE connexion par processus l'écoute
// et relaie l'événement aux écrans abonnés — jamais une connexion par écran,
// que PostgreSQL finirait par refuser.
//
// Filtre de site (D5) : un écran ne reçoit que ce qui touche un cabinet qu'il
// peut voir, comme sa lecture de l'agenda. La personne qui a fait le geste ne
// reçoit rien : son écran s'est déjà mis à jour.

export type Banniere = { titre: string; detail: string }
export type EvenementAgenda = { id: string; banniere: Banniere | null }

type Signal = {
  id: string
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  site: string
  ancienSite: string
  statut: string
  ancienStatut: string | null
  deplace: boolean
}

type Abonne = { ctx: AuthContext; envoyer: (e: EvenementAgenda) => void }

const jourLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Guadeloupe',
})
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Le bandeau d'un changement, ou `null` s'il ne mérite qu'un rafraîchissement
 * (arrivée, absence…). D61 n'annonce que l'ajout, le déplacement et l'annulation.
 * Pure : testée sans base.
 */
export function texteBanniere(
  signal: Pick<Signal, 'op' | 'statut' | 'ancienStatut' | 'deplace'>,
  rdv: { debut: Date; patient: string; urgence: boolean },
  auteur: string | null,
): Banniere | null {
  const heure = heureCabinet(rdv.debut)
  const detail = `${majuscule(jourLong.format(rdv.debut))} · ${rdv.patient}`

  if (signal.op === 'INSERT') {
    const quoi = rdv.urgence ? 'une urgence' : 'un rendez-vous'
    return { titre: auteur ? `${auteur} a ajouté ${quoi} à ${heure}` : `Réservation en ligne à ${heure}`, detail }
  }
  if (signal.op !== 'UPDATE') return null
  if (signal.statut === 'ANNULE' && signal.ancienStatut !== 'ANNULE') {
    return {
      titre: auteur ? `${auteur} a annulé le rendez-vous de ${heure}` : `Annulé par le patient : ${heure}`,
      detail,
    }
  }
  if (signal.deplace) {
    return {
      titre: auteur ? `${auteur} a déplacé un rendez-vous à ${heure}` : `Déplacé par le patient à ${heure}`,
      detail,
    }
  }
  return null
}

type Etat = { abonnes: Set<Abonne>; client: Client | null; demarrage: Promise<void> | null }

// Sur globalThis : le rechargement à chaud de Next recrée le module, et chaque
// copie ouvrirait sa propre écoute (même raison que le client Prisma).
const global = globalThis as unknown as { agendaEnDirect?: Etat }
const etat: Etat = (global.agendaEnDirect ??= { abonnes: new Set(), client: null, demarrage: null })

function peutVoir(ctx: AuthContext, sites: string[]) {
  return sites.some((s) => ctx.sitesAutorises.has(s))
}

async function relayer(signal: Signal) {
  const sites = [...new Set([signal.site, signal.ancienSite])]
  const destinataires = [...etat.abonnes].filter((a) => peutVoir(a.ctx, sites))
  if (destinataires.length === 0) return

  // L'auteur : la dernière écriture tracée sur ce rendez-vous (D9), s'il y en
  // a une toute récente. Aucune : le geste vient du portail patient.
  const [rdv, trace] = await Promise.all([
    signal.op === 'DELETE'
      ? null
      : prisma.rendezVous.findUnique({
          where: { id: signal.id },
          select: {
            debut: true,
            praticienId: true,
            patient: { select: { prenom: true, nom: true } },
            motif: { select: { estUrgence: true } },
          },
        }),
    prisma.auditLog.findFirst({
      where: { entityId: signal.id, action: { not: 'READ' }, occurredAt: { gte: new Date(Date.now() - 30_000) } },
      orderBy: { id: 'desc' },
      select: { actorId: true },
    }),
  ])
  const auteurId = trace?.actorId ?? null
  const auteur = auteurId
    ? await prisma.user.findUnique({
        where: { id: auteurId },
        select: { prenom: true, nom: true, praticien: { select: { nom: true } } },
      })
    : null
  const nomAuteur = auteur ? (auteur.praticien ? `Dr ${auteur.praticien.nom}` : `${auteur.prenom} ${auteur.nom}`) : null

  const banniere = rdv
    ? texteBanniere(
        signal,
        { debut: rdv.debut, patient: `${rdv.patient.prenom} ${rdv.patient.nom}`, urgence: rdv.motif.estUrgence },
        nomAuteur,
      )
    : null

  for (const a of destinataires) {
    if (auteurId && a.ctx.userId === auteurId) continue
    // Le rendez-vous d'un confrère : l'écran du praticien se rafraîchit, sans bandeau ni nom de patient (27/10).
    const pourLui = !a.ctx.praticienRestreint || rdv?.praticienId === a.ctx.praticienRestreint
    // Le nom du patient part vers cet écran : c'est une lecture, tracée comme
    // celle de l'agenda (D9).
    if (banniere && pourLui) await recordRead(a.ctx, 'agenda', 1, signal.id).catch(() => undefined)
    a.envoyer({ id: signal.id, banniere: pourLui ? banniere : null })
  }
}

async function demarrer() {
  const client = new Client({ connectionString: env.REALTIME_DATABASE_URL ?? env.DATABASE_URL })
  client.on('notification', (n) => {
    if (n.channel !== 'agenda' || !n.payload) return
    let signal: Signal
    try {
      signal = JSON.parse(n.payload) as Signal
    } catch {
      return
    }
    relayer(signal).catch((e) => console.error('[agenda en direct] relais impossible', e))
  })
  // Connexion perdue (redémarrage de la base, coupure réseau) : on la
  // rouvrira au prochain abonnement. Les écrans, eux, se reconnectent seuls.
  const oublier = () => {
    if (etat.client === client) etat.client = null
  }
  client.on('error', (e) => {
    console.error('[agenda en direct] écoute interrompue', e.message)
    oublier()
  })
  client.on('end', oublier)
  await client.connect()
  await client.query('LISTEN agenda')
  etat.client = client
}

/**
 * Abonne un écran. À n'appeler qu'avec un contexte qui a passé la garde de
 * lecture de l'agenda. Rend la fonction de désabonnement.
 */
export async function abonnerAgenda(ctx: AuthContext, envoyer: (e: EvenementAgenda) => void): Promise<() => void> {
  if (!etat.client) {
    etat.demarrage ??= demarrer().finally(() => {
      etat.demarrage = null
    })
    await etat.demarrage
  }
  const abonne: Abonne = { ctx, envoyer }
  etat.abonnes.add(abonne)
  return () => {
    etat.abonnes.delete(abonne)
  }
}

/** Ferme l'écoute — pour les tests, qui ne doivent pas laisser de connexion ouverte. */
export async function arreterEcouteAgenda(): Promise<void> {
  const client = etat.client
  etat.client = null
  etat.abonnes.clear()
  await client?.end()
}
