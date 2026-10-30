import { CanalNotification, StatutNotification, StatutRendezVous, TypeNotification } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { instantCabinet } from '@/lib/dates'
import { prisma } from '@/server/db/client'
import { cleIdempotence, traiterLot } from '@/server/notifications/file'
import { heureRappelH3, planifierRappels } from '@/server/notifications/rappels'
import { confirmerReservation, demarrerReservation } from '@/server/services/reservation-publique'
import { definirTransporteur, type Message } from '@/server/sms/envoi'

// Ce que ces tests cherchent à prouver (D4x, lot 3), dans l'ordre du brief :
//   - `heureRappelH3` est pure et applique la règle d'avancement à 20h la
//     veille quand début − 3 h tombe dans la fenêtre de silence
//   - `planifierRappels`, rejoué deux fois sur le même rendez-vous, n'écrit
//     jamais deux lignes J-2 ni deux lignes H-3 (idempotence de `emettre`)
//   - un rendez-vous annulé après planification de ses rappels : le worker les
//     abandonne au lieu de les envoyer
//   - un rendez-vous déplacé après planification : les anciens rappels (calés
//     sur l'ancien début) sont abandonnés, `planifierRappels` en recrée de
//     nouveaux calés sur le nouveau début
//   - rien ne part entre 21h et 8h (heure du cabinet), y compris pour un
//     rappel — ce que la fenêtre de silence de `traiterLot` couvre déjà
//     génériquement, réaffirmé ici sur un rappel réel
//   - une réservation confirmée écrit une ligne CONFIRMATION_RESERVATION dans
//     la file, sans jamais appeler le transporteur de façon synchrone

const SUFFIXE = Date.now()
const IP = `198.51.100.${(SUFFIXE + 41) % 200}`

let compteurTelephones = 0
function telephone(): string {
  compteurTelephones += 1
  return `+3369${String(SUFFIXE).slice(-4)}${String(compteurTelephones).padStart(3, '0')}`
}

const appels: Message[] = []
const transporteurEssai = {
  nom: 'essai',
  async envoyer(m: Message) {
    appels.push(m)
    return { ok: true as const, reference: 'essai' }
  },
}
function appelsPour(dest: string): Message[] {
  return appels.filter((m) => m.destinataire === dest)
}

// ── Fixtures « rendez-vous posé directement » (rappels J-2/H-3) ────────────
// Ces tests ne passent pas par les Server Actions ni par les vérifications de
// créneau : ils écrivent un `RendezVous` directement, comme
// `tests/deplacement-patient.test.ts` le fait déjà. `planifierRappels` ne lit
// que l'agenda, jamais les règles de prise de rendez-vous.

let siteId: string
let praticienId: string
let fauteuilId: string
let motifId: string

const cree = { praticiens: [] as string[], fauteuils: [] as string[], motifs: [] as string[], patients: [] as string[] }

async function creerRdvDirect(debut: Date, minutes = 30) {
  const tel = telephone()
  const patient = await prisma.patient.create({
    data: { nom: `Rappel${SUFFIXE}`, prenom: 'Test', telephone: tel },
    select: { id: true },
  })
  cree.patients.push(patient.id)
  const rdv = await prisma.rendezVous.create({
    data: {
      patientId: patient.id,
      praticienId,
      siteId,
      fauteuilId,
      motifId,
      debut,
      fin: new Date(debut.getTime() + minutes * 60_000),
    },
    select: { id: true, debut: true },
  })
  return { rendezVousId: rdv.id, telephone: tel, debut: rdv.debut }
}

