import { CanalNotification, TypeNotification } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  VALEURS_EXEMPLE,
  compterSegmentsSms,
  modeleParDefaut,
  rendreModele,
  validerModele,
} from '@/lib/modeles-messages'

// Ce que ces tests cherchent à prouver (lot 5a), purs — aucun accès base :
//   - {motif} et tout champ hors de la liste fermée sont refusés
//   - une accolade non fermée est refusée
//   - {adresse} se rend vide (jamais « null ») quand la valeur est absente
//   - segments GSM-7 vs UCS-2, avertissement à deux segments, refus à trois
//   - Q5 : le défaut d'ANNULATION_CABINET dit que le patient sera recontacté,
//     celui d'ANNULATION_PATIENT ne le dit pas

describe('rendreModele', () => {
  it('remplace un champ connu par sa valeur', () => {
    expect(rendreModele('Bonjour {prenom}, RDV le {date}.', { prenom: 'Marie', date: 'lundi' })).toBe(
      'Bonjour Marie, RDV le lundi.',
    )
  })

  it('rend une chaîne vide pour un champ absent des valeurs — jamais "null" (D24)', () => {
    const rendu = rendreModele('Adresse : {adresse}.', {})
    expect(rendu).toBe('Adresse : .')
    expect(rendu).not.toContain('null')
    expect(rendu).not.toContain('undefined')
  })

  it('rend explicitement une adresse null convertie en chaîne vide par l’appelant', () => {
    // C'est ainsi que `messages.ts` convertit `Site.adresse` (nullable, D24) :
    // `adresse: d.adresse ?? ''` avant d'appeler `rendreModele`.
    const adresseEnBase: string | null = null
    const valeurs = { adresse: adresseEnBase ?? '' }
    expect(rendreModele('{adresse}', valeurs)).toBe('')
  })
})

describe('validerModele — champs de fusion', () => {
  it('refuse {motif} : minimisation, jamais dans la liste fermée', () => {
    const verdict = validerModele(
      TypeNotification.CONFIRMATION_RESERVATION,
      CanalNotification.SMS,
      'Votre rendez-vous pour {motif} est confirmé.',
      null,
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.erreur).toContain('{motif}')
  })

  it('refuse un champ connu mais indisponible pour ce type ({lien} hors CRENEAU_LIBERE)', () => {
    const verdict = validerModele(
      TypeNotification.CONFIRMATION_RESERVATION,
      CanalNotification.SMS,
      'Cliquez : {lien}',
      null,
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.erreur).toContain('{lien}')
  })

  it('accepte {lien} pour CRENEAU_LIBERE', () => {
    const verdict = validerModele(TypeNotification.CRENEAU_LIBERE, CanalNotification.SMS, 'Réservez : {lien}', null)
    expect(verdict.ok).toBe(true)
  })

  it('refuse une accolade jamais refermée', () => {
    const verdict = validerModele(
      TypeNotification.CONFIRMATION_RESERVATION,
      CanalNotification.SMS,
      'Bonjour {prenom, votre rendez-vous est confirmé.',
      null,
    )
    expect(verdict.ok).toBe(false)
  })

  it('refuse une accolade fermante sans ouverture', () => {
    const verdict = validerModele(TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS, 'Bonjour }', null)
    expect(verdict.ok).toBe(false)
  })

  it('refuse un corps vide', () => {
    const verdict = validerModele(TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS, '   ', null)
    expect(verdict.ok).toBe(false)
  })

  it('exige un sujet pour un e-mail', () => {
    const verdict = validerModele(TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.EMAIL, 'Corps.', null)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.erreur.toLowerCase()).toContain('sujet')
  })

  it('n’exige aucun sujet pour un SMS', () => {
    const verdict = validerModele(TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS, 'Corps.', null)
    expect(verdict.ok).toBe(true)
  })
})

