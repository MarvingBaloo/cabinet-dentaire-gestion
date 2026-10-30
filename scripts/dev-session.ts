// Ouvre une session de développement et affiche le cookie à poser.
//
// POURQUOI. Regarder un écran protégé demandait de traverser tout le parcours
// de connexion à la main. Ce script pose une session valide en base — la même
// qu'une vraie connexion produit, avec le second facteur déjà validé — et rend
// le cookie correspondant. De quoi ouvrir une page avec curl, un navigateur
// piloté, ou simplement coller le cookie dans le sien.
//
// CE QU'IL N'EST PAS. Il n'ajoute rien à l'application : ni route de
// contournement, ni mode « développement » dans le code de production. La
// session créée est une session ordinaire, soumise à l'expiration, à
// l'inactivité et à la révocation comme les autres. Le script sait seulement
// écrire directement dans la table, ce que n'importe quel accès à la base
// permet — et cet accès, en production, est justement ce qui est protégé.
//
// ⚠ Refuse de tourner ailleurs que sur une base de développement.
import { createHash, randomBytes } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const BASES_AUTORISEES = /\/(cabinet_dentaire|cabinet_test|cabinet_demo|cabinet_chaine)$/
const NOM_COOKIE = 'cabinet_session'
const DUREE_HEURES = 12

async function main() {
  const email = process.argv[2] ?? 'dev@cabinet.local'

  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL manquant')
  if (!BASES_AUTORISEES.test(url)) {
    console.error(`Refus : base non reconnue comme base de développement (${url.split('/').pop()}).`)
    process.exit(1)
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, actif: true } })
  if (!user) {
    console.error(`Aucun compte ${email}. Lancez d'abord : npm run dev:compte`)
    process.exit(1)
  }
  if (!user.actif) {
    console.error(`Le compte ${email} est désactivé.`)
    process.exit(1)
  }

  const jeton = randomBytes(32).toString('base64url')
  const maintenant = new Date()

  await prisma.session.create({
    data: {
      userId: user.id,
      sessionToken: createHash('sha256').update(jeton).digest('hex'),
      expiresAt: new Date(maintenant.getTime() + DUREE_HEURES * 3_600_000),
      // Le second facteur est marqué validé : c'est ce qui distingue cette
      // session d'une connexion à moitié faite, et ce que le script remplace.
      mfaValidatedAt: maintenant,
      lastActivityAt: maintenant,
      ipAddress: '127.0.0.1',
      userAgent: 'dev-session',
    },
  })

  console.log(`
Session ouverte pour ${email}, valable ${DUREE_HEURES} h.

  Cookie      ${NOM_COOKIE}=${jeton}

  curl        curl -b '${NOM_COOKIE}=${jeton}' http://localhost:3000/tableau-de-bord/agenda

  Navigateur  ouvrir http://localhost:3000, console :
              document.cookie = '${NOM_COOKIE}=${jeton}; path=/'
              puis recharger.
`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
