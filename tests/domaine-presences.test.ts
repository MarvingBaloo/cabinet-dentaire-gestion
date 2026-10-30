import { describe, expect, it } from 'vitest'

import { instantCabinet } from '@/lib/dates'
import {
  type ExceptionConnue,
  type LigneSemaineTypeConnue,
  type RendezVousActifConnu,
  jourSemaineISO,
  joursDeLHorizon,
  plagesVoulues,
  plagesVouluesAvecFeries,
  rendezVousOrphelins,
  retirerJoursFeries,
} from '@/server/domaine/presences'

// Tests du domaine : aucune base, aucun contexte (D11, même principe que
// domaine-agenda.test.ts). La génération des présences doit produire
// EXACTEMENT le même résultat qu'elle soit rejouée par le service à
// l'enregistrement ou par le worker au glissement quotidien de l'horizon —
// s'en assurer ici, en millisecondes, plutôt qu'avec une vraie base.

const SITE = 'site-mg'
const FAUTEUIL = 'fauteuil-1'

// 2024-01-01 est un lundi (vérifié) : ancre stable pour les tests de jour de
// semaine, indépendante de la date d'exécution des tests.
const LUNDI = '2024-01-01'
const MARDI = '2024-01-02'
const SAMEDI = '2024-01-06'
const DIMANCHE = '2024-01-07'

const ligne = (over: Partial<LigneSemaineTypeConnue> = {}): LigneSemaineTypeConnue => ({
  jourSemaine: 1,
  siteId: SITE,
  fauteuilId: FAUTEUIL,
  heureDebut: 8 * 60,
  heureFin: 18 * 60,
  ...over,
})

describe('jourSemaineISO', () => {
  it('lundi vaut 1, dimanche vaut 7 (ISO), jamais 0', () => {
    expect(jourSemaineISO(LUNDI)).toBe(1)
    expect(jourSemaineISO(MARDI)).toBe(2)
    expect(jourSemaineISO(SAMEDI)).toBe(6)
    expect(jourSemaineISO(DIMANCHE)).toBe(7)
  })
})

describe('joursDeLHorizon', () => {
  it('inclut les deux bornes', () => {
    expect(joursDeLHorizon(LUNDI, MARDI)).toEqual([LUNDI, MARDI])
  })

  it('une seule journée quand début = fin', () => {
    expect(joursDeLHorizon(LUNDI, LUNDI)).toEqual([LUNDI])
  })
})

describe('plagesVoulues — semaine type seule', () => {
  it('génère une plage chaque semaine, le bon jour, aux bonnes heures', () => {
    const semaineType = [ligne({ jourSemaine: 1 })] // lundi
    const horizon = { debut: LUNDI, fin: '2024-01-28' } // 4 semaines pleines
    const voulues = plagesVoulues(semaineType, [], horizon)

    expect(voulues).toHaveLength(4)
    for (const p of voulues) {
      expect(jourSemaineISO(p.jour)).toBe(1)
      expect(p.siteId).toBe(SITE)
      expect(p.fauteuilId).toBe(FAUTEUIL)
      // 08:00 heure du cabinet = 12:00 UTC (D10, UTC-4 fixe).
      expect(p.debut.toISOString()).toBe(`${p.jour}T12:00:00.000Z`)
      expect(p.fin.toISOString()).toBe(`${p.jour}T22:00:00.000Z`)
    }
  })

  it('rien un jour que la semaine type ne couvre pas', () => {
    const semaineType = [ligne({ jourSemaine: 1 })]
    const voulues = plagesVoulues(semaineType, [], { debut: MARDI, fin: MARDI })
    expect(voulues).toHaveLength(0)
  })

  it('deux mois : le bon compte de lundis', () => {
    const semaineType = [ligne({ jourSemaine: 1 })]
    // HORIZON_JOURS = 62 (Q3) : 63 jours inclus, du 1er janvier au 3 mars 2024.
    const voulues = plagesVoulues(semaineType, [], { debut: LUNDI, fin: '2024-03-03' })
    const lundis = joursDeLHorizon(LUNDI, '2024-03-03').filter((j) => jourSemaineISO(j) === 1)
    expect(voulues).toHaveLength(lundis.length)
  })

  it('idempotent : rejouer le calcul rend exactement le même résultat', () => {
    const semaineType = [ligne({ jourSemaine: 1 }), ligne({ jourSemaine: 5, siteId: 'site-gp' })]
    const horizon = { debut: LUNDI, fin: '2024-02-01' }
    expect(plagesVoulues(semaineType, [], horizon)).toEqual(plagesVoulues(semaineType, [], horizon))
  })
})

