import 'server-only'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

import { env } from '@/config/env'

// Singleton : en développement, le rechargement à chaud de Next recrée le module
// à chaque édition. Sans cette mise en cache sur globalThis, chaque rechargement
// ouvre un nouveau pool et la base finit par refuser les connexions.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
