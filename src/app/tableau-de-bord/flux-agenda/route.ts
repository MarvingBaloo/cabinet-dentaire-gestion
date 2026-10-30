import { requirePermission } from '@/server/auth/permissions'
import { lireSession } from '@/server/auth/session-courante'
import { abonnerAgenda } from '@/server/temps-reel/agenda'

// Flux de l'agenda en direct (D61) : une connexion ouverte (Server-Sent Events)
// par écran du personnel. Seule route du tableau de bord qui ne soit pas une
// page ni une Server Action : un flux qui dure ne s'exprime pas autrement.
//
// La session est lue SANS être prolongée : le flux n'est pas un geste de la
// personne, et un poste abandonné doit rester verrouillable pour inactivité.
// La connexion est rendue au bout de quelques minutes ; le navigateur la rouvre
// seul, ce qui revérifie la session — un compte désactivé ou une session
// expirée cessent alors de recevoir quoi que ce soit.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DUREE_MS = 270_000
const VEILLE_MS = 25_000

export async function GET(requete: Request) {
  const session = await lireSession({ prolonger: false })
  if (session.etat !== 'valide') return new Response(null, { status: 401 })
  try {
    await requirePermission(session.ctx, 'agenda', 'read')
  } catch {
    return new Response(null, { status: 403 })
  }

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
      const desabonner = await abonnerAgenda(session.ctx, (e) => ecrire(`data: ${JSON.stringify(e)}\n\n`))
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
