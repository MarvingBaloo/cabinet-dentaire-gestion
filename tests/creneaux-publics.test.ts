import { StatutRendezVous } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@/server/db/client'
import { listerMotifsPatient, listerSitesPublics } from '@/server/queries/public/catalogue'
import { creneauxDisponibles } from '@/server/queries/public/creneaux'

// Ce que ces tests cherchent à prouver :
//   - le portail ne propose que des créneaux réellement libres
//   - il ne propose rien dans le passé, ni au-delà de l'horizon d'ouverture
//   - une entrée de menu sans acte rattaché n'est pas montrée au patient
//
// ⚠ Aucune de ces fonctions ne reçoit d'appelant : c'est l'exception à D4, et
// c'est précisément ce qui doit être éprouvé.
//
// Les fixtures créent LEUR praticien et LEUR fauteuil : la base de test est
// partagée, et un rendez-vous posé par un autre fichier ne doit pas pouvoir
// faire échouer celui-ci.

const SUFFIXE = Date.now()

let siteId: string
let praticienId: string
let autrePraticienId: string
let motifId: string
let motifSansPraticienId: string
const cree: { praticiens: string[]; fauteuils: string[]; motifs: string[]; plages: string[]; rdv: string[] } = {
  praticiens: [], fauteuils: [], motifs: [], plages: [], rdv: [],
}

/** Demain, à une heure UTC fixe : la fenêtre est bornée au présent et à 62 jours. */
const jour = (decalageJours: number, heure: string) => {
  const d = new Date(Date.now() + decalageJours * 86_400_000)
  return new Date(`${d.toISOString().slice(0, 10)}T${heure}:00.000Z`)
}

