import { describe, expect, it } from 'vitest'

import { enregistrerJourSemaineTypeSchema } from '@/server/validation/presences'

// Forme de la pause du midi (18/10) : les deux bornes ou aucune, à l'intérieur
// de la journée. La base garde la même règle (`presence_hebdo_pause_coherente`).

const base = {
  praticienId: '00000000-0000-4000-8000-000000000001',
  jourSemaine: 1,
  actif: true,
  siteId: '00000000-0000-4000-8000-000000000002',
  fauteuilId: '00000000-0000-4000-8000-000000000003',
  heureDebut: '08:00',
  heureFin: '18:00',
}

describe('semaine type — pause', () => {
  it('sans pause : accepté', () => {
    expect(enregistrerJourSemaineTypeSchema.safeParse(base).success).toBe(true)
  })

  it('pause complète à l’intérieur de la journée : acceptée', () => {
    expect(enregistrerJourSemaineTypeSchema.safeParse({ ...base, pauseDebut: '12:00', pauseFin: '13:30' }).success).toBe(true)
  })

  it('une seule borne : refusé', () => {
    expect(enregistrerJourSemaineTypeSchema.safeParse({ ...base, pauseDebut: '12:00' }).success).toBe(false)
  })

  it('pause qui déborde de la journée ou à l’envers : refusée', () => {
    expect(enregistrerJourSemaineTypeSchema.safeParse({ ...base, pauseDebut: '07:00', pauseFin: '09:00' }).success).toBe(false)
    expect(enregistrerJourSemaineTypeSchema.safeParse({ ...base, pauseDebut: '13:30', pauseFin: '12:00' }).success).toBe(false)
  })
})
