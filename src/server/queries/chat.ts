import 'server-only'

import { RoleName, StatutRendezVous } from '@prisma/client'

import { heureCabinet, jourEnCourt, jourLocal } from '@/lib/dates'
import { LIBELLE_ROLE } from '@/lib/roles'
import { afficherTelephone } from '@/lib/telephone'
import type { AuthContext } from '@/server/auth/context'
import { filtrePraticien, filtreSite } from '@/server/auth/portee'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import { paire } from '@/server/domaine/chat'
import { rechercherPatients, sesPatients } from '@/server/queries/patients'

// Le chat interne (D82). Chacun ne lit que ses propres conversations : toute lecture part de `ctx.userId`.
// Ce qu'un message cite (un patient, un rendez-vous) n'est montré qu'à qui peut le voir ailleurs dans le logiciel :
// un praticien qui n'administre pas ne voit pas, même cité, le patient d'un confrère.

export type Collegue = {
  id: string
  nom: string
  role: string
  initiales: string
  couleur: string | null
}

const SAUGE = '#387a70'

const CHAMPS_COLLEGUE = {
  id: true,
  prenom: true,
  nom: true,
  roles: { select: { role: { select: { name: true } } } },
  sites: { select: { site: { select: { nom: true } } } },
  praticien: { select: { prenom: true, nom: true, couleur: true } },
} as const

type CollegueBrut = {
  id: string
  prenom: string
  nom: string
  roles: { role: { name: RoleName } }[]
  sites: { site: { nom: string } }[]
  praticien: { prenom: string; nom: string; couleur: string } | null
}

const court = (nom: string) => nom.replace(/^Cabinet de /, '')

function collegue(u: CollegueBrut): Collegue {
  const noms = u.roles.map((r) => r.role.name)
  const role = u.praticien
    ? LIBELLE_ROLE.PRATICIEN
    : LIBELLE_ROLE[
        ([RoleName.SECRETAIRE, RoleName.ASSISTANTE, RoleName.ADMIN] as const).find((r) => noms.includes(r)) ?? 'ADMIN'
      ]
  const sites = u.sites.map((s) => court(s.site.nom)).join(', ')
  return {
    id: u.id,
    nom: u.praticien ? `Dr ${u.praticien.prenom} ${u.praticien.nom}` : `${u.prenom} ${u.nom}`,
    role: sites ? `${role} · ${sites}` : role,
    initiales: (u.prenom.charAt(0) + u.nom.charAt(0)).toUpperCase(),
    couleur: u.praticien?.couleur ?? SAUGE,
  }
}

export type LigneConversation = {
  collegue: Collegue
  dernier: { texte: string; envoyeLe: Date; deMoi: boolean } | null
  nonLus: number
}

/** La colonne de gauche : chaque collègue actif, ceux à qui l'on a écrit d'abord, du plus récent au plus ancien. */
export async function listerConversations(ctx: AuthContext): Promise<LigneConversation[]> {
  const [collegues, conversations, nonLus] = await Promise.all([
    prisma.user.findMany({
      where: { actif: true, id: { not: ctx.userId } },
      select: CHAMPS_COLLEGUE,
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    }),
    prisma.conversationChat.findMany({
      where: { OR: [{ userAId: ctx.userId }, { userBId: ctx.userId }] },
      select: {
        userAId: true,
        userBId: true,
        dernierMessageLe: true,
        messages: {
          orderBy: { envoyeLe: 'desc' },
          take: 1,
          select: { texte: true, envoyeLe: true, auteurId: true },
        },
      },
    }),
    prisma.messageChat.groupBy({
      by: ['auteurId'],
      where: {
        luLe: null,
        auteurId: { not: ctx.userId },
        conversation: {
          OR: [{ userAId: ctx.userId }, { userBId: ctx.userId }],
        },
      },
      _count: true,
    }),
  ])
  const parCollegue = new Map(conversations.map((c) => [c.userAId === ctx.userId ? c.userBId : c.userAId, c]))
  const lignes = collegues.map((u) => {
    const c = parCollegue.get(u.id)
    const m = c?.messages[0]
    return {
      collegue: collegue(u),
      dernier: m
        ? {
            texte: m.texte,
            envoyeLe: m.envoyeLe,
            deMoi: m.auteurId === ctx.userId,
          }
        : null,
      nonLus: nonLus.find((n) => n.auteurId === u.id)?._count ?? 0,
    }
  })
  // Le texte des derniers messages part vers l'écran : une lecture, tracée comme les autres (D9).
  await recordRead(ctx, 'conversation_chat', conversations.length)
  return lignes.sort(
    (a, b) =>
      (b.dernier?.envoyeLe.getTime() ?? 0) - (a.dernier?.envoyeLe.getTime() ?? 0) ||
      a.collegue.nom.localeCompare(b.collegue.nom, 'fr'),
  )
}

/** Les messages qu'on n'a pas encore lus : la pastille sur « Chat ». */
export async function compterNonLus(ctx: AuthContext): Promise<number> {
  return prisma.messageChat.count({
    where: {
      luLe: null,
      auteurId: { not: ctx.userId },
      conversation: { OR: [{ userAId: ctx.userId }, { userBId: ctx.userId }] },
    },
  })
}