beforeAll(async () => {
  const site = await prisma.site.findFirstOrThrow({ select: { id: true } })
  siteId = site.id

  for (const nom of ['Titulaire', 'Confrere']) {
    const p = await prisma.praticien.create({
      data: { nom: `Pub${nom}${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#123456' },
      select: { id: true },
    })
    cree.praticiens.push(p.id)
  }
  ;[praticienId, autrePraticienId] = cree.praticiens as [string, string]

  const fauteuil = await prisma.fauteuil.create({
    data: { siteId, nom: `Fauteuil test ${SUFFIXE}` },
    select: { id: true },
  })
  cree.fauteuils.push(fauteuil.id)

  const motif = await prisma.motifConsultation.create({
    data: { libelle: `Acte public ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifId = motif.id
  cree.motifs.push(motif.id)

  const orphelin = await prisma.motifConsultation.create({
    data: { libelle: `Acte sans praticien ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifSansPraticienId = orphelin.id
  cree.motifs.push(orphelin.id)

  // Seul le titulaire pratique l'acte : le confrère ne doit rien proposer.
  await prisma.praticienMotif.create({
    data: { praticienId, motifId, dureeMinutes: 30 },
  })

  // Présent demain de 12h à 14h UTC, sur un fauteuil qui n'est qu'à lui.
  const plage = await prisma.plageDePresence.create({
    data: { praticienId, siteId, fauteuilId: fauteuil.id, debut: jour(1, '12:00'), fin: jour(1, '14:00') },
    select: { id: true },
  })
  cree.plages.push(plage.id)
})

afterAll(async () => {
  await prisma.rendezVous.deleteMany({ where: { id: { in: cree.rdv } } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: cree.plages } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  await prisma.$disconnect()
})

const heures = (c: { debut: Date }[]) => c.map((x) => x.debut.toISOString().slice(11, 16))

describe('créneaux proposés au patient', () => {
  it('découpe la présence du praticien qui pratique l’acte', async () => {
    const libres = await creneauxDisponibles({
      motifId, siteId, debut: jour(1, '12:00'), fin: jour(1, '14:00'),
    })

    expect(heures(libres)).toEqual([
      '12:00', '12:15', '12:30', '12:45', '13:00', '13:15', '13:30',
    ])
    expect(libres.every((c) => c.praticienId === praticienId)).toBe(true)
  })

  it('ne propose rien pour un praticien qui ne pratique pas l’acte', async () => {
    const libres = await creneauxDisponibles({
      motifId, praticienId: autrePraticienId, debut: jour(1, '12:00'), fin: jour(1, '14:00'),
    })
    expect(libres).toEqual([])
  })

  it('ne propose rien pour un acte que personne ne pratique', async () => {
    const libres = await creneauxDisponibles({
      motifId: motifSansPraticienId, debut: jour(1, '12:00'), fin: jour(1, '14:00'),
    })
    expect(libres).toEqual([])
  })

  it('retire le créneau qu’un rendez-vous occupe', async () => {
    const rdv = await prisma.rendezVous.create({
      data: {
        patientId: (await prisma.patient.create({
          data: { nom: `PubPatient${SUFFIXE}`, prenom: 'Test', telephone: '+33600000000' },
          select: { id: true },
        })).id,
        praticienId,
        siteId,
        fauteuilId: cree.fauteuils[0]!,
        motifId,
        debut: jour(1, '12:30'),
        fin: jour(1, '13:00'),
        statut: StatutRendezVous.CONFIRME,
      },
      select: { id: true, patientId: true },
    })
    cree.rdv.push(rdv.id)

    const libres = await creneauxDisponibles({
      motifId, siteId, debut: jour(1, '12:00'), fin: jour(1, '14:00'),
    })

    expect(heures(libres)).toEqual(['12:00', '13:00', '13:15', '13:30'])

    await prisma.rendezVous.delete({ where: { id: rdv.id } })
    cree.rdv.pop()
    await prisma.patient.delete({ where: { id: rdv.patientId } })
  })

  // D17, retournée le 2026-09-23 : une demande d'annulation en attente
  // n'annule rien tant qu'elle n'est pas validée — le créneau reste occupé, il
  // ne doit donc pas être proposé au patient qui consulte le portail.
  it('retire aussi le créneau d’une demande d’annulation en attente', async () => {
    const rdv = await prisma.rendezVous.create({
      data: {
        patientId: (await prisma.patient.create({
          data: { nom: `PubPatientAttente${SUFFIXE}`, prenom: 'Test', telephone: '+33600000001' },
          select: { id: true },
        })).id,
        praticienId,
        siteId,
        fauteuilId: cree.fauteuils[0]!,
        motifId,
        debut: jour(1, '12:30'),
        fin: jour(1, '13:00'),
        statut: StatutRendezVous.ANNULATION_DEMANDEE,
        statutAvantAnnulation: StatutRendezVous.CONFIRME,
      },
      select: { id: true, patientId: true },
    })
    cree.rdv.push(rdv.id)

    const libres = await creneauxDisponibles({
      motifId, siteId, debut: jour(1, '12:00'), fin: jour(1, '14:00'),
    })

    expect(heures(libres)).toEqual(['12:00', '13:00', '13:15', '13:30'])

    await prisma.rendezVous.delete({ where: { id: rdv.id } })
    cree.rdv.pop()
    await prisma.patient.delete({ where: { id: rdv.patientId } })
  })

  // Un appelant public ne doit pas pouvoir faire travailler le serveur sur dix
  // ans, ni consulter un agenda au-delà de ce que le cabinet ouvre (Q3).
  it('borne la fenêtre à l’horizon d’ouverture, sans le dire', async () => {
    const libres = await creneauxDisponibles({
      motifId, siteId, debut: jour(1, '12:00'), fin: jour(400, '14:00'),
    })
    const limite = new Date(Date.now() + 63 * 86_400_000)
    expect(libres.every((c) => c.debut < limite)).toBe(true)
  })

  it('ne propose jamais le passé', async () => {
    const libres = await creneauxDisponibles({
      motifId, siteId, debut: jour(-30, '12:00'), fin: jour(1, '14:00'),
    })
    expect(libres.every((c) => c.debut.getTime() >= Date.now() - 60_000)).toBe(true)
  })

  it('rend une liste vide sur une fenêtre inversée', async () => {
    expect(
      await creneauxDisponibles({ motifId, debut: jour(2, '14:00'), fin: jour(2, '12:00') }),
    ).toEqual([])
  })
})

describe('catalogue public', () => {
  it('rend les cabinets avec leur adresse, et rien d’autre', async () => {
    const sites = await listerSitesPublics()
    expect(sites.length).toBeGreaterThan(0)
    expect(Object.keys(sites[0]!).sort()).toEqual(['adresse', 'code', 'id', 'nom'])
  })

  // Une entrée sans acte mènerait le patient à une liste vide qu'il prendrait
  // pour un agenda plein.
  it('ne montre aucune entrée de menu sans acte rattaché', async () => {
    const menu = await listerMotifsPatient()

    for (const e of menu) {
      expect(e.enfants.length > 0 || e.motifId !== null).toBe(true)
      for (const c of e.enfants) expect(c.motifId).toBeTruthy()
    }
  })
})
