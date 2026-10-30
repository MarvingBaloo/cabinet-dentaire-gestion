import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { env } from '@/config/env'
import { prisma } from '@/server/db/client'

// Identification du poste de travail (D7).
//
// POURQUOI CE N'EST PAS L'ADRESSE IP : tous les postes du cabinet sortent sur une
// seule IP publique (NAT). Le journal dirait « quelqu'un depuis le cabinet »,
// jamais « le PC de l'accueil ».
//
// MÊME PATRON QUE LES SESSIONS : le cookie porte un secret opaque de 32 octets,
// la base n'en stocke que le SHA-256. Un export de la base ne permet donc pas de
// se faire passer pour un poste déclaré. Aucune clé de signature n'est
// nécessaire — le secret est déjà inguessable.

export const NOM_COOKIE_POSTE = 'cabinet_poste'

/** Un an : le poste est un meuble, pas une session. */
const DUREE_SECONDES = 365 * 24 * 3600

const condenser = (secret: string) => createHash('sha256').update(secret).digest('hex')

export type PosteIdentifie = { id: string; siteId: string | null }

/**
 * Le poste porte aussi le SITE : le PC de l'accueil de Marie-Galante est
 * physiquement à Marie-Galante. C'est la seule source fiable du site pour une
 * entrée d'audit — l'utilisateur, lui, exerce en alternance sur les deux (D5).
 *
 * `siteId` reste nul tant qu'un ADMIN n'a pas rattaché le poste à un site.
 */
export async function identifierPoste(
  secret: string | undefined,
): Promise<PosteIdentifie | null> {
  if (!secret) return null

  const poste = await prisma.workstation.findFirst({
    where: { secretHash: condenser(secret), actif: true },
    select: { id: true, siteId: true },
  })
  if (!poste) return null

  await prisma.workstation.update({
    where: { id: poste.id },
    data: { lastSeenAt: new Date() },
  })

  return poste
}

/**
 * Déclare un poste inconnu, sous un nom provisoire qu'un ADMIN renommera.
 *
 * L'enregistrement est automatique et non manuel : exiger qu'un administrateur
 * déclare la machine AVANT toute connexion rendrait le premier accès impossible
 * depuis un poste neuf. On préfère un poste identifié sous un nom provisoire à
 * un poste non identifié — le journal doit pouvoir distinguer deux machines même
 * si personne ne les a encore nommées.
 */
export async function declarerPoste(): Promise<{ secret: string; poste: PosteIdentifie }> {
  const secret = randomBytes(32).toString('base64url')

  // Le nom est unique en base. Un horodatage seul ne suffit pas : deux postes
  // déclarés dans la même minute entreraient en collision — ce qui arrive au
  // déploiement, quand tous les postes du cabinet se connectent d'affilée.
  const marqueur = randomBytes(3).toString('hex').toUpperCase()

  const poste = await prisma.workstation.create({
    data: {
      nom: `Poste non nommé ${marqueur} — ${new Date().toISOString().slice(0, 10)}`,
      secretHash: condenser(secret),
      lastSeenAt: new Date(),
    },
    select: { id: true, siteId: true },
  })

  return { secret, poste }
}

/** Un téléphone se reconnaît à son navigateur : c'est lui seul qui peut valider une connexion par QR code (D83). */
export function estUnTelephone(userAgent: string | null | undefined): boolean {
  return !!userAgent && /iPhone|iPod|Android.*Mobile/i.test(userAgent)
}

/** Le poste est marqué téléphone dès qu'on s'y connecte depuis un navigateur de téléphone. */
export async function marquerTelephone(posteId: string): Promise<void> {
  await prisma.workstation.updateMany({ where: { id: posteId, telephone: false }, data: { telephone: true } })
}

export function optionsCookiePoste() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.SESSION_COOKIE_SECURE,
    path: '/',
    maxAge: DUREE_SECONDES,
  }
}
