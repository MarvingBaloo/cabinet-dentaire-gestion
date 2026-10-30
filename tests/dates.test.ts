import { describe, expect, it } from 'vitest'

import {
  bornesDuJour,
  decalerJour,
  formatHeureMinutes,
  formatHeureMinutesISO,
  heureCabinet,
  horairesOuvertureCabinet,
  instantCabinet,
  jourLocal,
  minutesDepuisMinuit,
  plageSemaineCourte,
  joursSemaineAffiches,
} from '@/lib/dates'

// Le décalage entre UTC et l'heure du cabinet est exactement ce qui fait
// apparaître des rendez-vous sur le mauvais jour. Ces tests posent les cas où
// les deux calendriers divergent — tard le soir, tôt le matin — parce que c'est
// là, et seulement là, que l'erreur se voit.

describe('jour civil au cabinet', () => {
  it('20h locale est encore le même jour, alors qu’il est minuit à Londres', () => {
    // 2027-04-05 20:00 en Guadeloupe = 2027-04-06 00:00 UTC.
    expect(jourLocal(new Date('2027-04-06T00:00:00Z'))).toBe('2027-04-05')
  })

  it('minuit locale ouvre bien le jour suivant', () => {
    expect(jourLocal(new Date('2027-04-06T04:00:00Z'))).toBe('2027-04-06')
  })

  it('une minute avant minuit locale reste la veille', () => {
    expect(jourLocal(new Date('2027-04-06T03:59:00Z'))).toBe('2027-04-05')
  })
})

describe('bornes d’une journée', () => {
  it('vont de minuit à minuit, heure du cabinet', () => {
    const { debut, fin } = bornesDuJour('2027-04-05')
    expect(debut.toISOString()).toBe('2027-04-05T04:00:00.000Z')
    expect(fin.toISOString()).toBe('2027-04-06T04:00:00.000Z')
  })

  it('couvrent exactement vingt-quatre heures', () => {
    const { debut, fin } = bornesDuJour('2027-04-05')
    expect(fin.getTime() - debut.getTime()).toBe(86_400_000)
  })
})

