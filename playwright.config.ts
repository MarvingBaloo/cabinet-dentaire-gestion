import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

// Parcours dans le navigateur, rôle par rôle, contre la base de TEST : le serveur est lancé ici, branché sur
// TEST_DATABASE_URL, avec son propre dossier de construction (le `next dev` du poste peut rester ouvert).
// Trois navigateurs : Chrome, Safari (WebKit) et Safari d'iPhone — Marving est sur Mac, le cabinet aussi au
// téléphone, et le 20/10 un défaut n'existait que sous Safari.
// Une seule suite à la fois, comme Vitest : les deux écrivent dans la même base.
loadEnv({ path: '.env.local', quiet: true })

const PORT = 3210
const NAVIGATEURS = [
  { nom: 'chrome', use: { ...devices['Desktop Chrome'] } },
  { nom: 'safari', use: { ...devices['Desktop Safari'] } },
  { nom: 'iphone', use: { ...devices['iPhone 14'] } },
]

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/preparation.ts',
  globalTeardown: './e2e/nettoyage.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'America/Guadeloupe',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: NAVIGATEURS.flatMap(({ nom, use }) => [
    { name: `connexion-${nom}`, testMatch: /connexion\.setup\.ts/, use },
    {
      name: nom,
      testMatch: /\.spec\.ts/,
      dependencies: [`connexion-${nom}`],
      use: { ...use, storageState: `e2e/.auth/${nom}.json` },
    },
  ]),
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/connexion`,
    // Jamais un serveur inconnu : il pourrait être branché sur une autre base. E2E_REUTILISER=1 pour celui qu'on a
    // lancé soi-même avec les mêmes variables.
    reuseExistingServer: process.env.E2E_REUTILISER === '1',
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      DIRECT_DATABASE_URL: process.env.TEST_DIRECT_DATABASE_URL ?? '',
      NEXT_DIST_DIR: '.next-e2e',
      // Une passe complète dure longtemps : la mise en veille des sessions (15 min pour le cabinet) fermerait les
      // sessions préparées au début. Réglage du seul serveur de test.
      SESSION_IDLE_TIMEOUT_MINUTES: '120',
      // L'assistant des urgences (D77) répond avec son modèle scripté : aucun appel payant à Claude.
      ASSISTANT_SCRIPTE: '1',
      ANTHROPIC_API_KEY: '',
    },
  },
})
