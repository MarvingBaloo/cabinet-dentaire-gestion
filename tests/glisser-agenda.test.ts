import { describe, expect, it } from 'vitest'

import {
  DEBUT_GRILLE,
  FIN_GRILLE,
  PAS,
  arrondirAuPas,
  colonneDepuisX,
  deltaMinutesDepuisPixels,
  depasseLeSeuil,
  deplacementClavier,
  deplacerEntreJours,
  deplacerPlage,
  repartirEnCouloirs,
  HAUTEUR_PAS,
  pixelsDepuisPlage,
  redimensionnerFin,
  minutesDepuisY,
  lienNouveauRendezVous,
  verdictDepot,
} from '@/lib/glisser-agenda'

// Calcul pur du lot 6 (glisser-déposer / redimensionnement) : aucune base,
// aucun DOM — même principe que les tests du domaine de l'agenda (D11).

describe('arrondirAuPas', () => {
  it('arrondit au pas le plus proche', () => {
    expect(arrondirAuPas(14, 30)).toBe(0)
    expect(arrondirAuPas(16, 30)).toBe(30)
    expect(arrondirAuPas(44, 30)).toBe(30)
    expect(arrondirAuPas(46, 30)).toBe(60)
  })
})

describe('deltaMinutesDepuisPixels', () => {
  it('convertit un déplacement vertical en minutes arrondies au pas', () => {
    // Une demi-heure (PAS) vaut HAUTEUR_PAS pixels : un déplacement égal à
    // cette hauteur doit rendre exactement une demi-heure.
    expect(deltaMinutesDepuisPixels(44, 44, 30)).toBe(30)
    expect(deltaMinutesDepuisPixels(-44, 44, 30)).toBe(-30)
    // Un tout petit mouvement (moins que la moitié d'un pas) arrondit à zéro.
    expect(deltaMinutesDepuisPixels(5, 44, 30)).toBe(0)
    // Un peu plus de la moitié du pas arrondit au pas suivant.
    expect(deltaMinutesDepuisPixels(25, 44, 30)).toBe(30)
  })
})

describe('deplacerPlage', () => {
  const bornes = { debut: DEBUT_GRILLE, fin: FIN_GRILLE }

  it('conserve la durée et applique le décalage', () => {
    const plage = { debut: 600, fin: 630 } // 10h00–10h30
    const deplace = deplacerPlage(plage, 60, bornes) // +1h
    expect(deplace).toEqual({ debut: 660, fin: 690 })
  })

  it('ne descend jamais avant le début de la grille affichée', () => {
    const plage = { debut: DEBUT_GRILLE + 30, fin: DEBUT_GRILLE + 60 }
    const deplace = deplacerPlage(plage, -1000, bornes)
    expect(deplace.debut).toBe(DEBUT_GRILLE)
    expect(deplace.fin).toBe(DEBUT_GRILLE + 30) // durée conservée
  })

  it('ne dépasse jamais la fin de la grille affichée', () => {
    const plage = { debut: FIN_GRILLE - 60, fin: FIN_GRILLE - 30 }
    const deplace = deplacerPlage(plage, 1000, bornes)
    expect(deplace.fin).toBe(FIN_GRILLE)
    expect(deplace.debut).toBe(FIN_GRILLE - 30) // durée conservée
  })
})

describe('redimensionnerFin', () => {
  const bornes = { debut: DEBUT_GRILLE, fin: FIN_GRILLE }

  it('étire la fin sans bouger le début', () => {
    const plage = { debut: 600, fin: 630 }
    expect(redimensionnerFin(plage, 30, bornes)).toBe(660)
  })

  it('raccourcit sans jamais descendre sous la durée minimale (un pas)', () => {
    const plage = { debut: 600, fin: 630 }
    expect(redimensionnerFin(plage, -1000, bornes, PAS)).toBe(plage.debut + PAS)
  })

  it('ne dépasse jamais la fin de la fenêtre affichée', () => {
    const plage = { debut: FIN_GRILLE - 30, fin: FIN_GRILLE - 15 }
    expect(redimensionnerFin(plage, 1000, bornes)).toBe(FIN_GRILLE)
  })
})

