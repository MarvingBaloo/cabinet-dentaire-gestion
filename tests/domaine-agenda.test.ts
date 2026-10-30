import { StatutRendezVous, TypeIndisponibilite } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  type IndisponibiliteConnue,
  type PresenceConnue,
  type RendezVousConnu,
  SEUIL_MANQUEMENTS,
  calculerFin,
  compteUnManquement,
  couvre,
  creneauxLibres,
  reservationFermee,
  seChevauchent,
  verifierCreneau,
} from '@/server/domaine/agenda'

// Tests du domaine : aucune base, aucun contexte, aucune permission. C'est tout
// l'intérêt de D11 — les règles d'agenda s'éprouvent en millisecondes, et les
// cas tordus (bornes jointives, plage trop courte, créneau d'urgence) se posent
// ici plutôt qu'en montant un jeu de données complet.

const PRATICIEN = 'prat-1'
const AUTRE_PRATICIEN = 'prat-2'
const SITE = 'site-mg'
const AUTRE_SITE = 'site-gp'
const FAUTEUIL = 'fauteuil-1'

const h = (heure: string) => new Date(`2027-03-01T${heure}:00Z`)

const presence = (over: Partial<PresenceConnue> = {}): PresenceConnue => ({
  praticienId: PRATICIEN,
  siteId: SITE,
  fauteuilId: FAUTEUIL,
  debut: h('11:30'),
  fin: h('21:00'),
  ...over,
})

const rdv = (over: Partial<RendezVousConnu> = {}): RendezVousConnu => ({
  id: 'rdv-existant',
  praticienId: PRATICIEN,
  fauteuilId: FAUTEUIL,
  debut: h('13:00'),
  fin: h('13:30'),
  compteDansLOccupation: true,
  ...over,
})

const demande = (debut: string, fin: string, over = {}) => ({
  praticienId: PRATICIEN,
  siteId: SITE,
  debut: h(debut),
  fin: h(fin),
  motifEstUrgence: false,
  surbooking: false,
  ...over,
})

const RIEN = { presences: [], indisponibilites: [], rendezVous: [] }

describe('bornes des intervalles', () => {
  it('deux créneaux jointifs ne se chevauchent pas', () => {
    // Sans ce choix, aucune journée ne pourrait s'enchaîner.
    expect(
      seChevauchent({ debut: h('09:00'), fin: h('09:30') }, { debut: h('09:30'), fin: h('10:00') }),
    ).toBe(false)
  })

  it('un créneau à cheval est détecté', () => {
    expect(
      seChevauchent({ debut: h('09:00'), fin: h('09:30') }, { debut: h('09:15'), fin: h('09:45') }),
    ).toBe(true)
  })

  it('couvre exige un englobement complet, pas un simple contact', () => {
    const plage = { debut: h('09:00'), fin: h('12:00') }
    expect(couvre(plage, { debut: h('09:00'), fin: h('12:00') })).toBe(true)
    expect(couvre(plage, { debut: h('11:30'), fin: h('12:30') })).toBe(false)
  })

  it('calculerFin ajoute des minutes', () => {
    expect(calculerFin(h('09:00'), 45)).toEqual(h('09:45'))
  })
})

describe('présence du praticien', () => {
  it('refuse quand le praticien n’est pas sur ce site', () => {
    const v = verifierCreneau(demande('13:00', '13:30'), {
      ...RIEN,
      presences: [presence({ siteId: AUTRE_SITE })],
    })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.violations).toContainEqual({ code: 'PRATICIEN_ABSENT', siteId: SITE })
  })

  it('distingue « absent » de « présent mais pas assez longtemps »', () => {
    // Les deux n'appellent pas la même correction à l'accueil : dans un cas on
    // change de jour, dans l'autre on avance le rendez-vous d'une demi-heure.
    const v = verifierCreneau(demande('20:30', '21:30'), {
      ...RIEN,
      presences: [presence()],
    })
    expect(v.ok === false && v.violations).toContainEqual({ code: 'DEBORDE_PRESENCE' })
  })

  it('déduit le fauteuil de la présence', () => {
    // Le fauteuil n'est jamais choisi : on prend rendez-vous avec un praticien.
    const v = verifierCreneau(demande('13:00', '13:30'), { ...RIEN, presences: [presence()] })
    expect(v).toEqual({ ok: true, fauteuilId: FAUTEUIL })
  })
})

