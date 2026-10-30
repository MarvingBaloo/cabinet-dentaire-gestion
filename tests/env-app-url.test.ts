import { afterEach, describe, expect, it, vi } from 'vitest'

// APP_URL obligatoire en production (D33, correctif tâche 0) : un défaut
// silencieux enverrait par SMS un lien mort vers un patient. La garde vit dans
// `src/config/env.ts`, exécutée à l'IMPORT du module — la seule façon de
// l'éprouver est de manipuler `process.env` puis de réimporter le module à
// froid (`vi.resetModules`). `vi.stubEnv` (plutôt qu'une affectation directe)
// contourne aussi le typage `readonly` que Next pose sur `NODE_ENV`, et
// `vi.unstubAllEnvs` restaure tout après chaque test — ce fichier ne doit rien
// laisser derrière lui pour les suites qui s'exécutent après.

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('APP_URL obligatoire en production (D33)', () => {
  it('refuse le démarrage en production réelle sans APP_URL', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_URL', undefined)
    vi.stubEnv('NEXT_PHASE', undefined)
    vi.resetModules()

    await expect(import('@/config/env')).rejects.toThrow(/APP_URL/)
  })

  it('n’exige rien pendant `next build` (NEXT_PHASE de compilation)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_URL', undefined)
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    vi.resetModules()

    const { env } = await import('@/config/env')
    expect(env.APP_URL).toBe('http://localhost:3000')
  })

  it('accepte la production réelle dès qu’APP_URL est fourni', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_URL', 'https://cabinet.example')
    vi.stubEnv('NEXT_PHASE', undefined)
    vi.resetModules()

    const { env } = await import('@/config/env')
    expect(env.APP_URL).toBe('https://cabinet.example')
  })

  it('garde le repli localhost hors production', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('APP_URL', undefined)
    vi.resetModules()

    const { env } = await import('@/config/env')
    expect(env.APP_URL).toBe('http://localhost:3000')
  })
})
