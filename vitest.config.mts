import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'vitest/config'

loadEnv({ path: '.env.local', quiet: true })

// Les tests écrivent TOUJOURS dans la base de test, jamais dans celle qu'on
// regarde. La bascule est ici et non dans les fichiers de test : une règle qui
// dépend de la discipline de chaque test finit par être oubliée une fois.
//
// Le journal d'audit est indestructible par construction : les comptes créés par
// les tests ne peuvent jamais être supprimés. Sans cette séparation, ils
// s'accumulent indéfiniment dans la base de travail.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
if (process.env.TEST_DIRECT_DATABASE_URL) {
  process.env.DIRECT_DATABASE_URL = process.env.TEST_DIRECT_DATABASE_URL
}

const resoudre = (chemin: string) => fileURLToPath(new URL(chemin, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resoudre('./src'),
      // `server-only` lève à l'import hors contexte serveur React. C'est
      // exactement son rôle en production — il garantit qu'un module portant des
      // secrets ne peut pas partir dans un bundle client. Sous Vitest, on
      // l'annule : le test EST le contexte serveur.
      'server-only': resoudre('./tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Les tests écrivent dans la même base : en parallèle, ils se marcheraient
    // dessus sur audit_log, qu'aucun d'eux ne peut nettoyer.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
