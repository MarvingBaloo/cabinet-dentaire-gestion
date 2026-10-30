// Purge du journal d'audit à l'échéance de sa durée de conservation.
//
// À PLANIFIER SUR L'HÉBERGEUR (une fois par jour suffit). Sans cette tâche, la
// durée de conservation n'est qu'une intention : le journal grossit
// indéfiniment, et la table la plus sollicitée de la base devient ingérable.
//
// Le droit à l'effacement du RGPD ne s'applique pas à ce journal — la
// traçabilité des accès aux données de santé est une obligation légale
// (art. 17.3.b). Ce qui s'applique est une DURÉE DE CONSERVATION. D'où une purge
// planifiée, et non une suppression à la demande. Voir ARCHITECTURE.md (D9).
//
// Tourne avec le RÔLE PROPRIÉTAIRE : purge_audit_log est la seule voie qui lève
// le verrou append-only, et son exécution est refusée au rôle applicatif.
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

async function main() {
  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL manquant : la purge exige le rôle propriétaire.')

  const mois = Number(process.env.AUDIT_RETENTION_MONTHS)
  if (!Number.isInteger(mois) || mois < 12) {
    throw new Error(`AUDIT_RETENTION_MONTHS invalide (${process.env.AUDIT_RETENTION_MONTHS}) : entier ≥ 12 attendu.`)
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  const lignes = await prisma.$queryRaw<{ purge_audit_log: bigint }[]>`
    SELECT purge_audit_log(${mois}::int)
  `
  const supprimees = lignes[0]?.purge_audit_log ?? BigInt(0)

  console.log(`purge du journal : ${supprimees} entrée(s) au-delà de ${mois} mois`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
