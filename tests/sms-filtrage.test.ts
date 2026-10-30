import { afterEach, describe, expect, it, vi } from 'vitest'

import { filtrerHorsProduction, type Message, type Transporteur } from '@/server/sms/envoi'

// Ce que ces tests cherchent à prouver : hors production, un opérateur réel
// ne peut PLUS envoyer vers un numéro qu'on n'a pas explicitement autorisé.
//
// Le premier test rejoue l'incident du 2026-09-19 : Brevo configuré sur un poste
// de développement, un numéro inventé pour vérifier un écran, et un SMS réel
// parti vers lui. Si ce test casse, l'incident redevient possible.

function operateurEspion() {
  const envoyes: Message[] = []
  const operateur: Transporteur = {
    nom: 'brevo',
    async envoyer(m) {
      envoyes.push(m)
      return { ok: true, reference: 'reel' }
    },
  }
  return { operateur, envoyes }
}

const message = (destinataire: string): Message => ({ destinataire, texte: 'Code : 123456' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hors production', () => {
  it('n’envoie pas de vrai SMS vers un numéro de test inventé', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { operateur, envoyes } = operateurEspion()
    const filtre = filtrerHorsProduction(operateur, { production: false, autorises: [] })

    const r = await filtre.envoyer(message('+590690000042'))

    expect(envoyes).toHaveLength(0)
    // Le parcours continue comme avant Brevo : le code est lisible au terminal.
    expect(r).toEqual({ ok: true, reference: 'console' })
  })

  it('envoie réellement vers un numéro autorisé', async () => {
    const { operateur, envoyes } = operateurEspion()
    const filtre = filtrerHorsProduction(operateur, {
      production: false,
      autorises: ['+33612345678'],
    })

    await filtre.envoyer(message('+33612345678'))

    expect(envoyes).toHaveLength(1)
  })

  it('reconnaît le même numéro quelle que soit son écriture', async () => {
    const { operateur, envoyes } = operateurEspion()
    // Autorisé sous une forme, saisi sous une autre : c'est le même téléphone.
    const filtre = filtrerHorsProduction(operateur, {
      production: false,
      autorises: ['+590 690 12 34 56'],
    })

    await filtre.envoyer(message('0690123456'))
    await filtre.envoyer(message('06.90.12.34.56'))

    expect(envoyes).toHaveLength(2)
  })

  it('ne laisse passer que les numéros de la liste', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { operateur, envoyes } = operateurEspion()
    const filtre = filtrerHorsProduction(operateur, {
      production: false,
      autorises: ['+33612345678'],
    })

    await filtre.envoyer(message('+33612345678'))
    await filtre.envoyer(message('+33699999999'))

    expect(envoyes.map((m) => m.destinataire)).toEqual(['+33612345678'])
  })
})

describe('en production', () => {
  it('envoie à tout le monde, liste ou pas', async () => {
    const { operateur, envoyes } = operateurEspion()
    // En production, filtrer bloquerait les vrais patients : la liste est ignorée.
    const filtre = filtrerHorsProduction(operateur, { production: true, autorises: [] })

    await filtre.envoyer(message('+590690000042'))

    expect(envoyes).toHaveLength(1)
  })
})