describe('validerModele — segments SMS (D-lot5-segments)', () => {
  it('un segment : ni avertissement ni refus', () => {
    const verdict = validerModele(TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS, 'A'.repeat(160), null)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.avertissement).toBeUndefined()
  })

  it('deux segments : avertissement, mais enregistrable', () => {
    const verdict = validerModele(TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS, 'A'.repeat(161), null)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.avertissement).toBeDefined()
  })

  it('trois segments : refusé', () => {
    const verdict = validerModele(TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS, 'A'.repeat(307), null)
    expect(verdict.ok).toBe(false)
  })
})

describe('compterSegmentsSms', () => {
  it('un texte purement GSM-7 de 160 caractères tient en un segment', () => {
    expect(compterSegmentsSms('A'.repeat(160))).toEqual({ segments: 1, encodage: 'GSM-7', longueur: 160 })
  })

  it('161 caractères GSM-7 basculent à deux segments', () => {
    const r = compterSegmentsSms('A'.repeat(161))
    expect(r.segments).toBe(2)
    expect(r.encodage).toBe('GSM-7')
  })

  it('un seul caractère hors GSM-7 fait basculer tout le message en UCS-2', () => {
    // 'ê' (circonflexe) n'est pas dans l'alphabet GSM 03.38 par défaut.
    const r = compterSegmentsSms('Rendez-vous confirmé, à bientôt ê')
    expect(r.encodage).toBe('UCS-2')
  })

  it('70 caractères UCS-2 tiennent en un segment, 71 basculent à deux', () => {
    expect(compterSegmentsSms('ê'.repeat(70)).segments).toBe(1)
    expect(compterSegmentsSms('ê'.repeat(71)).segments).toBe(2)
  })
})

describe('Q5 — ANNULATION_CABINET prévient d’un recontact, ANNULATION_PATIENT non', () => {
  it('le défaut SMS d’ANNULATION_CABINET annonce que le cabinet recontactera', () => {
    const defaut = modeleParDefaut(TypeNotification.ANNULATION_CABINET, CanalNotification.SMS)
    expect(defaut.corps).toContain('recontactera')
  })

  it('le défaut SMS d’ANNULATION_PATIENT ne le dit pas', () => {
    const defaut = modeleParDefaut(TypeNotification.ANNULATION_PATIENT, CanalNotification.SMS)
    expect(defaut.corps).not.toContain('recontactera')
  })

  it('les deux défauts se rendent sans erreur avec des valeurs d’exemple', () => {
    for (const type of [TypeNotification.ANNULATION_CABINET, TypeNotification.ANNULATION_PATIENT] as const) {
      const defaut = modeleParDefaut(type, CanalNotification.SMS)
      const verdict = validerModele(type, CanalNotification.SMS, defaut.corps, defaut.sujet)
      expect(verdict.ok).toBe(true)
    }
  })
})

describe('défauts — cohérence de la liste fermée', () => {
  it('chaque défaut SMS et EMAIL des types modélisables passe sa propre validation', () => {
    for (const type of [
      TypeNotification.CONFIRMATION_RESERVATION,
      TypeNotification.MODIFICATION_RENDEZ_VOUS,
      TypeNotification.ANNULATION_PATIENT,
      TypeNotification.ANNULATION_CABINET,
      TypeNotification.RAPPEL_J2,
      TypeNotification.RAPPEL_H3,
      TypeNotification.CRENEAU_LIBERE,
    ] as const) {
      for (const canal of [CanalNotification.SMS, CanalNotification.EMAIL] as const) {
        const defaut = modeleParDefaut(type, canal)
        const verdict = validerModele(type, canal, defaut.corps, defaut.sujet)
        expect(verdict.ok, `${type}:${canal} — ${!verdict.ok ? verdict.erreur : ''}`).toBe(true)
      }
    }
  })

  it('un aperçu rendu avec les valeurs d’exemple ne contient plus aucune accolade', () => {
    const defaut = modeleParDefaut(TypeNotification.CONFIRMATION_RESERVATION, CanalNotification.SMS)
    const rendu = rendreModele(defaut.corps, VALEURS_EXEMPLE)
    expect(rendu).not.toMatch(/[{}]/)
  })
})
