import { StatutRendezVous } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@/server/db/client'
import {
  annulerParPatient,
  demanderAcces,
  historiqueDuPatient,
  purgerAccesExpires,
  rendezVousDuPatient,
  verifierAcces,
} from '@/server/services/acces-patient'
import { definirTransporteur, type Message } from '@/server/sms/envoi'
import { demanderAccesSchema } from '@/server/validation/acces-patient'

// Ce que ces tests cherchent à prouver, dans l'ordre de ce qui coûterait cher :
//   - un numéro inconnu et un numéro connu donnent EXACTEMENT la même réponse,
//     sans quoi on peut découvrir qui est patient du cabinet
//   - le jeton de Madame Dupont n'annule pas le rendez-vous de quelqu'un d'autre
//   - les 24 h de Q28 sont revérifiées côté serveur, pas seulement à l'écran
//   - l'annulation par le patient coûte un manquement, celle du cabinet non

const SUFFIXE = Date.now()
const IP = `198.51.100.${SUFFIXE % 200}`

const TEL_CONNU = `+3361111${String(SUFFIXE).slice(-4)}`
const TEL_AUTRE = `+3362222${String(SUFFIXE).slice(-4)}`
const TEL_INCONNU = `+3369999${String(SUFFIXE).slice(-4)}`

let siteId: string
let praticienId: string
let fauteuilId: string
let motifId: string
const cree = { praticiens: [] as string[], fauteuils: [] as string[], motifs: [] as string[], plages: [] as string[] }

let dernierCode = ''
let smsEnvoyes = 0
const transporteurEssai = {
  nom: 'essai',
  async envoyer(m: Message) {
    dernierCode = /(\d{6})/.exec(m.texte)?.[1] ?? ''
    smsEnvoyes += 1
    return { ok: true as const, reference: 'essai' }
  },
}

const jour = (d: number, heure: string) => {
  const j = new Date(Date.now() + d * 86_400_000)
  return new Date(`${j.toISOString().slice(0, 10)}T${heure}:00.000Z`)
}

async function patientAvecRdv(telephone: string, dansNJours: number, heure: string) {
  const patient = await prisma.patient.create({
    data: { nom: `Acces${SUFFIXE}`, prenom: 'Test', telephone },
    select: { id: true },
  })
  const debut = jour(dansNJours, heure)
  const rdv = await prisma.rendezVous.create({
    data: {
      patientId: patient.id,
      praticienId,
      siteId,
      fauteuilId,
      motifId,
      debut,
      fin: new Date(debut.getTime() + 30 * 60_000),
    },
    select: { id: true },
  })
  return { patientId: patient.id, rendezVousId: rdv.id }
}

/** Ouvre une fenêtre et rend le jeton, comme le ferait le parcours complet. */
async function ouvrirFenetre(telephone: string) {
  const demande = await demanderAcces(telephone, IP)
  if (demande.etat !== 'code_envoye') throw new Error(demande.etat)
  const verif = await verifierAcces(telephone, dernierCode)
  if (verif.etat !== 'ouvert') throw new Error(verif.etat)
  return verif.jeton
}

