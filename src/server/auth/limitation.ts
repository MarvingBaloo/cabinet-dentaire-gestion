import 'server-only'

import { prisma } from '@/server/db/client'

// Limitation par adresse IP, en complément du verrouillage par compte.
//
// POURQUOI LE VERROU PAR COMPTE NE SUFFIT PAS : il bloque après 5 échecs sur UN
// compte. Rien n'empêche d'essayer quatre mots de passe courants sur cinquante
// comptes — aucun verrou ne se déclenche, et c'est précisément ainsi que se
// mènent les attaques par pulvérisation de mots de passe.
//
// POURQUOI PAS DE TABLE NI DE DÉPENDANCE : le journal d'audit enregistre déjà
// chaque échec avec son adresse IP et son horodatage. Le compteur s'y lit
// directement. Un compteur en mémoire serait par ailleurs faux dès qu'on fait
// tourner plus d'une instance — ce que l'hébergement HDS conteneurisé permettra.

const FENETRE_MINUTES = 15

// ⚠ Le cabinet entier sort sur UNE seule IP publique (NAT). Ce seuil compte donc
// les échecs de tout le personnel confondu. 20 en quinze minutes reste très
// au-dessus d'un usage normal — cinq personnes qui se trompent quatre fois
// chacune dans le même quart d'heure — tout en arrêtant une pulvérisation.
const MAX_ECHECS_PAR_IP = 20

export async function tropDeTentatives(ipAddress: string): Promise<boolean> {
  if (ipAddress === 'inconnue') return false

  const depuis = new Date(Date.now() - FENETRE_MINUTES * 60_000)

  const echecs = await prisma.auditLog.count({
    where: {
      action: 'LOGIN_FAILURE',
      ipAddress,
      occurredAt: { gte: depuis },
    },
  })

  return echecs >= MAX_ECHECS_PAR_IP
}