describe('plagesVoulues — exceptions', () => {
  it('RETRAIT vide le jour, même si la semaine type y prévoyait une présence', () => {
    const semaineType = [ligne({ jourSemaine: 1 })]
    const exceptions: ExceptionConnue[] = [
      { date: LUNDI, type: 'RETRAIT', siteId: null, fauteuilId: null, heureDebut: null, heureFin: null },
    ]
    const voulues = plagesVoulues(semaineType, exceptions, { debut: LUNDI, fin: LUNDI })
    expect(voulues).toHaveLength(0)
  })

  it('AJOUT_OU_MODIFICATION remplace la semaine type ce jour-là', () => {
    const semaineType = [ligne({ jourSemaine: 1, fauteuilId: 'fauteuil-1' })]
    const exceptions: ExceptionConnue[] = [
      {
        date: LUNDI,
        type: 'AJOUT_OU_MODIFICATION',
        siteId: SITE,
        fauteuilId: 'fauteuil-2',
        heureDebut: 9 * 60,
        heureFin: 12 * 60,
      },
    ]
    const voulues = plagesVoulues(semaineType, exceptions, { debut: LUNDI, fin: LUNDI })
    expect(voulues).toHaveLength(1)
    expect(voulues[0]!.fauteuilId).toBe('fauteuil-2')
    expect(voulues[0]!.heureDebut).toBe(9 * 60)
    expect(voulues[0]!.heureFin).toBe(12 * 60)
  })

  it('AJOUT_OU_MODIFICATION ouvre un jour que la semaine type laissait vide', () => {
    const exceptions: ExceptionConnue[] = [
      {
        date: MARDI,
        type: 'AJOUT_OU_MODIFICATION',
        siteId: SITE,
        fauteuilId: FAUTEUIL,
        heureDebut: 9 * 60,
        heureFin: 12 * 60,
      },
    ]
    const voulues = plagesVoulues([], exceptions, { debut: MARDI, fin: MARDI })
    expect(voulues).toHaveLength(1)
  })

  it('une exception ne déborde jamais sur les autres jours', () => {
    const semaineType = [ligne({ jourSemaine: 1 })]
    const exceptions: ExceptionConnue[] = [
      { date: LUNDI, type: 'RETRAIT', siteId: null, fauteuilId: null, heureDebut: null, heureFin: null },
    ]
    const voulues = plagesVoulues(semaineType, exceptions, { debut: LUNDI, fin: '2024-01-15' })
    // Trois lundis dans la fenêtre (01, 08, 15 janvier) : seul le premier est
    // retiré, les deux autres restent.
    expect(voulues).toHaveLength(2)
    expect(voulues.map((p) => p.jour)).toEqual(['2024-01-08', '2024-01-15'])
  })
})

describe('rendezVousOrphelins', () => {
  // Heure du CABINET, pas UTC brut (D10) — la même conversion que
  // `plagesVoulues` applique à ses propres bornes, sans quoi un rendez-vous
  // « à 13h » construit en UTC brut tomberait en réalité à 13h moins quatre
  // heures de décalage, et le test comparerait deux référentiels différents.
  const h = (jour: string, heure: string) => instantCabinet(jour, heure)!

  const rdv = (over: Partial<RendezVousActifConnu> = {}): RendezVousActifConnu => ({
    id: 'rdv-1',
    fauteuilId: FAUTEUIL,
    debut: h(LUNDI, '13:00'),
    fin: h(LUNDI, '13:30'),
    ...over,
  })

  it('un rendez-vous couvert par une plage voulue n’est pas orphelin', () => {
    const semaineType = [ligne({ jourSemaine: 1 })]
    const voulues = plagesVoulues(semaineType, [], { debut: LUNDI, fin: LUNDI })
    expect(rendezVousOrphelins([rdv()], voulues)).toHaveLength(0)
  })

  it('un rendez-vous que plus aucune plage ne couvre devient orphelin', () => {
    // La semaine type ne couvre plus 13h-13h30 : la présence s'arrête à midi.
    const semaineType = [ligne({ jourSemaine: 1, heureDebut: 8 * 60, heureFin: 12 * 60 })]
    const voulues = plagesVoulues(semaineType, [], { debut: LUNDI, fin: LUNDI })
    const orphelins = rendezVousOrphelins([rdv()], voulues)
    expect(orphelins).toHaveLength(1)
    expect(orphelins[0]!.id).toBe('rdv-1')
  })

  it('un rendez-vous sur un fauteuil différent de la plage voulue est orphelin', () => {
    const semaineType = [ligne({ jourSemaine: 1, fauteuilId: 'fauteuil-2' })]
    const voulues = plagesVoulues(semaineType, [], { debut: LUNDI, fin: LUNDI })
    expect(rendezVousOrphelins([rdv({ fauteuilId: FAUTEUIL })], voulues)).toHaveLength(1)
  })
})

