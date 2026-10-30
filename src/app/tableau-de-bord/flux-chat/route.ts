import { lireSession } from '@/server/auth/session-courante'
import { abonnerChat } from '@/server/temps-reel/chat'

// Flux du chat en direct (D82) : même forme que celui de l'agenda (flux-agenda/route.ts, D61), session lue sans être
// prolongée, connexion rendue au bout de quelques minutes. Tout membre du personnel a un chat : pas d'autre garde
// que la session.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DUREE_MS = 270_000
const VEILLE_MS = 25_000

export async function GET(requete: Request) {
  const session = await lireSession({ prolonger: false })
  if (session.etat !== 'valide') return new Response(null, { status: 401 })

  const encodeur = new TextEncoder()
  let fermer = () => {}

  const flux = new ReadableStream<Uint8Array>({
    async start(controleur) {
      const ecrire = (texte: string) => {
        try {
          controleur.enqueue(encodeur.encode(texte))
        } catch {
          fermer()
        }
      }
      const desabonner = await abonnerChat(session.ctx, (e) => ecrire(`data: ${JSON.stringify(e)}\n\n`))
      // Une ligne de commentaire de temps en temps : sans elle, un proxy ferme
      // une connexion qu'il croit morte.
      const veille = setInterval(() => ecrire(': veille\n\n'), VEILLE_MS)
      const fin = setTimeout(() => fermer(), DUREE_MS)
      fermer = () => {
        clearInterval(veille)
        clearTimeout(fin)
        desabonner()
        try {
          controleur.close()
        } catch {
          // déjà fermé
        }
      }
      requete.signal.addEventListener('abort', () => fermer())
      ecrire('retry: 3000\n\n')
    },
    cancel() {
      fermer()
    },
  })

  return new Response(flux, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