describe('fauteuil explicitement visé (lot 6, glisser-déposer)', () => {
  const AUTRE_FAUTEUIL = 'fauteuil-2'

  it('sans préférence : inchangé, le fauteuil reste déduit de la présence', () => {
    const v = verifierCreneau(demande('13:00', '13:30'), { ...RIEN, presences: [presence()] })
    expect(v).toEqual({ ok: true, fauteuilId: FAUTEUIL })
  })

  it('la colonne visée correspond à la présence : acceptée', () => {
    const v = verifierCreneau(demande('13:00', '13:30', { fauteuilSouhaite: FAUTEUIL }), {
      ...RIEN,
      presences: [presence()],
    })
    expect(v).toEqual({ ok: true, fauteuilId: FAUTEUIL })
  })

  it('la colonne visée ne correspond PAS à la présence : refusée plutôt que réassignée', () => {
    // Le praticien EST présent sur ce créneau (sur `FAUTEUIL`) : sans la
    // préférence, la demande serait acceptée. Avec elle, un dépôt dans une
    // autre colonne ne doit jamais s'écrire silencieusement ailleurs.
    const v = verifierCreneau(demande('13:00', '13:30', { fauteuilSouhaite: AUTRE_FAUTEUIL }), {
      ...RIEN,
      presences: [presence()],
    })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.violations).toContainEqual({ code: 'FAUTEUIL_INDISPONIBLE' })
  })

  it('praticien absent : le refus reste PRATICIEN_ABSENT, pas FAUTEUIL_INDISPONIBLE', () => {
    // Sans plage porteuse, il n'y a rien à comparer à la préférence — le
    // refus doit rester celui, déjà existant, de l'absence.
    const v = verifierCreneau(demande('13:00', '13:30', { fauteuilSouhaite: AUTRE_FAUTEUIL }), {
      ...RIEN,
      presences: [presence({ siteId: AUTRE_SITE })],
    })
    expect(v.ok === false && v.violations).toEqual([{ code: 'PRATICIEN_ABSENT', siteId: SITE }])
  })
})

describe('chevauchements', () => {
  it('refuse deux rendez-vous sur le même fauteuil', () => {
    const v = verifierCreneau(demande('13:15', '13:45'), {
      ...RIEN,
      presences: [presence()],
      rendezVous: [rdv()],
    })
    expect(v.ok === false && v.violations).toContainEqual({
      code: 'CHEVAUCHEMENT_FAUTEUIL',
      rendezVousId: 'rdv-existant',
    })
  })

  it('accepte un rendez-vous jointif', () => {
    const v = verifierCreneau(demande('13:30', '14:00'), {
      ...RIEN,
      presences: [presence()],
      rendezVous: [rdv()],
    })
    expect(v.ok).toBe(true)
  })

  it('ignore un rendez-vous annulé — son créneau est libre', () => {
    const v = verifierCreneau(demande('13:00', '13:30'), {
      ...RIEN,
      presences: [presence()],
      rendezVous: [rdv({ compteDansLOccupation: false })],
    })
    expect(v.ok).toBe(true)
  })

  it('un rendez-vous déplacé ne se chevauche pas lui-même', () => {
    // Sans cette exclusion, avancer un rendez-vous de cinq minutes serait refusé
    // au motif qu'il occupe déjà la place.
    const v = verifierCreneau(demande('13:05', '13:35', { rendezVousId: 'rdv-existant' }), {
      ...RIEN,
      presences: [presence()],
      rendezVous: [rdv()],
    })
    expect(v.ok).toBe(true)
  })

  it('le surbooking passe outre — c’est l’urgence du praticien', () => {
    const v = verifierCreneau(demande('13:15', '13:45', { surbooking: true }), {
      ...RIEN,
      presences: [presence()],
      rendezVous: [rdv()],
    })
    expect(v.ok).toBe(true)
  })

  it('détecte le conflit praticien même sur un autre fauteuil', () => {
    // La contrainte fauteuil ne broncherait pas : deux fauteuils, deux clés.
    const v = verifierCreneau(demande('13:15', '13:45'), {
      ...RIEN,
      presences: [presence()],
      rendezVous: [rdv({ fauteuilId: 'fauteuil-2' })],
    })
    expect(v.ok === false && v.violations).toContainEqual({
      code: 'CHEVAUCHEMENT_PRATICIEN',
      rendezVousId: 'rdv-existant',
    })
  })

  it('n’oppose pas le rendez-vous d’un confrère sur un autre fauteuil', () => {
    const v = verifierCreneau(demande('13:15', '13:45'), {
      ...RIEN,
      presences: [presence()],
      rendezVous: [rdv({ praticienId: AUTRE_PRATICIEN, fauteuilId: 'fauteuil-2' })],
    })
    expect(v.ok).toBe(true)
  })
})

