// Compte de développement prêt à l'emploi.
//
// CE QUE CE SCRIPT NE FAIT PAS, ET NE FERA JAMAIS.
// Il n'ajoute aucun contournement dans l'application. Pas de variable
// d'environnement qui désactiverait le second facteur, pas de branche « si
// développement alors accepter n'importe quel code ». Un interrupteur pareil
// finit toujours par se retrouver en production, et rien dans le journal ne
// dirait qu'il était ouvert.
//
// Le compte produit est un compte NORMAL. Le second facteur fonctionne comme
// partout ailleurs ; c'est seulement le transporteur de SMS qui, hors
// production, écrit le message dans le terminal au lieu de l'envoyer.
//
// ⚠ Refuse de tourner sur une base dont le nom ne dit pas « dev » ou « test ».
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, RoleName } from '@prisma/client'
import { config } from 'dotenv'

import { hashPassword } from '../src/server/auth/password'

config({ path: '.env.local', quiet: true })

const MOT_DE_PASSE = 'DevCabinet2026!'
// Numéro fictif : le transporteur de développement écrit le SMS dans le
// terminal du serveur, il n'est jamais composé.
const MOBILE = '+590690000000'

/** Bases sur lesquelles ce script accepte d'écrire. */
const BASES_AUTORISEES = /\/(cabinet_dentaire|cabinet_test|cabinet_demo|cabinet_chaine)$/

function garde(url: string): void {
  const nom = url.split('/').pop()
  if (!BASES_AUTORISEES.test(url)) {
    console.error(
      `Refus : ce script n'écrit que sur une base de développement (reçu : ${nom}).\n` +
        "Il crée un compte au mot de passe connu de tous : il n'a rien à faire ailleurs.",
    )
    process.exit(1)
  }
}

async function main() {
  const email = process.argv[2] ?? 'dev@cabinet.local'
  const roleDemande = (process.argv[3] ?? 'ADMIN').toUpperCase() as RoleName

  if (!Object.values(RoleName).includes(roleDemande)) {
    console.error(`Rôle inconnu : ${roleDemande}. Attendus : ${Object.values(RoleName).join(', ')}`)
    process.exit(1)
  }

  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL manquant')
  garde(url)

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  const passwordHash = await hashPassword(MOT_DE_PASSE)
  const roles = await prisma.role.findMany({ where: { name: { in: [roleDemande] } } })

  const utilisateur = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      actif: true,
      lockedUntil: null,
      failedLoginCount: 0,
      telephoneMobile: MOBILE,
    },
    create: {
      email,
      nom: 'Développement',
      prenom: 'Compte',
      passwordHash,
      telephoneMobile: MOBILE,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
      // Rattaché aux deux sites : sans quoi le cloisonnement (D5) rendrait
      // l'agenda vide et ferait croire à un écran cassé.
      sites: { create: (await prisma.site.findMany({ select: { id: true } })).map((s) => ({ siteId: s.id })) },
    },
    select: { id: true, email: true },
  })

  // Un compte praticien a besoin de sa fiche d'agenda, sans quoi il se connecte
  // mais n'apparaît dans aucune liste de l'agenda.
  if (roleDemande === RoleName.PRATICIEN) {
    const existante = await prisma.praticien.findUnique({ where: { userId: utilisateur.id } })
    if (!existante) {
      await prisma.praticien.create({
        data: {
          userId: utilisateur.id,
          nom: 'Développement',
          prenom: 'Praticien',
          titre: 'Chirurgien-dentiste',
          couleur: '#387a70',
        },
      })
    }
  }

  // Rattrape le cas d'un compte préexistant sans site : même raison.
  const sites = await prisma.site.findMany({ select: { id: true } })
  for (const s of sites) {
    await prisma.userSite.upsert({
      where: { userId_siteId: { userId: utilisateur.id, siteId: s.id } },
      update: {},
      create: { userId: utilisateur.id, siteId: s.id },
    })
  }


  console.log(`
Compte de développement prêt.

  adresse      ${utilisateur.email}
  mot de passe ${MOT_DE_PASSE}
  rôle         ${roleDemande}
  sites        les deux (sinon l'agenda paraîtrait vide)${
    roleDemande === RoleName.PRATICIEN ? '\n  fiche agenda créée — il apparaît dans les plannings' : ''
  }

Le second facteur arrive par SMS. En développement, aucun SMS n'est envoyé : le
code s'affiche dans le terminal où tourne « npm run dev ».

Pour ouvrir une session sans passer par l'écran de connexion :

  npm run dev:session${email === 'dev@cabinet.local' ? '' : ` -- ${email}`}
`)


  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  process.exit(1)
})
