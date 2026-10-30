import { config as loadEnv } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

// Le CLI Prisma ne lit plus .env tout seul depuis la v7. On charge le même
// fichier que Next.js, pour qu'il n'existe qu'une source de vérité locale.
loadEnv({ path: '.env.local', quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',

  // DIRECT_DATABASE_URL et jamais DATABASE_URL : les migrations doivent tourner
  // avec le rôle propriétaire. Les lancer avec le rôle applicatif le rendrait
  // propriétaire des tables et annulerait les REVOKE qui protègent audit_log.
  datasource: {
    url: env('DIRECT_DATABASE_URL'),
  },

  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