describe('indisponibilités', () => {
  const indispo = (over: Partial<IndisponibiliteConnue> = {}): IndisponibiliteConnue => ({
    type: TypeIndisponibilite.FERIE,
    praticienId: null,
    siteId: SITE,
    debut: h('11:00'),
    fin: h('22:00'),
    ...over,
  })

  it('refuse un jour férié sur le site', () => {
    const v = verifierCreneau(demande('13:00', '13:30'), {
      ...RIEN,
      presences: [presence()],
      indisponibilites: [indispo()],
    })
    expect(v.ok === false && v.violations).toContainEqual({
      code: 'INDISPONIBLE',
      type: TypeIndisponibilite.FERIE,
    })
  })

  it('refuse pendant la pause déjeuner', () => {
    const v = verifierCreneau(demande('17:15', '17:45'), {
      ...RIEN,
      presences: [presence()],
      indisponibilites: [
        indispo({ type: TypeIndisponibilite.PAUSE, debut: h('17:00'), fin: h('18:00') }),
      ],
    })
    expect(v.ok === false && v.violations).toContainEqual({
      code: 'INDISPONIBLE',
      type: TypeIndisponibilite.PAUSE,
    })
  })

  it('ignore le congé d’un confrère', () => {
    const v = verifierCreneau(demande('13:00', '13:30'), {
      ...RIEN,
      presences: [presence()],
      indisponibilites: [
        indispo({ type: TypeIndisponibilite.CONGE, praticienId: AUTRE_PRATICIEN, siteId: null }),
      ],
    })
    expect(v.ok).toBe(true)
  })
})

describe('créneau gardé pour les urgences', () => {
  const garde: IndisponibiliteConnue = {
    type: TypeIndisponibilite.RESERVE_URGENCE,
    praticienId: null,
    siteId: SITE,
    debut: h('11:30'),
    fin: h('13:00'),
  }

  it('refuse un acte ordinaire', () => {
    const v = verifierCreneau(demande('12:00', '12:30'), {
      ...RIEN,
      presences: [presence()],
      indisponibilites: [garde],
    })
    expect(v.ok === false && v.violations).toContainEqual({ code: 'CRENEAU_RESERVE_URGENCE' })
  })

  it('laisse entrer une urgence — le créneau est gardé, pas fermé', () => {
    const v = verifierCreneau(demande('12:00', '12:30', { motifEstUrgence: true }), {
      ...RIEN,
      presences: [presence()],
      indisponibilites: [garde],
    })
    expect(v.ok).toBe(true)
  })
})

describe('tout dire d’un coup', () => {
  it('rend toutes les violations, pas la première', () => {
    // À l'accueil, apprendre qu'un créneau est pris puis, après correction,
    // qu'il tombe un jour férié, fait reprendre la saisie deux fois.
    const v = verifierCreneau(demande('13:15', '13:45'), {
      presences: [presence()],
      indisponibilites: [
        {
          type: TypeIndisponibilite.FERIE,
          praticienId: null,
          siteId: SITE,
          debut: h('11:00'),
          fin: h('22:00'),
        },
      ],
      rendezVous: [rdv()],
    })
    const codes = v.ok === false ? v.violations.map((x) => x.code) : []
    expect(codes).toContain('INDISPONIBLE')
    expect(codes).toContain('CHEVAUCHEMENT_FAUTEUIL')
  })

  it('une fin avant le début court-circuite le reste', () => {
    // Toute comparaison d'intervalle serait fausse ensuite.
    const v = verifierCreneau(demande('14:00', '13:00'), { ...RIEN, presences: [presence()] })
    expect(v.ok === false && v.violations).toEqual([{ code: 'FIN_AVANT_DEBUT' }])
  })
})

