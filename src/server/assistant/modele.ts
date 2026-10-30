import 'server-only'

// Le modèle de langue derrière l'assistant (D77) : un seul, pour tous ses usages — les urgences aujourd'hui, côté
// patient ; l'analyse (RAG) demain, côté praticien. Derrière une interface, comme les paiements ou les SMS : les
// tests et les démos lui substituent un modèle scripté, sans appel payant.
//
// L'API de Claude, avec une clé de la console Anthropic (`ANTHROPIC_API_KEY`). Un abonnement claude.ai ne peut pas
// servir ici : ses jetons sont réservés à Claude Code et à claude.ai (règles d'Anthropic, février 2026).
//
// Le modèle travaille avec des outils (D79) : il les appelle, lit leur résultat, en appelle d'autres, puis conclut.
// C'est ainsi qu'il consulte l'agenda quand il en a besoin, au lieu de recevoir d'avance une fenêtre fixée.

export type AppelOutil = { id: string; outil: string; entree: Record<string, unknown> }

export type MessageModele =
  | { role: 'user' | 'assistant'; texte: string }
  /** Ce que le modèle a demandé : un ou plusieurs appels d'outil. */
  | { role: 'assistant'; appels: AppelOutil[] }
  /** Ce que les outils ont rendu, dans l'ordre des appels. */
  | { role: 'user'; resultats: { id: string; contenu: string }[] }

export type OutilModele = {
  nom: string
  description: string
  /** Schéma JSON des paramètres. */
  parametres: Record<string, unknown>
}

/** Ce que le modèle a décidé : des appels d'outil, et éventuellement du texte. */
export type ReponseModele = { appels: AppelOutil[]; texte: string }

export interface Modele {
  repondre(demande: {
    systeme: string
    messages: MessageModele[]
    outils: OutilModele[]
    /** Vrai : le modèle doit appeler un outil, jamais répondre en texte libre. */
    outilObligatoire: boolean
  }): Promise<ReponseModele>
}

export class ModeleIndisponibleError extends Error {
  constructor(cause?: unknown) {
    super('Le modèle de langue ne répond pas.', { cause })
  }
}

const MODELE_PAR_DEFAUT = 'claude-sonnet-5-5'

function versClaude(m: MessageModele) {
  if ('texte' in m) return { role: m.role, content: m.texte }
  if ('appels' in m) {
    return { role: 'assistant', content: m.appels.map((a) => ({ type: 'tool_use', id: a.id, name: a.outil, input: a.entree })) }
  }
  return { role: 'user', content: m.resultats.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.contenu })) }
}

export function modeleClaude(cle: string, nom = process.env.ASSISTANT_MODELE || MODELE_PAR_DEFAUT): Modele {
  return {
    async repondre({ systeme, messages, outils, outilObligatoire }) {
      let reponse: Response
      try {
        reponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': cle, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: nom,
            max_tokens: 2048,
            system: systeme,
            messages: messages.map(versClaude),
            tools: outils.map((o) => ({ name: o.nom, description: o.description, input_schema: o.parametres })),
            ...(outilObligatoire ? { tool_choice: { type: 'any' } } : {}),
          }),
          signal: AbortSignal.timeout(60_000),
        })
      } catch (e) {
        throw new ModeleIndisponibleError(e)
      }
      if (!reponse.ok) throw new ModeleIndisponibleError(`${reponse.status} ${await reponse.text().catch(() => '')}`)
      const corps = (await reponse.json()) as {
        content: (
          | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
          | { type: 'text'; text: string }
        )[]
      }
      return {
        appels: corps.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, outil: b.name, entree: b.input }] : [])),
        texte: corps.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim(),
      }
    },
  }
}

/** L'assistant est-il allumé ? Sans clé ni mode scripté, le site ne montre pas la bulle. */
export function assistantAllume(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || process.env.ASSISTANT_SCRIPTE === '1'
}

let substitut: Modele | null = null

/** Pour les tests : le modèle scripté qui remplace Claude. `null` rend la main au réglage normal. */
export function remplacerModele(m: Modele | null) {
  substitut = m
}

/**
 * Le modèle à utiliser, ou `null` si l'assistant est éteint (aucune clé) : le site n'affiche alors pas la bulle.
 * `ASSISTANT_SCRIPTE=1`, sans clé : le modèle scripté — serveur des parcours, et démos du NAS et de Vercel tant que
 * Marving ne veut rien débiter (25/10) : la bulle s'affiche, rien n'est connecté derrière.
 */
export async function modeleDisponible(): Promise<Modele | null> {
  if (substitut) return substitut
  const cle = process.env.ANTHROPIC_API_KEY
  if (cle) return modeleClaude(cle)
  if (process.env.ASSISTANT_SCRIPTE === '1') return (await import('./modele-scripte')).modeleScripte
  return null
}