export type Citation = { accessible: true; titre: string; detail: string; href: string } | { accessible: false }

export type MessageAffiche = {
  id: string
  texte: string
  envoyeLe: Date
  deMoi: boolean
  citation: Citation | null
}

const MAX_MESSAGES = 200

const libelleRendezVous = (debut: Date) => `${jourEnCourt(jourLocal(debut))} · ${heureCabinet(debut)}`

/** Une conversation : le collègue et ses derniers messages, du plus ancien au plus récent. `null` : pas de collègue. */
export async function lireConversation(ctx: AuthContext, collegueId: string) {
  const u = await prisma.user.findFirst({
    where: { id: collegueId, actif: true, NOT: { id: ctx.userId } },
    select: CHAMPS_COLLEGUE,
  })
  if (!u) return null
  const messages = (
    await prisma.messageChat.findMany({
      where: { conversation: paire(ctx.userId, collegueId) },
      select: {
        id: true,
        texte: true,
        envoyeLe: true,
        auteurId: true,
        patientId: true,
        rendezVousId: true,
      },
      orderBy: { envoyeLe: 'desc' },
      take: MAX_MESSAGES,
    })
  ).reverse()

  const idsRdv = messages.flatMap((m) => (m.rendezVousId ? [m.rendezVousId] : []))
  const idsPatients = messages.flatMap((m) => (m.patientId && !m.rendezVousId ? [m.patientId] : []))
  const [rdvs, patients] = await Promise.all([
    idsRdv.length
      ? prisma.rendezVous.findMany({
          where: {
            id: { in: idsRdv },
            ...filtreSite(ctx),
            ...filtrePraticien(ctx),
          },
          select: {
            id: true,
            debut: true,
            patient: { select: { prenom: true, nom: true } },
            motif: { select: { libelle: true } },
            fauteuil: { select: { nom: true } },
          },
        })
      : [],
    idsPatients.length
      ? prisma.patient.findMany({
          where: { id: { in: idsPatients }, ...sesPatients(ctx) },
          select: { id: true, prenom: true, nom: true },
        })
      : [],
  ])

  const citation = (m: (typeof messages)[number]): Citation | null => {
    if (m.rendezVousId) {
      const r = rdvs.find((x) => x.id === m.rendezVousId)
      return r
        ? {
            accessible: true,
            titre: `${r.patient.prenom} ${r.patient.nom} · ${libelleRendezVous(r.debut)}`,
            detail: `${r.motif.libelle} · ${r.fauteuil.nom}`,
            href: `/tableau-de-bord/agenda?vue=jour&date=${jourLocal(r.debut)}&rdv=${r.id}`,
          }
        : { accessible: false }
    }
    if (m.patientId) {
      const p = patients.find((x) => x.id === m.patientId)
      return p
        ? {
            accessible: true,
            titre: `${p.prenom} ${p.nom}`,
            detail: 'Fiche du patient',
            href: `/tableau-de-bord/patients/${p.id}`,
          }
        : { accessible: false }
    }
    return null
  }

  await recordRead(ctx, 'message_chat', messages.length, collegueId)
  if (rdvs.length || patients.length) await recordRead(ctx, 'patient', rdvs.length + patients.length)
  return {
    collegue: collegue(u),
    messages: messages.map((m): MessageAffiche => ({
      id: m.id,
      texte: m.texte,
      envoyeLe: m.envoyeLe,
      deMoi: m.auteurId === ctx.userId,
      citation: citation(m),
    })),
  }
}

export type CitationTrouvee = {
  patient: { id: string; nom: string; detail: string }
  rendezVous: { id: string; libelle: string; detail: string }[]
}

/** « ＋ Citer un patient » : les patients que l'on peut voir, et leurs prochains rendez-vous. */
export async function chercherCitations(ctx: AuthContext, terme: string): Promise<CitationTrouvee[]> {
  const patients = (await rechercherPatients(ctx, terme)).slice(0, 6)
  if (patients.length === 0) return []
  const rdvs = await prisma.rendezVous.findMany({
    where: {
      ...filtreSite(ctx),
      ...filtrePraticien(ctx),
      patientId: { in: patients.map((p) => p.id) },
      debut: { gte: new Date() },
      statut: { notIn: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT] },
    },
    select: {
      id: true,
      patientId: true,
      debut: true,
      motif: { select: { libelle: true } },
      praticien: { select: { nom: true } },
    },
    orderBy: { debut: 'asc' },
  })
  return patients.map((p) => {
    const siens = rdvs.filter((r) => r.patientId === p.id).slice(0, 3)
    return {
      patient: {
        id: p.id,
        nom: `${p.prenom} ${p.nom}`,
        detail: `${afficherTelephone(p.telephone)} · ${siens.length ? 'la fiche du patient' : 'aucun rendez-vous à venir'}`,
      },
      rendezVous: siens.map((r) => ({
        id: r.id,
        libelle: libelleRendezVous(r.debut),
        detail: `${r.motif.libelle} · Dr ${r.praticien.nom}`,
      })),
    }
  })
}