describe('navigation de jour en jour', () => {
  it('avance et recule', () => {
    expect(decalerJour('2027-04-05', 1)).toBe('2027-04-06')
    expect(decalerJour('2027-04-05', -1)).toBe('2027-04-04')
  })

  it('franchit les fins de mois et les années bissextiles', () => {
    expect(decalerJour('2027-04-30', 1)).toBe('2027-05-01')
    expect(decalerJour('2027-12-31', 1)).toBe('2028-01-01')
    expect(decalerJour('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('affichage', () => {
  it('rend l’heure du cabinet, pas celle du serveur', () => {
    // Un serveur en UTC afficherait 13:00 ; le cabinet voit 09:00.
    expect(heureCabinet(new Date('2027-04-05T13:00:00Z'))).toBe('09:00')
  })

  it('positionne un rendez-vous en minutes depuis minuit', () => {
    expect(minutesDepuisMinuit(new Date('2027-04-05T13:00:00Z'), '2027-04-05')).toBe(9 * 60)
    expect(minutesDepuisMinuit(new Date('2027-04-05T11:30:00Z'), '2027-04-05')).toBe(7 * 60 + 30)
  })
})

describe('heure saisie au cabinet', () => {
  it('rend l’instant UTC correspondant, et non l’heure telle quelle', () => {
    // La secrétaire tape 09:30 ; le rendez-vous est à 13h30 UTC. Sans cette
    // conversion il partirait à 9h30 UTC, soit 5h30 au cabinet.
    expect(instantCabinet('2027-04-05', '09:30')!.toISOString()).toBe('2027-04-05T13:30:00.000Z')
  })

  it('fait l’aller-retour avec l’affichage', () => {
    expect(heureCabinet(instantCabinet('2027-04-05', '07:45')!)).toBe('07:45')
    expect(heureCabinet(instantCabinet('2027-04-05', '17:00')!)).toBe('17:00')
  })

  it('bascule sur le jour UTC suivant en fin de journée', () => {
    // 21h au cabinet, c'est déjà le lendemain à Greenwich.
    expect(instantCabinet('2027-04-05', '21:00')!.toISOString()).toBe('2027-04-06T01:00:00.000Z')
  })

  it('place minuit exactement sur la borne du jour', () => {
    expect(instantCabinet('2027-04-05', '00:00')!.getTime()).toBe(bornesDuJour('2027-04-05').debut.getTime())
  })

  it('refuse une saisie malformée plutôt que de rendre une date invalide', () => {
    expect(instantCabinet('2027-04-05', '9:30')).toBeNull()
    expect(instantCabinet('2027-04-05', '25:00')).toBeNull()
    expect(instantCabinet('2027-04-05', '09:60')).toBeNull()
    expect(instantCabinet('05/04/2027', '09:30')).toBeNull()
    expect(instantCabinet('', '')).toBeNull()
  })
})

describe('affichage d’une heure locale', () => {
  it('omet les minutes rondes', () => {
    expect(formatHeureMinutes(7 * 60)).toBe('7h')
    expect(formatHeureMinutes(17 * 60)).toBe('17h')
  })

  it('garde les minutes non rondes, deux chiffres', () => {
    expect(formatHeureMinutes(7 * 60 + 30)).toBe('7h30')
    expect(formatHeureMinutes(9 * 60 + 5)).toBe('9h05')
  })

  it('rend un format ISO à deux chiffres partout, pour le JSON-LD', () => {
    expect(formatHeureMinutesISO(7 * 60 + 30)).toBe('07:30')
    expect(formatHeureMinutesISO(17 * 60)).toBe('17:00')
  })
})

describe('horaires d’ouverture dérivés des plages (lot E, D34)', () => {
  // 2027-04-05 est un lundi (comme les autres tests de ce fichier).
  const plage = (jour: string, debut: string, fin: string) => ({
    debut: instantCabinet(jour, debut) as Date,
    fin: instantCabinet(jour, fin) as Date,
  })

  it('ne rend aucun jour sans plage — jamais un jour écrit "fermé" en dur', () => {
    expect(horairesOuvertureCabinet([])).toEqual([])
  })

  it('rend un jour avec une seule plage', () => {
    const resultat = horairesOuvertureCabinet([plage('2027-04-05', '07:30', '17:00')])

    expect(resultat).toEqual([
      {
        jour: 'Lundi',
        jourSchemaOrg: 'Monday',
        intervalles: [{ debut: 7 * 60 + 30, fin: 17 * 60 }],
      },
    ])
  })

  it('fusionne deux plages qui se touchent exactement', () => {
    const resultat = horairesOuvertureCabinet([
      plage('2027-04-05', '07:30', '12:00'),
      plage('2027-04-05', '12:00', '17:00'),
    ])

    expect(resultat[0]?.intervalles).toEqual([{ debut: 7 * 60 + 30, fin: 17 * 60 }])
  })

  it('garde deux plages distinctes séparées par une pause', () => {
    const resultat = horairesOuvertureCabinet([
      plage('2027-04-05', '07:30', '12:00'),
      plage('2027-04-05', '14:00', '17:00'),
    ])

    expect(resultat[0]?.intervalles).toEqual([
      { debut: 7 * 60 + 30, fin: 12 * 60 },
      { debut: 14 * 60, fin: 17 * 60 },
    ])
  })

  it('trie les jours en commençant par lundi, pas par l’ordre JS (dimanche = 0)', () => {
    const resultat = horairesOuvertureCabinet([
      // 2027-04-11 est un dimanche.
      plage('2027-04-11', '09:00', '13:00'),
      plage('2027-04-05', '07:30', '17:00'),
    ])

    expect(resultat.map((h) => h.jour)).toEqual(['Lundi', 'Dimanche'])
  })
})

describe('plageSemaineCourte', () => {
  it('rend la plage d’une semaine dans le même mois', () => {
    expect(plageSemaineCourte(joursSemaineAffiches('2026-10-14'))).toBe('12 oct. → 17 oct. 2026')
  })

  it('gère le changement de mois', () => {
    expect(plageSemaineCourte(joursSemaineAffiches('2026-10-28'))).toBe('26 oct. → 31 oct. 2026')
    expect(plageSemaineCourte(joursSemaineAffiches('2026-11-02'))).toBe('2 nov. → 7 nov. 2026')
    expect(plageSemaineCourte(joursSemaineAffiches('2026-09-30'))).toBe('28 sept. → 3 oct. 2026')
  })

  it('donne les deux années quand la semaine enjambe le nouvel an', () => {
    expect(plageSemaineCourte(joursSemaineAffiches('2026-12-30'))).toBe('28 déc. 2026 → 2 janv. 2027')
  })
})
