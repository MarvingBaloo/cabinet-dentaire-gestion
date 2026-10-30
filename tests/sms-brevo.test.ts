import { afterEach, describe, expect, it, vi } from 'vitest'

import { creerTransporteurBrevo } from '@/server/sms/brevo'

// Ce que ces tests cherchent à prouver :
//   - le numéro part tel qu'il est enregistré, sans hypothèse de pays
//   - un échec, quelle qu'en soit la forme, ne fait jamais fuir le code ni la clé
//   - un corps de réponse illisible ne transforme pas un envoi réussi en échec
//
// Aucun appel réseau : `fetch` est remplacé. Ce n'est pas la base qu'on simule
// ici (ce qui est proscrit) mais un service tiers payant, qu'on ne peut ni
// rejouer ni contrôler depuis un test.

const CLE = 'cle-api-secrete-a-ne-jamais-divulguer'

function transporteur() {
  return creerTransporteurBrevo(CLE, 'CabinetTest')
}

function reponse(statut: number, corps: unknown): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  })
}

function derniereRequete() {
  const appel = vi.mocked(globalThis.fetch).mock.calls[0]
  if (!appel) throw new Error('fetch n’a pas été appelé')
  const [url, init] = appel
  return { url: String(url), corps: JSON.parse(String(init?.body)), entetes: init?.headers }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('envoi par Brevo', () => {
  it('poste sur l’endpoint courant, pas sur celui qui est déprécié', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse(201, { messageId: 42 }))

    await transporteur().envoyer({ destinataire: '+33612345678', texte: 'Code : 123456' })

    expect(derniereRequete().url).toBe('https://api.brevo.com/v3/transactionalSMS/send')
  })

  // Le cabinet est en Guadeloupe, un praticien peut être en métropole et un
  // remplaçant ailleurs : le pays ne se devine pas, il est déjà dans le numéro.
  it('envoie le numéro tel quel, sans le « + » et sans hypothèse de pays', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse(201, { messageId: 'abc' }))
    const t = transporteur()

    await t.envoyer({ destinataire: '+590690112233', texte: 'x' })
    expect(derniereRequete().corps.recipient).toBe('590690112233')

    vi.mocked(globalThis.fetch).mockClear()
    await t.envoyer({ destinataire: '+32470123456', texte: 'x' })
    expect(derniereRequete().corps.recipient).toBe('32470123456')
  })

  it('rend la référence du message quand Brevo la donne', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse(201, { messageId: 987 }))

    const r = await transporteur().envoyer({ destinataire: '+33612345678', texte: 'x' })
    expect(r).toEqual({ ok: true, reference: '987' })
  })

  // Un envoi accepté reste un envoi accepté : la référence sert au suivi, pas à
  // la connexion. La perdre ne doit pas bloquer quelqu'un devant son écran.
  it('reste un succès si le corps de réponse est illisible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('pas du json', { status: 201 }),
    )

    expect(await transporteur().envoyer({ destinataire: '+33612345678', texte: 'x' })).toEqual({
      ok: true,
    })
  })

  it('rend un échec lisible quand Brevo refuse', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reponse(400, { code: 'invalid_parameter', message: 'recipient is invalid' }),
    )

    const r = await transporteur().envoyer({ destinataire: '+33600000000', texte: 'x' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.raison).toContain('400')
    expect(r.raison).toContain('invalid_parameter')
  })

  it('rend un échec quand le réseau tombe, sans lever', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'))

    const r = await transporteur().envoyer({ destinataire: '+33612345678', texte: 'x' })
    expect(r.ok).toBe(false)
  })

  // Le motif d'échec remonte jusqu'à l'écran de connexion et jusqu'au journal.
  // Il ne doit porter ni le code à usage unique, ni la clé d'API.
  it('ne laisse fuir ni le code envoyé ni la clé d’API', async () => {
    const cas: Response[] = [
      reponse(401, { code: 'unauthorized', message: `cle ${CLE} invalide` }),
      reponse(400, { code: 'invalid_parameter', message: 'Code : 654321' }),
    ]

    for (const r of cas) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(r)
      const resultat = await transporteur().envoyer({
        destinataire: '+33612345678',
        texte: 'Votre code : 654321',
      })
      expect(resultat.ok).toBe(false)
      if (resultat.ok) return
      expect(resultat.raison).not.toContain(CLE)
      expect(resultat.raison).not.toContain('654321')
      vi.restoreAllMocks()
    }
  })

  it('n’attend pas indéfiniment : la requête porte un signal d’abandon', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse(201, {}))

    await transporteur().envoyer({ destinataire: '+33612345678', texte: 'x' })

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
