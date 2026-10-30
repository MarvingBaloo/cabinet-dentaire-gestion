// Amorçage : crée ou réinitialise un compte administrateur.
//
// Nécessaire parce que l'application ne permet pas de créer un compte sans être
// déjà connecté avec la permission `utilisateur:create` — le premier compte doit
// donc venir d'ailleurs. C'est le problème classique du premier administrateur.
//
// ⚠ Le mot de passe est passé en argument : il finit dans l'historique du shell.
// En production, le changer à la première connexion.
//
// Client Prisma propre, comme prisma/seed.ts : les modules de `src/server` sont
// marqués `server-only` et ne s'importent pas depuis un script.
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, RoleName } from '@prisma/client'
import { config } from 'dotenv'

import { hashPassword } from '../src/server/auth/password'

config({ path: '.env.local', quiet: true })

async function main() {
  const [email, motDePasse] = process.argv.slice(2)
  if (!email || !motDePasse) {
    console.error('usage: npm run creer-admin -- <email> <mot de passe>')
    process.exit(1)
  }
  if (motDePasse.length < 12) {
    console.error('mot de passe : 12 caractères minimum')
    process.exit(1)
  }

  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL manquant')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  const passwordHash = await hashPassword(motDePasse)
  const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } })

  const utilisateur = await prisma.user.upsert({
    where: { email },
    // Réinitialise aussi le verrou : ce script est le recours quand plus
    // personne ne peut se connecter.
    update: { passwordHash, actif: true, lockedUntil: null, failedLoginCount: 0 },
    create: {
      email,
      nom: 'Administrateur',
      prenom: 'Compte',
      passwordHash,
      roles: { create: { roleId: role.id } },
    },
    select: { email: true, mfaEnrolledAt: true },
  })

  console.log(`compte prêt : ${utilisateur.email}`)
  console.log(
    utilisateur.mfaEnrolledAt
      ? 'double authentification déjà active sur ce compte'
      : 'la double authentification sera configurée à la première connexion',
  )

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
