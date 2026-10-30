import 'server-only'

import { Prisma } from '@prisma/client'

// D54 : les contraintes d'exclusion GiST de `rendez_vous` (03_agenda_contraintes.sql)
// sont le dernier mot sur un chevauchement — mais deux écritures concurrentes
// visant le MÊME créneau se voient l'une l'autre le temps de vérifier ces
// contraintes et Postgres tranche par un interblocage plutôt qu'un refus
// propre (40P01, `deadlock detected`). Ce n'est pas une erreur applicative :
// la base n'a pas encore décidé qui gagne, on rejoue.
//
// Ancien état : quatre copies identiques d'`estChevauchementBase`
// (reservation-publique.ts, acces-patient.ts, agenda.ts × 2) — un seul
// domicile désormais (D12 le disait déjà pour la garde de chevauchement,
// jamais appliqué jusqu'ici à la lettre).

/**
 * 23P01 = exclusion_violation : nos contraintes de non-chevauchement
 * (`rdv_praticien_sans_chevauchement`, `rdv_fauteuil_sans_chevauchement`).
 * Trois chemins d'écriture partagent cette garde (D12) : la réservation
 * publique, le déplacement par le patient, et l'agenda du personnel.
 */
export function estChevauchementBase(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = e.meta as { code?: string; constraint?: string } | undefined
    if (meta?.code === '23P01') return true
    if (typeof meta?.constraint === 'string' && meta.constraint.includes('sans_chevauchement')) {
      return true
    }
  }
  return e instanceof Error && e.message.includes('sans_chevauchement')
}

/**
 * Interblocage (40P01) — et, avec lui, le conflit de sérialisation (40001) :
 * avec l'adaptateur `@prisma/adapter-pg` (celui de ce projet, `src/server/db/client.ts`),
 * `mapDriverError` (node_modules/@prisma/adapter-pg/dist/index.js) fait
 * atterrir les DEUX codes SQL sur le même `kind: 'TransactionWriteConflict'`,
 * que Prisma restitue en code `P2034` (node_modules/@prisma/client/runtime/client.js).
 * Impossible de distinguer les deux à partir de `P2034` seul — et ce n'est pas
 * la peine : un conflit de sérialisation appelle exactement la même réponse
 * qu'un interblocage, la base n'a pas tranché, on rejoue (D54 ne le demandait
 * que pour 40P01, l'extension à 40001 est un choix pris ici, à valider).
 *
 * Le code SQL d'origine, quand il est là, se lit dans
 * `meta.driverAdapterError.cause.originalCode` — c'est la forme réelle
 * observée avec l'adaptateur pg. `meta.code` est gardé en repli : une future
 * version de Prisma, ou un moteur non-adaptateur, peut le poser directement.
 */
export function estInterblocage(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false

  const meta = e.meta as
    | { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } }
    | undefined
  const codeOrigine = meta?.driverAdapterError?.cause?.originalCode ?? meta?.code
  if (codeOrigine === '40P01' || codeOrigine === '40001') return true

  return e.code === 'P2034'
}

const attenteAleatoire = (minMs: number, maxMs: number) =>
  new Promise((resolve) => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)))

/**
 * Rejoue `fn` (une transaction) sur interblocage, jusqu'à `tentatives` essais
 * au total (D54). Au rejeu, si l'autre transaction a entre-temps validé, la
 * contrainte d'exclusion répond proprement 23P01 — `estChevauchementBase`
 * reconnaît alors un refus ordinaire, jamais une page d'erreur.
 *
 * Une courte attente aléatoire sépare les tentatives : sans elle, deux
 * transactions relancées au même instant s'interbloqueraient de nouveau selon
 * le même schéma.
 *
 * Après la dernière tentative, l'erreur — d'interblocage ou toute autre —
 * remonte TELLE QUELLE : ce n'est pas à cette fonction de décider que trois
 * interblocages de suite valent un chevauchement, c'est à l'appelant, qui
 * teste déjà `estChevauchementBase(e) || estInterblocage(e)` dans son propre
 * `catch`.
 */
export async function avecRepriseSurInterblocage<T>(fn: () => Promise<T>, tentatives = 3): Promise<T> {
  for (let tentative = 1; tentative <= tentatives; tentative++) {
    try {
      return await fn()
    } catch (e) {
      if (tentative === tentatives || !estInterblocage(e)) throw e
      await attenteAleatoire(10, 50)
    }
  }
  // Inatteignable : la boucle ci-dessus rend ou relance à chaque itération.
  throw new Error('avecRepriseSurInterblocage : état impossible')
}
