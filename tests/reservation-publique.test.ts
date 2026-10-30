import { StatutRendezVous } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@/server/db/client'
import {
  confirmerReservation,
  demarrerReservation,
} from '@/server/services/reservation-publique'
import { definirTransporteur, type Message } from '@/server/sms/envoi'

// Ce que ces tests cherchent à prouver :
//   - rien n'est écrit dans l'agenda tant que le code n'est pas rendu
//   - le créneau est jugé DEUX fois : au choix, puis à la confirmation
//   - un code faux se compte, un code expiré ne s'utilise pas
//   - la trace au journal ne nomme personne et ne dit pas pourquoi on vient
//
// Le transporteur SMS est remplacé : on ne fait pas payer un fournisseur pour
// une suite de tests, et il faut pouvoir relire le code envoyé.

const SUFFIXE = Date.now()
const IP = `203.0.113.${SUFFIXE % 200}`

let siteId: string
let praticienId: string
let fauteuilId: string
let motifId: string
const cree = { praticiens: [] as string[], fauteuils: [] as string[], motifs: [] as string[], plages: [] as string[] }

let dernierCode = ''
const transporteurEssai = {
  nom: 'essai',
  async envoyer(m: Message) {
    dernierCode = /(\d{6})/.exec(m.texte)?.[1] ?? ''
    return { ok: true as const, reference: 'essai' }
  },
}

const jour = (d: number, heure: string) => {
  const j = new Date(Date.now() + d * 86_400_000)
  return new Date(`${j.toISOString().slice(0, 10)}T${heure}:00.000Z`)
}

const coordonnees = {
  nom: `Reserve${SUFFIXE}`,
  prenom: 'Patient',
  telephone: `+3360000${String(SUFFIXE).slice(-4)}`,
  ipAddress: IP,
}