describe('colonneDepuisX', () => {
  it('trouve la colonne visée parmi des colonnes de largeur égale', () => {
    expect(colonneDepuisX(0, 100, 3)).toBe(0)
    expect(colonneDepuisX(99, 100, 3)).toBe(0)
    expect(colonneDepuisX(100, 100, 3)).toBe(1)
    expect(colonneDepuisX(250, 100, 3)).toBe(2)
  })

  it('rend null hors de la grille plutôt que la colonne la plus proche', () => {
    expect(colonneDepuisX(-1, 100, 3)).toBeNull()
    expect(colonneDepuisX(300, 100, 3)).toBeNull()
  })

  it('rend null sur une géométrie dégénérée', () => {
    expect(colonneDepuisX(10, 0, 3)).toBeNull()
    expect(colonneDepuisX(10, 100, 0)).toBeNull()
  })
})

describe('depasseLeSeuil', () => {
  it('un tout petit mouvement reste un clic', () => {
    expect(depasseLeSeuil(1, 2)).toBe(false)
  })

  it('un mouvement franc devient un glisser, horizontal ou vertical', () => {
    expect(depasseLeSeuil(10, 0)).toBe(true)
    expect(depasseLeSeuil(0, 10)).toBe(true)
  })
})

describe('pixelsDepuisPlage', () => {
  it('rend le haut et la hauteur en pixels pour une plage donnée', () => {
    const pix = pixelsDepuisPlage({ debut: DEBUT_GRILLE + 30, fin: DEBUT_GRILLE + 90 }, DEBUT_GRILLE, 30, 44)
    expect(pix.top).toBe(44)
    expect(pix.hauteur).toBe(88)
  })
})

describe('pas de 15 minutes', () => {
  it('le pas du glisser est de 15 minutes', () => {
    expect(PAS).toBe(15)
    expect(HAUTEUR_PAS).toBe(22)
  })

  it('un déplacement de 22 px vaut 15 minutes', () => {
    expect(deltaMinutesDepuisPixels(22)).toBe(15)
    expect(deltaMinutesDepuisPixels(-22)).toBe(-15)
    expect(deltaMinutesDepuisPixels(5)).toBe(0)
  })

  it('le redimensionnement ne descend pas sous 15 minutes', () => {
    expect(redimensionnerFin({ debut: 600, fin: 630 }, -1000)).toBe(615)
  })
})

describe('deplacerEntreJours', () => {
  it('lundi 9h00-9h30 déposé vendredi à 14h15 : durée conservée', () => {
    const r = deplacerEntreJours({ debut: 540, fin: 570 }, 0, 315, 4)
    expect(r).toEqual({ colonne: 4, debut: 855, fin: 885 })
  })

  it('conserve la durée aux bornes de la grille', () => {
    expect(deplacerEntreJours({ debut: 540, fin: 600 }, 0, 100_000, 2)).toEqual({
      colonne: 2,
      debut: FIN_GRILLE - 60,
      fin: FIN_GRILLE,
    })
    expect(deplacerEntreJours({ debut: 540, fin: 600 }, 3, -100_000, 1)).toEqual({
      colonne: 1,
      debut: DEBUT_GRILLE,
      fin: DEBUT_GRILLE + 60,
    })
  })

  it('garde la colonne d’origine quand le pointeur est hors de la grille', () => {
    expect(deplacerEntreJours({ debut: 540, fin: 570 }, 2, 15, null).colonne).toBe(2)
  })
})

describe('repartirEnCouloirs', () => {
  it('laisse un couloir unique aux plages sans chevauchement', () => {
    const r = repartirEnCouloirs([
      { debut: 540, fin: 570 },
      { debut: 570, fin: 600 },
    ])
    expect(r).toEqual([
      { couloir: 0, couloirs: 1 },
      { couloir: 0, couloirs: 1 },
    ])
  })

  it('met côte à côte deux plages simultanées', () => {
    const r = repartirEnCouloirs([
      { debut: 540, fin: 600 },
      { debut: 560, fin: 620 },
      { debut: 700, fin: 730 },
    ])
    expect(r[0]).toEqual({ couloir: 0, couloirs: 2 })
    expect(r[1]).toEqual({ couloir: 1, couloirs: 2 })
    expect(r[2]).toEqual({ couloir: 0, couloirs: 1 })
  })
})