beforeAll(async () => {
  definirTransporteur(transporteurEssai)

  siteId = (await prisma.site.findFirstOrThrow({ select: { id: true } })).id

  const p = await prisma.praticien.create({
    data: { nom: `Acces${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const f = await prisma.fauteuil.create({
    data: { siteId, nom: `Fauteuil acces ${SUFFIXE}` },
    select: { id: true },
  })
  fauteuilId = f.id
  cree.fauteuils.push(f.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Acte acces ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)

  await prisma.praticienMotif.create({ data: { praticienId, motifId, dureeMinutes: 30 } })

  const plage = await prisma.plageDePresence.create({
    data: { praticienId, siteId, fauteuilId, debut: jour(5, '08:00'), fin: jour(5, '20:00') },
    select: { id: true },
  })
  cree.plages.push(plage.id)
})

const TELS = [TEL_CONNU, TEL_AUTRE, TEL_INCONNU]

beforeEach(async () => {
  smsEnvoyes = 0
  await prisma.accesPatient.deleteMany({ where: { telephone: { in: TELS } } })
  // Doit précéder la suppression des rendez-vous : `Notification.rendezVous`
  // est `onDelete: Restrict` (phase 4, lot 3, D37) — un rendez-vous annulé par
  // le patient a désormais émis une ligne de notification (ANNULATION_PATIENT).
  await prisma.notification.deleteMany({ where: { destinataire: { in: TELS } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId } })
  await prisma.patient.deleteMany({ where: { telephone: { in: TELS } } })
})

afterAll(async () => {
  await prisma.accesPatient.deleteMany({ where: { telephone: { in: TELS } } })
  await prisma.notification.deleteMany({ where: { destinataire: { in: TELS } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId } })
  await prisma.patient.deleteMany({ where: { telephone: { in: TELS } } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: cree.plages } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  await prisma.$disconnect()
})

describe('demande d’accès', () => {
  it('ne laisse pas deviner qui est patient du cabinet', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')

    const connu = await demanderAcces(TEL_CONNU, IP)
    const inconnu = await demanderAcces(TEL_INCONNU, IP)

    // Même état, et un masque calculé sur le numéro saisi dans les deux cas :
    // rien dans la réponse ne distingue un patient d'un inconnu.
    expect(connu.etat).toBe('code_envoye')
    expect(inconnu.etat).toBe('code_envoye')
    if (connu.etat !== 'code_envoye' || inconnu.etat !== 'code_envoye') return
    expect(connu.masque).toHaveLength(inconnu.masque.length)
  })

  it('n’envoie AUCUN SMS à un numéro inconnu', async () => {
    await demanderAcces(TEL_INCONNU, IP)
    // Le cabinet ne paie pas pour les numéros qu'un robot essaie au hasard.
    expect(smsEnvoyes).toBe(0)
  })

  it('refuse au-delà de cinq demandes par heure depuis la même adresse', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')
    for (let i = 0; i < 5; i += 1) await demanderAcces(TEL_CONNU, IP)

    expect((await demanderAcces(TEL_CONNU, IP)).etat).toBe('trop_de_tentatives')
  })
})

describe('vérification du code', () => {
  it('compte les essais et finit par fermer', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')
    await demanderAcces(TEL_CONNU, IP)

    const premier = await verifierAcces(TEL_CONNU, '000000')
    expect(premier.etat).toBe('code_invalide')

    await verifierAcces(TEL_CONNU, '000000')
    await verifierAcces(TEL_CONNU, '000000')

    // Quatrième essai : la ligne est brûlée, même avec le bon code.
    expect((await verifierAcces(TEL_CONNU, dernierCode)).etat).toBe('code_expire')
  })

  it('ouvre une fenêtre avec le bon code', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')
    await demanderAcces(TEL_CONNU, IP)

    const verif = await verifierAcces(TEL_CONNU, dernierCode)
    expect(verif.etat).toBe('ouvert')
    if (verif.etat !== 'ouvert') return
    expect(verif.jeton.length).toBeGreaterThan(20)
  })
})

describe('rendez-vous du patient', () => {
  it('montre les siens, et seulement les siens', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')
    await patientAvecRdv(TEL_AUTRE, 5, '11:00')

    const jeton = await ouvrirFenetre(TEL_CONNU)
    const rdvs = await rendezVousDuPatient(jeton, new Date())

    expect(rdvs).toHaveLength(1)
    expect(rdvs?.[0]?.debut.toISOString()).toBe(jour(5, '10:00').toISOString())
  })

  it('dit lesquels sont encore annulables (Q28)', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const jeton = await ouvrirFenetre(TEL_CONNU)

    const large = await rendezVousDuPatient(jeton, new Date())
    expect(large?.[0]?.annulable).toBe(true)

    // Vu depuis la veille au soir, le même rendez-vous ne l'est plus.
    const tardif = await rendezVousDuPatient(jeton, new Date(jour(5, '10:00').getTime() - 3_600_000))
    expect(tardif?.[0]?.annulable).toBe(false)
  })

  it('ne rend rien sans fenêtre valide', async () => {
    expect(await rendezVousDuPatient('jeton-inventé', new Date())).toBeNull()
  })
})

describe('annulation par le patient', () => {
  it('annule, libère le créneau et compte un manquement', async () => {
    const { patientId, rendezVousId } = await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const jeton = await ouvrirFenetre(TEL_CONNU)

    expect((await annulerParPatient(jeton, rendezVousId, IP, new Date())).etat).toBe('annule')

    const rdv = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rendezVousId },
      select: { statut: true, manquementCompte: true },
    })
    expect(rdv.statut).toBe(StatutRendezVous.ANNULE)
    expect(rdv.manquementCompte).toBe(true)

    const patient = await prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { manquements: true },
    })
    // C'est ici que l'autre moitié de Q27 entre en jeu : le patient qui annule
    // lui-même s'en approche du blocage, celui qu'on annule non.
    expect(patient.manquements).toBe(1)
  })

  it('refuse à moins de 24 heures, même si l’écran proposait le bouton', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const jeton = await ouvrirFenetre(TEL_CONNU)

    const veille = new Date(jour(5, '10:00').getTime() - 3_600_000)
    expect((await annulerParPatient(jeton, rendezVousId, IP, veille)).etat).toBe('trop_tard')

    const rdv = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rendezVousId },
      select: { statut: true },
    })
    expect(rdv.statut).not.toBe(StatutRendezVous.ANNULE)
  })

  it('n’annule pas le rendez-vous de quelqu’un d’autre', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const autre = await patientAvecRdv(TEL_AUTRE, 5, '11:00')

    const jeton = await ouvrirFenetre(TEL_CONNU)
    const resultat = await annulerParPatient(jeton, autre.rendezVousId, IP, new Date())

    // « introuvable » et non « interdit » : la réponse ne confirme pas que ce
    // rendez-vous existe.
    expect(resultat.etat).toBe('introuvable')

    const rdv = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: autre.rendezVousId },
      select: { statut: true },
    })
    expect(rdv.statut).not.toBe(StatutRendezVous.ANNULE)
  })

  it('refuse une fenêtre expirée', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const jeton = await ouvrirFenetre(TEL_CONNU)

    await prisma.accesPatient.updateMany({
      where: { telephone: TEL_CONNU },
      data: { fenetreExpire: new Date(Date.now() - 1000) },
    })

    expect((await annulerParPatient(jeton, rendezVousId, IP, new Date())).etat).toBe(
      'fenetre_expiree',
    )
  })

  it('laisse une trace au journal, sans nommer personne', async () => {
    const { rendezVousId } = await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const jeton = await ouvrirFenetre(TEL_CONNU)
    await annulerParPatient(jeton, rendezVousId, IP, new Date())

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: rendezVousId, action: 'UPDATE' },
      orderBy: { occurredAt: 'desc' },
      select: { actorId: true, metadata: true },
    })
    expect(trace.actorId).toBeNull()
    expect(trace.metadata).toMatchObject({ origine: 'portail public', annulePar: 'patient' })
    expect(JSON.stringify(trace.metadata)).not.toContain(TEL_CONNU)
  })
})

describe('purge', () => {
  it('efface les accès périmés et garde les fenêtres ouvertes', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const jeton = await ouvrirFenetre(TEL_CONNU)

    await demanderAcces(TEL_AUTRE, IP)
    await prisma.accesPatient.updateMany({
      where: { telephone: TEL_AUTRE },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    expect(await purgerAccesExpires(new Date())).toBeGreaterThanOrEqual(1)
    // La fenêtre encore ouverte survit : la purger déconnecterait le patient en
    // pleine annulation.
    expect(await rendezVousDuPatient(jeton, new Date())).not.toBeNull()
  })
})

describe('espace patient (19/10)', () => {
  it('retrouve la fiche quand le numéro est tapé à la française', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const national = `0${TEL_CONNU.slice(3, 4)} ${TEL_CONNU.slice(4)}`
    const { telephone } = demanderAccesSchema.parse({ telephone: national })

    expect(telephone).toBe(TEL_CONNU)
    await demanderAcces(telephone, IP)
    expect(smsEnvoyes).toBe(1)
  })

  it('la fenêtre se prolonge à chaque geste, mais ne se rouvre pas une fois fermée', async () => {
    await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const jeton = await ouvrirFenetre(TEL_CONNU)

    await prisma.accesPatient.updateMany({
      where: { telephone: TEL_CONNU, jetonHash: { not: null } },
      data: { fenetreExpire: new Date(Date.now() + 60_000) },
    })
    expect(await rendezVousDuPatient(jeton, new Date())).not.toBeNull()
    const prolongee = await prisma.accesPatient.findFirstOrThrow({
      where: { telephone: TEL_CONNU, jetonHash: { not: null } },
      select: { fenetreExpire: true },
    })
    expect(prolongee.fenetreExpire!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000)

    await prisma.accesPatient.updateMany({
      where: { telephone: TEL_CONNU, jetonHash: { not: null } },
      data: { fenetreExpire: new Date(Date.now() - 1000) },
    })
    expect(await rendezVousDuPatient(jeton, new Date())).toBeNull()
    expect(await historiqueDuPatient(jeton, new Date())).toBeNull()
  })

  it('montre les rendez-vous passés à part, jamais parmi ceux à venir', async () => {
    const aVenir = await patientAvecRdv(TEL_CONNU, 5, '10:00')
    const passe = await prisma.rendezVous.create({
      data: {
        patientId: aVenir.patientId,
        praticienId,
        siteId,
        fauteuilId,
        motifId,
        debut: jour(-3, '10:00'),
        fin: jour(-3, '10:30'),
        statut: StatutRendezVous.TERMINE,
      },
      select: { id: true },
    })
    const jeton = await ouvrirFenetre(TEL_CONNU)

    const historique = await historiqueDuPatient(jeton, new Date())
    expect(historique?.map((r) => r.id)).toEqual([passe.id])
    expect(historique?.[0]?.statut).toBe(StatutRendezVous.TERMINE)
    expect((await rendezVousDuPatient(jeton, new Date()))?.map((r) => r.id)).toEqual([aVenir.rendezVousId])
  })
})
