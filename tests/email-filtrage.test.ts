import { afterEach, describe, expect, it, vi } from 'vitest'

import { filtrerEmailHorsProduction, type MessageEmail, type TransporteurEmail } from '@/server/email/envoi'

// Calqué sur tests/sms-filtrage.test.ts. Ce que ces tests cherchent à prouver :
// hors production, un opérateur e-mail réel ne peut PAS envoyer vers une
// adresse qu'on n'a pas explicitement autorisée — même garde-fou que le SMS
// (D18), pour la même raison : un opérateur configuré ne doit jamais pouvoir
// écrire à une adresse inventée pour un test.

function operateurEspion() {
  const envoyes: MessageEmail[] = []
  const operateur: TransporteurEmail = {
    nom: 'brevo',
    async envoyer(m) {
      envoyes.push(m)
      return { ok: true, reference: 'reel' }
    },
  }
  return { operateur, envoyes }
}

const message = (destinataire: string): MessageEmail => ({
  destinataire,
  sujet: 'Confirmation',
  texte: 'Votre rendez-vous est confirmé.',
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hors production', () => {
  it('n’envoie pas de vrai e-mail vers une adresse de test inventée', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { operateur, envoyes } = operateurEspion()
    const filtre = filtrerEmailHorsProduction(operateur, { production: false, autorises: [] })

    const r = await filtre.envoyer(message('inventee@example.invalid'))

    expect(envoyes).toHaveLength(0)
    // Le parcours continue comme avant Brevo : le message est lisible au terminal.
    expect(r).toEqual({ ok: true, reference: 'console' })
  })

  it('envoie réellement vers une adresse autorisée', async () => {
    const { operateur, envoyes } = operateurEspion()
    const filtre = filtrerEmailHorsProduction(operateur, {
      production: false,
      autorises: ['moi@example.invalid'],
    })

    await filtre.envoyer(message('moi@example.invalid'))

    expect(envoyes).toHaveLength(1)
  })

  it('ignore la casse et les espaces superflus', async () => {
    const { operateur, envoyes } = operateurEspion()
    const filtre = filtrerEmailHorsProduction(operateur, {
      production: false,
      autorises: [' Moi@Example.invalid '],
    })

    await filtre.envoyer(message('moi@example.invalid'))
    await filtre.envoyer(message('MOI@EXAMPLE.INVALID'))

    expect(envoyes).toHaveLength(2)
  })

  it('ne laisse passer que les adresses de la liste', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { operateur, envoyes } = operateurEspion()
    const filtre = filtrerEmailHorsProduction(operateur, {
      production: false,
      autorises: ['moi@example.invalid'],
    })

    await filtre.envoyer(message('moi@example.invalid'))
    await filtre.envoyer(message('quelquun-dautre@example.invalid'))

    expect(envoyes.map((m) => m.destinataire)).toEqual(['moi@example.invalid'])
  })

  it('liste vide = aucun envoi réel', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { operateur, envoyes } = operateurEspion()
    const filtre = filtrerEmailHorsProduction(operateur, { production: false, autorises: [] })

    await filtre.envoyer(message('moi@example.invalid'))

    expect(envoyes).toHaveLength(0)
  })
})

describe('en production', () => {
  it('envoie à tout le monde, liste ou pas', async () => {
    const { operateur, envoyes } = operateurEspion()
    // En production, filtrer bloquerait les vrais patients : la liste est ignorée.
    const filtre = filtrerEmailHorsProduction(operateur, { production: true, autorises: [] })

    await filtre.envoyer(message('patient@example.invalid'))

    expect(envoyes).toHaveLength(1)
  })
})