// La recherche de créneaux libres, qui alimente le portail public.
//
// Ce qu'elle doit prouver avant tout : elle ne propose QUE ce que
// `verifierCreneau` accepterait. Un patient qui choisit un créneau proposé et
// se voit répondre « impossible » perd confiance dans l'agenda entier.

const HEURES = (c: { debut: Date }[]) =>
  c.map((x) => x.debut.toISOString().slice(11, 16))

const recherche = (over: Record<string, unknown> = {}) => ({
  praticienId: PRATICIEN,
  siteId: SITE,
  dureeMinutes: 30,
  motifEstUrgence: false,
  debut: h('11:30'),
  fin: h('21:00'),
  pasMinutes: 15,
  ...over,
})

describe('recherche des créneaux libres', () => {
  it('ne propose rien sans plage de présence', () => {
    expect(creneauxLibres(recherche(), RIEN)).toEqual([])
  })

  it('découpe la plage de présence au pas demandé', () => {
    const libres = creneauxLibres(recherche({ fin: h('13:00') }), {
      ...RIEN,
      presences: [presence({ debut: h('11:30'), fin: h('13:00') })],
    })

    expect(HEURES(libres)).toEqual(['11:30', '11:45', '12:00', '12:15', '12:30'])
  })

  // Le dernier créneau doit TENIR dans la plage : en proposer un qui déborde
  // laisserait le patient au fauteuil après le départ du praticien.
  it('ne propose pas un créneau qui dépasse la fin de présence', () => {
    const libres = creneauxLibres(recherche({ dureeMinutes: 45, fin: h('13:00') }), {
      ...RIEN,
      presences: [presence({ debut: h('11:30'), fin: h('13:00') })],
    })

    expect(HEURES(libres).at(-1)).toBe('12:15')
  })

  it('saute ce qui est déjà pris, et reprend juste après', () => {
    const libres = creneauxLibres(recherche({ fin: h('14:00') }), {
      ...RIEN,
      presences: [presence({ debut: h('12:00'), fin: h('14:00') })],
      rendezVous: [rdv({ debut: h('12:30'), fin: h('13:15') })],
    })

    expect(HEURES(libres)).toEqual(['12:00', '13:15', '13:30'])
  })

  it('respecte les congés et les fermetures', () => {
    const indispo: IndisponibiliteConnue = {
      type: TypeIndisponibilite.PAUSE,
      praticienId: PRATICIEN,
      siteId: SITE,
      debut: h('12:00'),
      fin: h('13:00'),
    }

    const libres = creneauxLibres(recherche({ fin: h('13:30') }), {
      ...RIEN,
      presences: [presence({ debut: h('11:30'), fin: h('13:30') })],
      indisponibilites: [indispo],
    })

    expect(HEURES(libres)).toEqual(['11:30', '13:00'])
  })

  // Les créneaux gardés pour les urgences ne s'offrent pas à un contrôle
  // annuel, mais restent ouverts à quelqu'un qui a mal (Q17).
  it('garde les créneaux d’urgence pour les urgences', () => {
    const garde: IndisponibiliteConnue = {
      type: TypeIndisponibilite.RESERVE_URGENCE,
      praticienId: PRATICIEN,
      siteId: SITE,
      debut: h('11:30'),
      fin: h('12:30'),
    }
    const connu = {
      ...RIEN,
      presences: [presence({ debut: h('11:30'), fin: h('13:00') })],
      indisponibilites: [garde],
    }

    expect(HEURES(creneauxLibres(recherche({ fin: h('13:00') }), connu))).toEqual([
      '12:30',
    ])
    expect(
      HEURES(creneauxLibres(recherche({ fin: h('13:00'), motifEstUrgence: true }), connu)),
    ).toContain('11:30')
  })

  // Une recherche lancée à 12h07 ne doit pas proposer 12h07, 12h22, 12h37 :
  // l'alignement suit la plage de présence, pas l'instant de la requête.
  it('reste aligné sur la plage même quand la recherche démarre en cours de route', () => {
    const libres = creneauxLibres(recherche({ debut: h('12:07'), fin: h('13:00') }), {
      ...RIEN,
      presences: [presence({ debut: h('11:30'), fin: h('13:00') })],
    })

    expect(HEURES(libres)).toEqual(['12:15', '12:30'])
  })

  it('ignore les plages d’un autre praticien ou d’un autre site', () => {
    const libres = creneauxLibres(recherche({ fin: h('13:00') }), {
      ...RIEN,
      presences: [
        presence({ praticienId: AUTRE_PRATICIEN, debut: h('11:30'), fin: h('13:00') }),
        presence({ siteId: AUTRE_SITE, debut: h('11:30'), fin: h('13:00') }),
      ],
    })

    expect(libres).toEqual([])
  })

  it('rend les créneaux dans l’ordre, même si les plages arrivent mélangées', () => {
    const libres = creneauxLibres(recherche({ fin: h('19:00'), dureeMinutes: 60 }), {
      ...RIEN,
      presences: [
        presence({ debut: h('17:00'), fin: h('18:00') }),
        presence({ debut: h('11:30'), fin: h('12:30') }),
      ],
    })

    expect(HEURES(libres)).toEqual(['11:30', '17:00'])
  })

  // Le filet : tout ce qui sort d'ici doit passer la vérification qui sera
  // faite à l'enregistrement. Sinon le portail promet ce qu'il ne peut pas tenir.
  it('ne propose que des créneaux que l’enregistrement accepterait', () => {
    const connu = {
      presences: [presence({ debut: h('11:30'), fin: h('21:00') })],
      indisponibilites: [
        {
          type: TypeIndisponibilite.PAUSE,
          praticienId: PRATICIEN,
          siteId: SITE,
          debut: h('17:00'),
          fin: h('18:00'),
        } as IndisponibiliteConnue,
      ],
      rendezVous: [rdv({ debut: h('13:00'), fin: h('14:30') })],
    }

    const libres = creneauxLibres(recherche(), connu)
    expect(libres.length).toBeGreaterThan(10)

    for (const c of libres) {
      const verdict = verifierCreneau(
        {
          praticienId: PRATICIEN,
          siteId: SITE,
          debut: c.debut,
          fin: c.fin,
          motifEstUrgence: false,
          surbooking: false,
        },
        connu,
      )
      expect(verdict.ok).toBe(true)
    }
  })

  it('refuse une demande absurde plutôt que de boucler', () => {
    expect(creneauxLibres(recherche({ pasMinutes: 0 }), RIEN)).toEqual([])
    expect(creneauxLibres(recherche({ dureeMinutes: 0 }), RIEN)).toEqual([])
    expect(creneauxLibres(recherche({ debut: h('14:00'), fin: h('12:00') }), RIEN)).toEqual([])
  })
})