beforeAll(async () => {
  definirTransporteur(transporteurEssai)

  siteId = (await prisma.site.findFirstOrThrow({ select: { id: true } })).id

  const p = await prisma.praticien.create({
    data: { nom: `Resa${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const f = await prisma.fauteuil.create({
    data: { siteId, nom: `Fauteuil resa ${SUFFIXE}` },
    select: { id: true },
  })
  fauteuilId = f.id
  cree.fauteuils.push(f.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Acte resa ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)

  await prisma.praticienMotif.create({ data: { praticienId, motifId, dureeMinutes: 30 } })

  const plage = await prisma.plageDePresence.create({
    data: { praticienId, siteId, fauteuilId, debut: jour(2, '12:00'), fin: jour(2, '16:00') },
    select: { id: true },
  })
  cree.plages.push(plage.id)
})

/** Chaque test repart d'un agenda vide pour ce praticien. */
beforeEach(async () => {
  await prisma.reservationPublique.deleteMany({ where: { praticienId } })
  // Doit précéder la suppression des rendez-vous : `Notification.rendezVous`
  // est `onDelete: Restrict` (phase 4, lot 3, D37) — une réservation confirmée
  // émet désormais une ligne CONFIRMATION_RESERVATION.
  await prisma.notification.deleteMany({ where: { destinataire: coordonnees.telephone } })
  await prisma.rendezVous.deleteMany({ where: { praticienId } })
  await prisma.patient.deleteMany({ where: { telephone: coordonnees.telephone } })
})

afterAll(async () => {
  await prisma.reservationPublique.deleteMany({ where: { praticienId } })
  await prisma.notification.deleteMany({ where: { destinataire: coordonnees.telephone } })
  await prisma.rendezVous.deleteMany({ where: { praticienId } })
  await prisma.patient.deleteMany({ where: { telephone: coordonnees.telephone } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: cree.plages } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  await prisma.$disconnect()
})

const demarrer = (heure = '13:00') =>
  demarrerReservation({ motifId, praticienId, siteId, debut: jour(2, heure), ...coordonnees })

describe('réservation depuis le portail', () => {
  it('envoie un code et n’écrit RIEN dans l’agenda', async () => {
    const debut = await demarrer()

    expect(debut.etat).toBe('code_envoye')
    expect(dernierCode).toMatch(/^\d{6}$/)
    // Le point qui compte : bloquer le créneau dès la saisie permettrait de
    // geler un agenda entier sans jamais confirmer.
    expect(await prisma.rendezVous.count({ where: { praticienId } })).toBe(0)
  })

  it('écrit le rendez-vous en « à confirmer » une fois le code rendu', async () => {
    const debut = await demarrer()
    if (debut.etat !== 'code_envoye') throw new Error(debut.etat)

    const fin = await confirmerReservation(debut.id, dernierCode, IP)
    expect(fin.etat).toBe('confirme')

    const rdv = await prisma.rendezVous.findFirstOrThrow({
      where: { praticienId },
      select: { statut: true, fauteuilId: true, patient: { select: { profilComplet: true } } },
    })
    // Comme un rendez-vous pris au téléphone (Q26).
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)
    // Le fauteuil découle de la présence, il n'est jamais choisi (Q9).
    expect(rdv.fauteuilId).toBe(fauteuilId)
    // La date de naissance manque : la fiche se complète à la venue (Q33).
    expect(rdv.patient.profilComplet).toBe(false)
  })

  it('refuse un code faux et décompte les essais', async () => {
    const debut = await demarrer()
    if (debut.etat !== 'code_envoye') throw new Error(debut.etat)

    const r = await confirmerReservation(debut.id, '000000', IP)
    expect(r).toEqual({ etat: 'code_invalide', restantes: 2 })
    expect(await prisma.rendezVous.count({ where: { praticienId } })).toBe(0)
  })

  it('cesse d’accepter après trois essais', async () => {
    const debut = await demarrer()
    if (debut.etat !== 'code_envoye') throw new Error(debut.etat)

    for (let i = 0; i < 3; i++) await confirmerReservation(debut.id, '000000', IP)

    // Même le bon code ne passe plus : il faut recommencer.
    expect((await confirmerReservation(debut.id, dernierCode, IP)).etat).toBe('code_expire')
  })

  it('refuse un code périmé', async () => {
    const debut = await demarrer()
    if (debut.etat !== 'code_envoye') throw new Error(debut.etat)

    await prisma.reservationPublique.update({
      where: { id: debut.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    expect((await confirmerReservation(debut.id, dernierCode, IP)).etat).toBe('code_expire')
  })

  // Entre le choix et la confirmation, quelqu'un a pu prendre le créneau.
  it('dit que le créneau vient d’être pris, plutôt que d’échouer', async () => {
    const premier = await demarrer()
    if (premier.etat !== 'code_envoye') throw new Error(premier.etat)
    const codePremier = dernierCode

    const second = await demarrer()
    if (second.etat !== 'code_envoye') throw new Error(second.etat)

    // Le second confirme d'abord : il emporte le créneau.
    expect((await confirmerReservation(second.id, dernierCode, IP)).etat).toBe('confirme')
    expect((await confirmerReservation(premier.id, codePremier, IP)).etat).toBe('creneau_pris')

    expect(await prisma.rendezVous.count({ where: { praticienId } })).toBe(1)
  })

  it('refuse un créneau où le praticien n’est pas présent', async () => {
    const r = await demarrerReservation({
      motifId, praticienId, siteId, debut: jour(2, '20:00'), ...coordonnees,
    })
    expect(r.etat).toBe('creneau_indisponible')
  })

  it('refuse un acte que ce praticien ne pratique pas', async () => {
    const autre = await prisma.motifConsultation.create({
      data: { libelle: `Acte inconnu ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
      select: { id: true },
    })
    cree.motifs.push(autre.id)

    const r = await demarrerReservation({
      motifId: autre.id, praticienId, siteId, debut: jour(2, '13:00'), ...coordonnees,
    })
    expect(r.etat).toBe('acte_non_pratique')
  })

  // Trois annulations et la réservation en ligne se ferme (Q27). Le numéro
  // vérifié est ce qui permet de reconnaître la personne d'une fois sur l'autre.
  it('refuse un patient dont la réservation en ligne est bloquée', async () => {
    await prisma.patient.create({
      data: {
        nom: coordonnees.nom, prenom: coordonnees.prenom, telephone: coordonnees.telephone,
        reservationBloquee: true,
      },
    })

    const debut = await demarrer()
    if (debut.etat !== 'code_envoye') throw new Error(debut.etat)

    expect((await confirmerReservation(debut.id, dernierCode, IP)).etat).toBe('reservation_bloquee')
    expect(await prisma.rendezVous.count({ where: { praticienId } })).toBe(0)
  })

  it('laisse au journal une trace sans acteur, sans nom et sans motif', async () => {
    const debut = await demarrer()
    if (debut.etat !== 'code_envoye') throw new Error(debut.etat)
    const fin = await confirmerReservation(debut.id, dernierCode, IP)
    if (fin.etat !== 'confirme') throw new Error(fin.etat)

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'agenda', entityId: fin.rendezVousId, action: 'CREATE' },
    })

    expect(trace.actorId).toBeNull()
    expect(trace.actorEmail).toBeNull()
    expect(trace.ipAddress).toBe(IP)

    const metadata = JSON.stringify(trace.metadata)
    expect(metadata).toContain('portail public')
    expect(metadata).not.toContain(coordonnees.nom)
    expect(metadata).not.toContain(motifId)
  })
})