beforeAll(async () => {
  definirTransporteur(transporteurEssai)

  siteId = (await prisma.site.findFirstOrThrow({ select: { id: true } })).id

  const p = await prisma.praticien.create({
    data: { nom: `Rappel${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const f = await prisma.fauteuil.create({
    data: { siteId, nom: `Fauteuil rappel ${SUFFIXE}` },
    select: { id: true },
  })
  fauteuilId = f.id
  cree.fauteuils.push(f.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Acte rappel ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)
})

describe('heureRappelH3 — fonction pure (D4x)', () => {
  it('un rendez-vous à 14h donne un rappel à 11h (hors fenêtre de silence)', () => {
    const debut = instantCabinet('2026-05-04', '14:00') as Date
    expect(heureRappelH3(debut).getTime()).toBe((instantCabinet('2026-05-04', '11:00') as Date).getTime())
  })

  it('un rendez-vous à 8h avance le rappel à 20h la veille (8h − 3h = 5h, dans la fenêtre)', () => {
    const debut = instantCabinet('2026-05-04', '08:00') as Date
    expect(heureRappelH3(debut).getTime()).toBe((instantCabinet('2026-05-03', '20:00') as Date).getTime())
  })

  it('un rendez-vous à 10h30 avance aussi le rappel à 20h la veille (10h30 − 3h = 7h30)', () => {
    const debut = instantCabinet('2026-05-04', '10:30') as Date
    expect(heureRappelH3(debut).getTime()).toBe((instantCabinet('2026-05-03', '20:00') as Date).getTime())
  })

  it('un rendez-vous à 11h donne un rappel à 8h — la borne exacte de la fenêtre', () => {
    const debut = instantCabinet('2026-05-04', '11:00') as Date
    expect(heureRappelH3(debut).getTime()).toBe((instantCabinet('2026-05-04', '08:00') as Date).getTime())
  })
})

describe('planifierRappels — idempotence (D38)', () => {
  it('rejouée deux fois sur le même rendez-vous, elle n’écrit jamais deux lignes J-2 ni deux lignes H-3', async () => {
    const maintenant = instantCabinet('2026-05-10', '09:00') as Date
    const debut = instantCabinet('2026-05-12', '14:00') as Date // ~53h plus tard : dans l'horizon de 72h
    const { rendezVousId } = await creerRdvDirect(debut)

    await planifierRappels(maintenant)
    await planifierRappels(maintenant)

    const j2 = await prisma.notification.findMany({ where: { rendezVousId, type: TypeNotification.RAPPEL_J2 } })
    const h3 = await prisma.notification.findMany({ where: { rendezVousId, type: TypeNotification.RAPPEL_H3 } })
    expect(j2).toHaveLength(1)
    expect(h3).toHaveLength(1)
    expect(j2[0]?.planifiePour.getTime()).toBe(debut.getTime() - 48 * 3_600_000)
    expect(h3[0]?.planifiePour.getTime()).toBe((instantCabinet('2026-05-12', '11:00') as Date).getTime())
  })
})

describe('rappel abandonné après annulation', () => {
  it('un rendez-vous annulé après planification de ses rappels : le worker les abandonne, sans jamais appeler le transporteur', async () => {
    const maintenant = instantCabinet('2026-05-15', '09:00') as Date
    const debut = instantCabinet('2026-05-17', '14:00') as Date
    const { rendezVousId, telephone: tel } = await creerRdvDirect(debut)

    await planifierRappels(maintenant)

    await prisma.rendezVous.update({ where: { id: rendezVousId }, data: { statut: StatutRendezVous.ANNULE } })

    // Passage du worker à l'heure du rappel H-3 (dans la fenêtre d'envoi) :
    // ramasse aussi le J-2, dû bien avant.
    await traiterLot(instantCabinet('2026-05-17', '11:00') as Date)

    const lignes = await prisma.notification.findMany({ where: { rendezVousId } })
    expect(lignes.length).toBeGreaterThanOrEqual(2)
    for (const ligne of lignes) {
      expect(ligne.statut).toBe(StatutNotification.ABANDONNEE)
      expect(ligne.derniereErreur).toBe('rendez_vous_annule')
    }
    expect(appelsPour(tel)).toHaveLength(0)
  })
})

describe('rappel abandonné après déplacement', () => {
  it('les rappels calés sur l’ancien début sont abandonnés ; planifierRappels en recrée sur le nouveau début', async () => {
    const maintenant = instantCabinet('2026-05-20', '09:00') as Date
    const debutA = instantCabinet('2026-05-22', '14:00') as Date
    const { rendezVousId, telephone: tel } = await creerRdvDirect(debutA)

    await planifierRappels(maintenant)

    const cleH3AncienDebut = cleIdempotence([TypeNotification.RAPPEL_H3, rendezVousId, debutA, tel, CanalNotification.SMS])
    const h3Ancien = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cleH3AncienDebut } })
    expect(h3Ancien.statut).toBe(StatutNotification.A_ENVOYER)

    // Déplacement (D28) : même id, nouveau début — écrit directement, comme le
    // ferait `deplacerParPatient` en base. Choisi pour rester, comme l'ancien
    // début, dans l'horizon de 72h de `planifierRappels` à partir de `maintenant`.
    const debutB = instantCabinet('2026-05-22', '20:00') as Date
    await prisma.rendezVous.update({
      where: { id: rendezVousId },
      data: { debut: debutB, fin: new Date(debutB.getTime() + 30 * 60_000) },
    })

    // Le worker replanifie sur le nouveau début — nouvelle clé, nouvelles lignes.
    await planifierRappels(maintenant)

    const h3Total = await prisma.notification.findMany({ where: { rendezVousId, type: TypeNotification.RAPPEL_H3 } })
    expect(h3Total).toHaveLength(2)
    const surNouveauDebut = h3Total.find((l) => l.rendezVousDebut?.getTime() === debutB.getTime())
    expect(surNouveauDebut).toBeTruthy()

    // Passage du worker à l'heure où l'ANCIEN rappel H-3 était dû : le
    // vérificateur voit que le rendez-vous ne commence plus à cette heure-là,
    // et l'abandonne — sans toucher au nouveau, pas encore dû.
    await traiterLot(instantCabinet('2026-05-22', '11:00') as Date)

    const ancienRelu = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cleH3AncienDebut } })
    expect(ancienRelu.statut).toBe(StatutNotification.ABANDONNEE)
    expect(ancienRelu.derniereErreur).toBe('rendez_vous_deplace')
  })
})

describe('rappel — fenêtre de silence 21h-8h (D29, America/Guadeloupe)', () => {
  it('un rappel dû à 22h n’est pas envoyé à 22h ; il part au prochain passage après 8h', async () => {
    // Choisi pour que le J-2 (début − 48h, même heure locale) tombe à 22h —
    // le H-3, lui, ne peut structurellement jamais tomber dans la fenêtre
    // (voir heureRappelH3), donc c'est le J-2 qui porte ce test.
    // debut choisi à moins de 72h de `maintenant` (l'horizon de
    // `planifierRappels`), avec la même heure locale que le J-2 attendu (22h) :
    // début − 48h tombe alors le jour même de `maintenant`, à 22h.
    const maintenant = instantCabinet('2026-05-24', '09:00') as Date
    const debut = instantCabinet('2026-05-26', '22:00') as Date
    const { rendezVousId, telephone: tel } = await creerRdvDirect(debut)

    await planifierRappels(maintenant)

    const a22h = instantCabinet('2026-05-24', '22:00') as Date
    await traiterLot(a22h)
    expect(appelsPour(tel)).toHaveLength(0)
    const avant = await prisma.notification.findFirstOrThrow({ where: { rendezVousId, type: TypeNotification.RAPPEL_J2 } })
    expect(avant.statut).toBe(StatutNotification.A_ENVOYER)

    const a8h01 = instantCabinet('2026-05-25', '08:01') as Date
    await traiterLot(a8h01)
    expect(appelsPour(tel)).toHaveLength(1)
    const apres = await prisma.notification.findFirstOrThrow({ where: { rendezVousId, type: TypeNotification.RAPPEL_J2 } })
    expect(apres.statut).toBe(StatutNotification.ENVOYEE)
  })
})

// ── Fixture « réservation publique » (D12) — praticien dédié avec présence ──
// La confirmation de réservation, elle, passe par le vrai parcours public :
// il faut un créneau réellement disponible (plage de présence + motif
// pratiqué), donc des dates relatives à aujourd'hui, comme
// tests/reservation-publique.test.ts.

let praticienResaId: string
let fauteuilResaId: string
let motifResaId: string
const creeResa = { praticiens: [] as string[], fauteuils: [] as string[], motifs: [] as string[], plages: [] as string[] }

const jourDans = (jours: number, heure: string) => {
  const j = new Date(Date.now() + jours * 86_400_000)
  return new Date(`${j.toISOString().slice(0, 10)}T${heure}:00.000Z`)
}

beforeAll(async () => {
  const p = await prisma.praticien.create({
    data: { nom: `RappelResa${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienResaId = p.id
  creeResa.praticiens.push(p.id)

  const f = await prisma.fauteuil.create({
    data: { siteId, nom: `Fauteuil rappel resa ${SUFFIXE}` },
    select: { id: true },
  })
  fauteuilResaId = f.id
  creeResa.fauteuils.push(f.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Acte rappel resa ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifResaId = m.id
  creeResa.motifs.push(m.id)

  await prisma.praticienMotif.create({ data: { praticienId: praticienResaId, motifId: motifResaId, dureeMinutes: 30 } })

  const plage = await prisma.plageDePresence.create({
    data: {
      praticienId: praticienResaId,
      siteId,
      fauteuilId: fauteuilResaId,
      debut: jourDans(2, '12:00'),
      fin: jourDans(2, '16:00'),
    },
    select: { id: true },
  })
  creeResa.plages.push(plage.id)
})

// Un seul `afterAll`, à la toute fin du fichier : deux `afterAll` séparés ne
// garantissent pas d'ordre d'exécution relatif l'un à l'autre, et le premier
// aurait pu couper la connexion Prisma avant que le second nettoie ses propres
// tables.
afterAll(async () => {
  const prefixeRappel = `+3369${String(SUFFIXE).slice(-4)}`
  const prefixeResa = `+3368${String(SUFFIXE).slice(-4)}`
  await prisma.notification.deleteMany({ where: { destinataire: { startsWith: prefixeRappel } } })
  await prisma.notification.deleteMany({ where: { destinataire: { startsWith: prefixeResa } } })

  await prisma.reservationPublique.deleteMany({ where: { praticienId } })
  await prisma.rendezVous.deleteMany({ where: { praticienId } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })

  await prisma.reservationPublique.deleteMany({ where: { praticienId: praticienResaId } })
  await prisma.rendezVous.deleteMany({ where: { praticienId: praticienResaId } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: creeResa.plages } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: creeResa.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: creeResa.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: creeResa.fauteuils } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: creeResa.motifs } } })

  await prisma.$disconnect()
})

describe('confirmation de réservation — file de notifications (D37)', () => {
  it('crée une ligne CONFIRMATION_RESERVATION sans jamais appeler le transporteur de façon synchrone', async () => {
    const tel = `+3368${String(SUFFIXE).slice(-4)}${String(compteurTelephones + 1).padStart(3, '0')}`
    compteurTelephones += 1

    const debut = await demarrerReservation({
      motifId: motifResaId,
      praticienId: praticienResaId,
      siteId,
      debut: jourDans(2, '13:00'),
      nom: `RappelResa${SUFFIXE}`,
      prenom: 'Patient',
      telephone: tel,
      ipAddress: IP,
    })
    expect(debut.etat).toBe('code_envoye')
    if (debut.etat !== 'code_envoye') return

    // Un seul appel synchrone à ce stade : le code de confirmation, qui reste
    // hors file (D23/2FA — non concerné par ce lot).
    expect(appelsPour(tel)).toHaveLength(1)
    const code = /(\d{6})/.exec(appelsPour(tel)[0]?.texte ?? '')?.[1] ?? ''

    const fin = await confirmerReservation(debut.id, code, IP)
    expect(fin.etat).toBe('confirme')
    if (fin.etat !== 'confirme') return

    // Toujours un seul appel : la confirmation n'a PAS appelé le transporteur
    // de façon synchrone, elle a seulement écrit une ligne dans la file.
    expect(appelsPour(tel)).toHaveLength(1)

    const notif = await prisma.notification.findFirstOrThrow({
      where: { rendezVousId: fin.rendezVousId, type: TypeNotification.CONFIRMATION_RESERVATION },
    })
    expect(notif.canal).toBe(CanalNotification.SMS)
    expect(notif.destinataire).toBe(tel)
    expect(notif.statut).toBe(StatutNotification.A_ENVOYER)
    expect(notif.texte).not.toMatch(/acte rappel resa/i) // minimisation : pas de motif dans le texte
  })
})
