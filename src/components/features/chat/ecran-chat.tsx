import { notFound } from 'next/navigation'

import { Chat, type ConversationVue, type JourVue } from '@/components/features/chat/chat'
import { heureCabinet, jourLocal } from '@/lib/dates'
import { exigerContexte } from '@/server/auth/session-courante'
import { quandCourt, separateurJour } from '@/server/domaine/chat'
import { listerConversations, lireConversation } from '@/server/queries/chat'

/** L'écran « Chat » (maquette du 28/10) : la liste des collègues, et la conversation ouverte s'il y en a une. */
export async function EcranChat({ collegueId }: { collegueId?: string }) {
  const ctx = await exigerContexte()
  const [lignes, ouverte] = await Promise.all([
    listerConversations(ctx),
    collegueId ? lireConversation(ctx, collegueId) : Promise.resolve(null),
  ])
  if (collegueId && !ouverte) notFound()
  const maintenant = new Date()

  const conversations: ConversationVue[] = lignes.map((l) => ({
    collegue: l.collegue,
    dernier: l.dernier
      ? {
          texte: l.dernier.texte,
          quand: quandCourt(l.dernier.envoyeLe, maintenant),
          deMoi: l.dernier.deMoi,
        }
      : null,
    nonLus: l.nonLus,
  }))

  const jours: JourVue[] = []
  for (const m of ouverte?.messages ?? []) {
    const jour = jourLocal(m.envoyeLe)
    let groupe = jours.at(-1)
    if (groupe?.jour !== jour) {
      groupe = {
        jour,
        libelle: separateurJour(jour, maintenant),
        messages: [],
      }
      jours.push(groupe)
    }
    groupe.messages.push({
      id: m.id,
      texte: m.texte,
      heure: heureCabinet(m.envoyeLe),
      deMoi: m.deMoi,
      citation: m.citation,
    })
  }

  return (
    <Chat
      conversations={conversations}
      ouverte={
        ouverte
          ? {
              collegue: ouverte.collegue,
              jours,
              aujourdhui: jourLocal(maintenant),
            }
          : null
      }
    />
  )
}