describe('créer au clic sur une case vide', () => {
  const presences = [
    { praticienId: 'aubertin', siteId: 'mg', fauteuilId: 'f1', jour: '2026-10-22', debut: 8 * 60, fin: 18 * 60 },
    { praticienId: 'valmy', siteId: 'gp', fauteuilId: 'g1', jour: '2026-10-23', debut: 8 * 60, fin: 16 * 60 },
  ]

  it('arrondit le clic au quart d’heure inférieur, dans les bornes de la grille', () => {
    expect(minutesDepuisY(0, 22)).toBe(DEBUT_GRILLE)
    expect(minutesDepuisY(22 * 4 * 8 + 30, 22)).toBe(DEBUT_GRILLE + 8 * 60 + 15)
    expect(minutesDepuisY(99_999, 22)).toBe(FIN_GRILLE - PAS)
  })

  it('pré-remplit le praticien présent dans ce fauteuil à cette heure', () => {
    const lien = lienNouveauRendezVous({ jour: '2026-10-22', minutes: 15 * 60, presences, fauteuilId: 'f1' })
    expect(lien).toBe('/tableau-de-bord/agenda/nouveau?jour=2026-10-22&heure=15%3A00&site=mg&praticien=aubertin')
  })

  it('sans présence, ne propose que le jour, l’heure et le cabinet affiché', () => {
    const lien = lienNouveauRendezVous({ jour: '2026-10-22', minutes: 19 * 60, presences, siteId: 'mg' })
    expect(lien).toBe('/tableau-de-bord/agenda/nouveau?jour=2026-10-22&heure=19%3A00&site=mg')
  })

  it('en vue semaine, cherche la présence dans le cabinet affiché seulement', () => {
    expect(lienNouveauRendezVous({ jour: '2026-10-23', minutes: 9 * 60, presences, siteId: 'mg' })).not.toContain(
      'valmy',
    )
    expect(lienNouveauRendezVous({ jour: '2026-10-23', minutes: 9 * 60, presences, siteId: null })).toContain(
      'praticien=valmy',
    )
  })
})

