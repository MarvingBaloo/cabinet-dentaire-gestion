import { describe, expect, it } from 'vitest'

import { instantCabinet } from '@/lib/dates'
import {
  type IndisponibiliteVoulue,
  type RendezVousActifPourIndisponibiliteConnu,
  rendezVousBloquesParIndisponibilite,
} from '@/server/domaine/indisponibilites'

// Tests du domaine : aucune base (D11, même principe que
// domaine-presences.test.ts). Garde anti-orphelin (Q5) des congés,
// fermetures et maintenances.

const JOUR = '2026-10-14' // un mercredi ordinaire, sans rapport avec un férié

const rdv = (over: Partial<RendezVousActifPourIndisponibiliteConnu> = {}): RendezVousActifPourIndisponibiliteConnu => ({
  id: 'rdv-1',
  praticienId: 'praticien-1',
  siteId: 'site-mg',
  debut: instantCabinet(JOUR, '09:00')!,
  fin: instantCabinet(JOUR, '09:30')!,
  ...over,
})

const indispo = (over: Partial<IndisponibiliteVoulue> = {}): IndisponibiliteVoulue => ({
  type: 'CONGE',
  praticienId: null,
  siteId: null,
  debut: instantCabinet(JOUR, '08:00')!,
  fin: instantCabinet(JOUR, '18:00')!,
  ...over,
})

describe('rendezVousBloquesParIndisponibilite', () => {
  it('un congé praticien bloque le rendez-vous de CE praticien, chevauchant la période', () => {
    const bloques = rendezVousBloquesParIndisponibilite([rdv()], indispo({ praticienId: 'praticien-1' }))
    expect(bloques.map((r) => r.id)).toEqual(['rdv-1'])
  })

  it('ne bloque pas le rendez-vous d’un AUTRE praticien', () => {
    const bloques = rendezVousBloquesParIndisponibilite(
      [rdv({ praticienId: 'praticien-2' })],
      indispo({ praticienId: 'praticien-1' }),
    )
    expect(bloques).toHaveLength(0)
  })

  it('une fermeture de site bloque tout rendez-vous de CE site, quel que soit le praticien', () => {
    const bloques = rendezVousBloquesParIndisponibilite(
      [rdv({ praticienId: 'peu-importe', siteId: 'site-mg' })],
      indispo({ siteId: 'site-mg' }),
    )
    expect(bloques).toHaveLength(1)
  })

  it('ne bloque pas le rendez-vous d’un AUTRE site', () => {
    const bloques = rendezVousBloquesParIndisponibilite(
      [rdv({ siteId: 'site-gp' })],
      indispo({ siteId: 'site-mg' }),
    )
    expect(bloques).toHaveLength(0)
  })

  it('une indisponibilité qui vise praticien ET site exige les deux critères', () => {
    const cible = indispo({ praticienId: 'praticien-1', siteId: 'site-mg' })
    expect(
      rendezVousBloquesParIndisponibilite([rdv({ praticienId: 'praticien-1', siteId: 'site-mg' })], cible),
    ).toHaveLength(1)
    expect(
      rendezVousBloquesParIndisponibilite([rdv({ praticienId: 'praticien-1', siteId: 'site-gp' })], cible),
    ).toHaveLength(0)
    expect(
      rendezVousBloquesParIndisponibilite([rdv({ praticienId: 'praticien-2', siteId: 'site-mg' })], cible),
    ).toHaveLength(0)
  })

  it('ne bloque rien hors chevauchement', () => {
    const avant = rdv({ debut: instantCabinet(JOUR, '06:00')!, fin: instantCabinet(JOUR, '07:00')! })
    expect(rendezVousBloquesParIndisponibilite([avant], indispo({ praticienId: 'praticien-1' }))).toHaveLength(0)
  })

  it('bornes [) : un rendez-vous qui commence exactement à la fin de l’indisponibilité n’est pas bloqué', () => {
    const juste = rdv({ debut: instantCabinet(JOUR, '18:00')!, fin: instantCabinet(JOUR, '18:30')! })
    expect(rendezVousBloquesParIndisponibilite([juste], indispo({ praticienId: 'praticien-1' }))).toHaveLength(0)
  })
})