describe('manquements du patient (Q27)', () => {
  it('« absent » compte toujours, quel que soit celui qui le saisit', () => {
    // La secrétaire clique, mais c'est le patient qui n'est pas venu.
    expect(compteUnManquement(StatutRendezVous.ABSENT, 'cabinet')).toBe(true)
    expect(compteUnManquement(StatutRendezVous.ABSENT, 'patient')).toBe(true)
  })

  it("l'annulation ne compte que si elle vient du patient", () => {
    expect(compteUnManquement(StatutRendezVous.ANNULE, 'patient')).toBe(true)
    // Le praticien est souffrant et fait vider sa journée (Q5) : les patients
    // n'y sont pour rien, aucun ne doit approcher du blocage.
    expect(compteUnManquement(StatutRendezVous.ANNULE, 'cabinet')).toBe(false)
  })

  it('aucun autre statut du parcours ne coûte de point', () => {
    for (const statut of [
      StatutRendezVous.A_CONFIRMER,
      StatutRendezVous.CONFIRME,
      StatutRendezVous.SALLE_ATTENTE,
      StatutRendezVous.AU_FAUTEUIL,
      StatutRendezVous.TERMINE,
      StatutRendezVous.EN_CAISSE,
    ]) {
      expect(compteUnManquement(statut, 'patient')).toBe(false)
      expect(compteUnManquement(statut, 'cabinet')).toBe(false)
    }
  })

  it('la réservation se ferme au troisième, pas au deuxième', () => {
    expect(reservationFermee(0)).toBe(false)
    expect(reservationFermee(2)).toBe(false)
    expect(reservationFermee(SEUIL_MANQUEMENTS)).toBe(true)
    expect(reservationFermee(4)).toBe(true)
  })
})