describe('verdictDepot : une place permise, ou la raison du refus, pendant le geste', () => {
  const p = (praticienId: string, fauteuilId: string, debut: number, fin: number, jour = '2026-10-29') => ({
    praticienId,
    siteId: 's',
    fauteuilId,
    jour,
    debut,
    fin,
    praticienNom: praticienId === 'adm' ? 'Administrateur' : 'Démo',
    fauteuilNom: fauteuilId === 'f1' ? 'Fauteuil 1' : 'Fauteuil 2',
  })
  const presences = [p('adm', 'f1', 480, 1080), p('demo', 'f2', 480, 1080)]
  const rdv = (id: string, praticienId: string, fauteuilId: string, debut: number, fin: number, libere = false) => ({
    id, praticienId, fauteuilId, jour: '2026-10-29', debut, fin, libere, patient: `Patient ${id}`,
  })
  const pelage = { id: 'pelage', praticienId: 'adm', praticienNom: 'Administrateur', jour: '2026-10-29', exception: false }

  it('vue jour : sa place, sur son fauteuil, libre', () => {
    expect(verdictDepot({ ...pelage, debut: 660, fin: 690, fauteuilId: 'f1' }, presences, [])).toEqual({ ok: true, fauteuilId: 'f1' })
  })

  it('le fauteuil d’un confrère : refusé, en le nommant', () => {
    const v = verdictDepot({ ...pelage, debut: 660, fin: 690, fauteuilId: 'f2' }, presences, [])
    expect(v).toEqual({ ok: false, raison: 'Fauteuil 2 : c’est le fauteuil du Dr Démo à cette heure.' })
  })

  it('hors de sa présence, ou un jour où il n’est pas là', () => {
    expect(verdictDepot({ ...pelage, debut: 1080, fin: 1110, fauteuilId: 'f1' }, presences, [])).toMatchObject({ ok: false, raison: 'En dehors des heures de présence du Dr Administrateur.' })
    expect(verdictDepot({ ...pelage, jour: '2026-10-31', debut: 600, fin: 630, fauteuilId: null }, presences, [])).toMatchObject({ ok: false, raison: 'Le Dr Administrateur n’est pas présent ce jour-là.' })
  })

  it('une place prise par un autre rendez-vous du praticien ou du fauteuil ; un annulé ne gêne pas', () => {
    const pris = [rdv('dupont', 'adm', 'f1', 660, 690)]
    expect(verdictDepot({ ...pelage, debut: 675, fin: 705, fauteuilId: 'f1' }, presences, pris)).toEqual({ ok: false, raison: 'Créneau déjà pris : Patient dupont à 11:00.' })
    expect(verdictDepot({ ...pelage, debut: 675, fin: 705, fauteuilId: 'f1' }, presences, [rdv('dupont', 'adm', 'f1', 660, 690, true)])).toMatchObject({ ok: true })
    // Il ne se gêne pas lui-même : décaler de quinze minutes un rendez-vous d'une heure.
    expect(verdictDepot({ ...pelage, debut: 615, fin: 675, fauteuilId: 'f1' }, presences, [rdv('pelage', 'adm', 'f1', 600, 660)])).toMatchObject({ ok: true })
  })

  it('vue semaine : le fauteuil vient de la présence du praticien ce jour-là', () => {
    expect(verdictDepot({ ...pelage, debut: 600, fin: 630, fauteuilId: null }, presences, [])).toEqual({ ok: true, fauteuilId: 'f1' })
  })

  it('une urgence ou un hors-horaires : le serveur seul en juge', () => {
    expect(verdictDepot({ ...pelage, exception: true, debut: 1110, fin: 1140, fauteuilId: 'f1' }, presences, [])).toEqual({ ok: true, fauteuilId: 'f1' })
  })
})

describe('deplacementClavier (24/10)', () => {
  const place = { colonne: 1, debut: 9 * 60, fin: 9 * 60 + 30 }

  it('↑ ↓ déplacent d’un quart d’heure, ← → d’une colonne', () => {
    expect(deplacementClavier('ArrowDown', false, place, 3)).toEqual({ colonne: 1, debut: 555, fin: 585 })
    expect(deplacementClavier('ArrowUp', false, place, 3)).toEqual({ colonne: 1, debut: 525, fin: 555 })
    expect(deplacementClavier('ArrowLeft', false, place, 3)).toEqual({ ...place, colonne: 0 })
    expect(deplacementClavier('ArrowRight', false, place, 3)).toEqual({ ...place, colonne: 2 })
  })

  it('avec Maj, ↑ ↓ changent la durée, jamais sous un quart d’heure', () => {
    expect(deplacementClavier('ArrowDown', true, place, 3)).toEqual({ colonne: 1, debut: 540, fin: 585 })
    expect(deplacementClavier('ArrowUp', true, { ...place, fin: place.debut + PAS }, 3)).toEqual({
      colonne: 1,
      debut: 540,
      fin: 540 + PAS,
    })
  })

  it('reste dans la grille : ni avant la première colonne, ni après la dernière, ni hors des heures', () => {
    expect(deplacementClavier('ArrowLeft', false, { ...place, colonne: 0 }, 3)?.colonne).toBe(0)
    expect(deplacementClavier('ArrowRight', false, { ...place, colonne: 2 }, 3)?.colonne).toBe(2)
    expect(deplacementClavier('ArrowUp', false, { colonne: 0, debut: DEBUT_GRILLE, fin: DEBUT_GRILLE + 30 }, 3)?.debut).toBe(DEBUT_GRILLE)
    expect(deplacementClavier('ArrowDown', false, { colonne: 0, debut: FIN_GRILLE - 30, fin: FIN_GRILLE }, 3)?.fin).toBe(FIN_GRILLE)
  })

  it('une autre touche ne déplace rien', () => {
    expect(deplacementClavier('Enter', false, place, 3)).toBeNull()
    expect(deplacementClavier('a', false, place, 3)).toBeNull()
  })
})
