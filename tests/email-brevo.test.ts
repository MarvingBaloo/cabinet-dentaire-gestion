import { afterEach, describe, expect, it, vi } from 'vitest'

import { creerTransporteurEmailBrevo } from '@/server/email/brevo'

// Calqué sur tests/sms-brevo.test.ts. Ce que ces tests cherchent à prouver :
//   - le corps de requête est celui attendu par /v3/smtp/email (texte brut)
//   - un échec, quelle qu'en soit la forme, ne fait jamais fuir l'adresse, le
//     sujet, le texte ou la clé
//   - un corps de réponse illisible ne transforme pas un envoi réussi en échec
//
// Aucun appel réseau : `fetch` est remplacé.

const CLE = 'cle-api-secrete-a-ne-jamais-divulguer'

function transporteur() {
  return creerTransporteurEmailBrevo(CLE, 'cabinet@example.invalid')
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

describe('envoi par Brevo (e-mail)', () => {
  it('poste sur l’endpoint transactionnel e-mail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse(201, { messageId: '<abc@smtp-relay.mailin.fr>' }))

    await transporteur().envoyer({
      destinataire: 'patient@example.invalid',
      sujet: 'Confirmation',
      texte: 'Votre rendez-vous est confirmé.',
    })

    expect(derniereRequete().url).toBe('https://api.brevo.com/v3/smtp/email')
  })

  it('envoie un corps conforme : expéditeur, destinataire, sujet, texte brut seulement', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse(201, { messageId: 'abc' }))

    await transporteur().envoyer({
      destinataire: 'patient@example.invalid',
      sujet: 'Confirmation de rendez-vous',
      texte: 'Votre rendez-vous est confirmé.',
    })

    const { corps } = derniereRequete()
    expect(corps.sender).toEqual({ email: 'cabinet@example.invalid', name: expect.any(String) })
    expect(corps.to).toEqual([{ email: 'patient@example.invalid' }])
    expect(corps.subject).toBe('Confirmation de rendez-vous')
    expect(corps.textContent).toBe('Votre rendez-vous est confirmé.')
    expect(corps.htmlContent).toBeUndefined()
  })

  it('pose les en-têtes attendus, dont la clé d’API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse(201, {}))

    await transporteur().envoyer({ destinataire: 'x@example.invalid', sujet: 'x', texte: 'x' })

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!
    const entetes = init?.headers as Record<string, string>
    expect(entetes['api-key']).toBe(CLE)
    expect(entetes['content-type']).toBe('application/json')
    expect(entetes['accept']).toBe('application/json')
  })

  it('rend la référence du message quand Brevo la donne', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse(201, { messageId: '<xyz@relay>' }))

    const r = await transporteur().envoyer({ destinataire: 'x@example.invalid', sujet: 'x', texte: 'x' })
    expect(r).toEqual({ ok: true, reference: '<xyz@relay>' })
  })

  // Un envoi accepté reste un envoi accepté : la référence sert au suivi, pas à
  // la notification elle-même.
  it('reste un succès si le corps de réponse est illisible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('pas du json', { status: 201 }))

    expect(await transporteur().envoyer({ destinataire: 'x@example.invalid', sujet: 'x', texte: 'x' })).toEqual({
      ok: true,
    })
  })

  it('rend un échec lisible quand Brevo refuse', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reponse(400, { code: 'invalid_parameter', message: 'email is invalid' }),
    )

    const r = await transporteur().envoyer({ destinataire: 'invalide', sujet: 'x', texte: 'x' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.raison).toContain('400')
    expect(r.raison).toContain('invalid_parameter')
  })

  it('rend un échec quand le réseau tombe, sans lever', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'))

    const r = await transporteur().envoyer({ destinataire: 'x@example.invalid', sujet: 'x', texte: 'x' })
    expect(r.ok).toBe(false)
  })

  // Le motif d'échec remonte jusqu'au journal. Il ne doit porter ni l'adresse,
  // ni le sujet, ni le texte du message, ni la clé d'API.
  it('ne laisse fuir ni l’adresse, ni le contenu, ni la clé d’API', async () => {
    const adresse = 'patient-tres-specifique@example.invalid'
    const texte = 'Contenu confidentiel du rendez-vous'
    const cas: Response[] = [
      reponse(401, { code: 'unauthorized', message: `cle ${CLE} invalide` }),
      reponse(400, { code: 'invalid_parameter', message: `destinataire ${adresse} rejeté : ${texte}` }),
    ]

    for (const r of cas) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(r)
      const resultat = await transporteur().envoyer({ destinataire: adresse, sujet: 'Confirmation', texte })
      expect(resultat.ok).toBe(false)
      if (resultat.ok) return
      expect(resultat.raison).not.toContain(CLE)
      expect(resultat.raison).not.toContain(adresse)
      expect(resultat.raison).not.toContain(texte)
      vi.restoreAllMocks()
    }
  })

  it('n’attend pas indéfiniment : la requête porte un signal d’abandon', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse(201, {}))

    await transporteur().envoyer({ destinataire: 'x@example.invalid', sujet: 'x', texte: 'x' })

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
