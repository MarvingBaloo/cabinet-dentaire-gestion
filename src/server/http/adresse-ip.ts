import 'server-only'

import { headers } from 'next/headers'

// L'adresse du client, telle que la pose le reverse proxy de l'hébergeur.
// `x-forwarded-for` porte l'adresse du client en première position, puis les
// proxys traversés ; `x-real-ip` est le repli quand l'en-tête est absent.
//
// Trois lectures identiques avant celle-ci (session, réservation, accès
// patient) : la règle du projet est de factoriser à la troisième occurrence
// similaire, pas avant.
export async function adresseIpClient(): Promise<string> {
  const h = await headers()
  const transmise = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return transmise || h.get('x-real-ip') || 'inconnue'
}