// Fermeture par défaut des jours fériés (Q29, Q30, compléments d'agenda lot 2).
// Fonction SÉPARÉE de `plagesVoulues` (voir le commentaire de
// `retirerJoursFeries`, src/server/domaine/presences.ts) : les tests ci-dessus
// n'en savent rien et continuent de démontrer exactement ce qu'ils démontraient
// avant ce lot — y compris via LUNDI, qui EST le 1er janvier, un jour férié.
describe('retirerJoursFeries / plagesVouluesAvecFeries — fermé par défaut (Q29, Q30)', () => {
  const FERIE = '2026-01-01' // Jour de l'an
  const jourSemaineFerie = jourSemaineISO(FERIE)

  it('un jour férié couvert par la semaine type ne produit AUCUNE plage', () => {
    const semaineType = [ligne({ jourSemaine: jourSemaineFerie })]
    const voulues = plagesVouluesAvecFeries(semaineType, [], { debut: FERIE, fin: FERIE })
    expect(voulues).toHaveLength(0)
  })

  it('une exception AJOUT_OU_MODIFICATION ouvre le férié pour ce praticien', () => {
    const exceptions: ExceptionConnue[] = [
      {
        date: FERIE,
        type: 'AJOUT_OU_MODIFICATION',
        siteId: SITE,
        fauteuilId: FAUTEUIL,
        heureDebut: 9 * 60,
        heureFin: 12 * 60,
      },
    ]
    const voulues = plagesVouluesAvecFeries([], exceptions, { debut: FERIE, fin: FERIE })
    expect(voulues).toHaveLength(1)
    expect(voulues[0]!.heureDebut).toBe(9 * 60)
  })

  it('une exception RETRAIT sur un férié ne change rien : déjà fermé', () => {
    const semaineType = [ligne({ jourSemaine: jourSemaineFerie })]
    const exceptions: ExceptionConnue[] = [
      { date: FERIE, type: 'RETRAIT', siteId: null, fauteuilId: null, heureDebut: null, heureFin: null },
    ]
    const voulues = plagesVouluesAvecFeries(semaineType, exceptions, { debut: FERIE, fin: FERIE })
    expect(voulues).toHaveLength(0)
  })

  it('ne retire QUE le jour férié, pas les autres occurrences du même jour de semaine', () => {
    const semaineType = [ligne({ jourSemaine: 1 })] // lundi
    const horizon = { debut: LUNDI, fin: '2024-01-28' }
    // LUNDI (2024-01-01) EST un jour férié (Jour de l'an) : `plagesVoulues`
    // nue l'ignore (voir le describe précédent, même horizon, 4 lundis) —
    // c'est exactement ce que la composition doit retirer, sans toucher aux
    // trois autres lundis du mois.
    expect(plagesVoulues(semaineType, [], horizon)).toHaveLength(4)
    const avecFeries = plagesVouluesAvecFeries(semaineType, [], horizon)
    expect(avecFeries.map((p) => p.jour)).toEqual(['2024-01-08', '2024-01-15', '2024-01-22'])
  })

  it('retirerJoursFeries seule : ne retire que les plages fériées sans exception ouvrante', () => {
    const voulues = plagesVoulues([ligne({ jourSemaine: jourSemaineFerie })], [], { debut: FERIE, fin: FERIE })
    expect(voulues).toHaveLength(1) // `plagesVoulues` nue ignore les fériés
    expect(retirerJoursFeries(voulues, [])).toHaveLength(0)
  })
})

describe('plagesVoulues — pause du midi (18/10)', () => {
  const pause = { pauseDebut: 12 * 60, pauseFin: 13 * 60 + 30 }

  it('une pause coupe la journée en deux plages, rien entre les deux', () => {
    const voulues = plagesVoulues([ligne(pause)], [], { debut: LUNDI, fin: LUNDI })
    expect(voulues.map((p) => [p.heureDebut, p.heureFin])).toEqual([
      [8 * 60, 12 * 60],
      [13 * 60 + 30, 18 * 60],
    ])
    expect(voulues[0]!.fin).toEqual(instantCabinet(LUNDI, '12:00'))
    expect(voulues[1]!.debut).toEqual(instantCabinet(LUNDI, '13:30'))
  })

  it('un rendez-vous posé pendant la pause devient orphelin', () => {
    const voulues = plagesVoulues([ligne(pause)], [], { debut: LUNDI, fin: LUNDI })
    const rdv: RendezVousActifConnu = {
      id: 'rdv-midi',
      fauteuilId: FAUTEUIL,
      debut: instantCabinet(LUNDI, '12:30')!,
      fin: instantCabinet(LUNDI, '13:00')!,
    }
    expect(rendezVousOrphelins([rdv], voulues).map((r) => r.id)).toEqual(['rdv-midi'])
  })

  it('une pause qui ne tient pas dans la journée est ignorée (une seule plage)', () => {
    const voulues = plagesVoulues([ligne({ pauseDebut: 7 * 60, pauseFin: 9 * 60 })], [], { debut: LUNDI, fin: LUNDI })
    expect(voulues.map((p) => [p.heureDebut, p.heureFin])).toEqual([[8 * 60, 18 * 60]])
  })

  it('une exception du jour remplace la journée, pause comprise', () => {
    const exception: ExceptionConnue = {
      date: LUNDI,
      type: 'AJOUT_OU_MODIFICATION',
      siteId: SITE,
      fauteuilId: FAUTEUIL,
      heureDebut: 9 * 60,
      heureFin: 15 * 60,
    }
    const voulues = plagesVoulues([ligne(pause)], [exception], { debut: LUNDI, fin: LUNDI })
    expect(voulues.map((p) => [p.heureDebut, p.heureFin])).toEqual([[9 * 60, 15 * 60]])
  })
})
