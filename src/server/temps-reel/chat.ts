import 'server-only'

import { Client } from 'pg'

import { env } from '@/config/env'
import type { AuthContext } from '@/server/auth/context'

// Chat en direct (D82), sur le modèle de l'agenda (D61) : le déclencheur `message_chat_notifier` signale chaque
// message et chaque conversation lue sur le canal `chat` ; UNE connexion par processus l'écoute et relaie aux écrans
// des deux personnes concernées, et d'elles seules. Le signal ne porte aucun texte : l'écran relit ses messages.

type Signal =
  | {
      op: 'message'
      conversation: string
      auteur: string
      destinataire: string
    }
  | { op: 'lu'; conversation: string; lecteur: string }

/** Ce que reçoit un écran : un message pour lui (son et pastille), ou un simple rafraîchissement. */
export type EvenementChat = {
  op: 'message' | 'lu'
  de: string | null
  pourMoi: boolean
}

type Abonne = { ctx: AuthContext; envoyer: (e: EvenementChat) => void }
type Etat = {
  abonnes: Set<Abonne>
  client: Client | null
  demarrage: Promise<void> | null
}

const global = globalThis as unknown as { chatEnDirect?: Etat }
const etat: Etat = (global.chatEnDirect ??= {
  abonnes: new Set(),
  client: null,
  demarrage: null,
})

function relayer(signal: Signal) {
  for (const a of etat.abonnes) {
    const moi = a.ctx.userId
    if (signal.op === 'message' && (moi === signal.destinataire || moi === signal.auteur)) {
      a.envoyer({
        op: 'message',
        de: signal.auteur,
        pourMoi: moi === signal.destinataire,
      })
    } else if (signal.op === 'lu' && moi === signal.lecteur) {
      a.envoyer({ op: 'lu', de: null, pourMoi: false })
    }
  }
}

async function demarrer() {
  const client = new Client({
    connectionString: env.REALTIME_DATABASE_URL ?? env.DATABASE_URL,
  })
  client.on('notification', (n) => {
    if (n.channel !== 'chat' || !n.payload) return
    try {
      relayer(JSON.parse(n.payload) as Signal)
    } catch {
      // signal illisible : ignoré
    }
  })
  const oublier = () => {
    if (etat.client === client) etat.client = null
  }
  client.on('error', (e) => {
    console.error('[chat en direct] écoute interrompue', e.message)
    oublier()
  })
  client.on('end', oublier)
  await client.connect()
  await client.query('LISTEN chat')
  etat.client = client
}

/** Abonne un écran de la personne connectée. Rend la fonction de désabonnement. */
export async function abonnerChat(ctx: AuthContext, envoyer: (e: EvenementChat) => void): Promise<() => void> {
  if (!etat.client) {
    etat.demarrage ??= demarrer().finally(() => {
      etat.demarrage = null
    })
    await etat.demarrage
  }
  const abonne: Abonne = { ctx, envoyer }
  etat.abonnes.add(abonne)
  return () => {
    etat.abonnes.delete(abonne)
  }
}

/** Ferme l'écoute — pour les tests. */
export async function arreterEcouteChat(): Promise<void> {
  const client = etat.client
  etat.client = null
  etat.abonnes.clear()
  await client?.end()
}
