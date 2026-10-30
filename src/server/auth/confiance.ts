import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/server/db/client'

// Poste de confiance (D7quater) : le second facteur n'est demandé que depuis une
// machine que cette personne n'a pas encore éprouvée.
//
// CE QUE ÇA PROTÈGE ENCORE. Le second facteur sert d'abord contre le vol
// d'identifiants À DISTANCE — un mot de passe obtenu par hameçonnage, utilisé
// depuis n'importe où. Cette menace reste couverte : une machine inconnue exige
// toujours le code.
//
// CE QUE ÇA CONCÈDE. Quelqu'un qui connaît le mot de passe ET se trouve
// physiquement devant un poste du cabinet entre sans code. C'est la contrepartie
// assumée : dans un cabinet, cette personne aurait de toute façon accès aux
// dossiers papier et aux écrans ouverts. Restent, contre ce cas : le
// verrouillage sur inactivité, le journal qui nomme le poste, et la révocation
// du poste depuis l'écran Postes.

/** 30 jours **d'inactivité**, et non 30 jours depuis l'enrôlement : le délai
 *  repart à chaque connexion depuis ce poste. Assez long pour ne pas gêner,
 *  assez court pour qu'un poste oublié ou revendu cesse d'être reconnu sans
 *  intervention — c'est celui qui ne sert plus qui expire. */
const DUREE_JOURS = 30

type Db = Prisma.TransactionClient | typeof prisma

export async function estPosteDeConfiance(
  userId: string,
  workstationId: string | null,
): Promise<boolean> {
  if (!workstationId) return false

  const confiance = await prisma.trustedWorkstation.findUnique({
    where: { userId_workstationId: { userId, workstationId } },
    select: { trustedUntil: true },
  })

  return !!confiance && confiance.trustedUntil > new Date()
}

/** Accordée après une validation réussie du second facteur, puis prolongée à
 *  CHAQUE connexion depuis ce poste — y compris celles que la confiance dispense
 *  de code. Un poste utilisé tous les jours ne redemande donc jamais de SMS ;
 *  seul celui qu'on cesse d'utiliser expire. */
export async function accorderConfiance(
  userId: string,
  workstationId: string | null,
): Promise<void> {
  if (!workstationId) return

  const trustedUntil = new Date(Date.now() + DUREE_JOURS * 24 * 3_600_000)

  await prisma.trustedWorkstation.upsert({
    where: { userId_workstationId: { userId, workstationId } },
    update: { trustedUntil },
    create: { userId, workstationId, trustedUntil },
  })
}

/**
 * Retire toute confiance accordée à une personne.
 *
 * INDISPENSABLE à la réinitialisation du second facteur : sans cela, remettre à
 * zéro le MFA d'un téléphone perdu laisserait celui qui détient le mot de passe
 * entrer sans code depuis un poste déjà éprouvé — la réinitialisation n'aurait
 * alors servi à rien.
 */
export async function revoquerConfiance(userId: string, db: Db = prisma): Promise<number> {
  const { count } = await db.trustedWorkstation.deleteMany({ where: { userId } })
  return count
}
