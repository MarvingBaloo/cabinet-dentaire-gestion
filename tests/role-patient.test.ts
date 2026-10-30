import { StatutRendezVous, TypeNotification } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@/server/db/client'
import { creneauxDisponibles } from '@/server/queries/public/creneaux'
import {
  annulerParPatient,
  creneauxPourDeplacement,
  demanderAcces,
  deplacerParPatient,
  fermerFenetre,
  historiqueDuPatient,
  rendezVousDuPatient,
  verifierAcces,
} from '@/server/services/acces-patient'
import {
  desinscrireListeAttente,
  inscriptionsDuPatient,
  inscrireListeAttente,
} from '@/server/services/inscription-liste-attente'
import { enregistrerPreferences, preferencesDuPatient } from '@/server/services/preferences-notifications'
import { confirmerReservation, demarrerReservation } from '@/server/services/reservation-publique'
import { definirTransporteur, type Message } from '@/server/sms/envoi'

// La batterie du rôle PATIENT (21/10/2026). Le patient n'a pas de compte : son numéro et le code reçu par SMS
// le reconnaissent (D23). Ce fichier le suit de la réservation en ligne à l'annulation, et vérifie ce qui doit
// lui rester fermé : savoir qui est patient, voir ou toucher le rendez-vous d'un autre, deviner un code.
// Les règles de détail ont leurs suites (acces-patient, reservation-publique, deplacement-patient,
// liste-attente, preferences-notifications) ; celle-ci répond « avec SON numéro, qu'est-ce qui marche ? ».

const SUFFIXE = Date.now()
const fin4 = String(SUFFIXE).slice(-4)
const TEL_DUPONT = `+3361200${fin4}`
const TEL_VOISINE = `+3361300${fin4}`
const TEL_INCONNU = `+3361400${fin4}`
const TEL_BLOQUE = `+3361500${fin4}`
const TEL_FAMILLE = `+3361700${fin4}`
const TELS = [TEL_DUPONT, TEL_VOISINE, TEL_INCONNU, TEL_BLOQUE, TEL_FAMILLE]

let ip = 0
/** Une adresse par geste : la limite de cinq demandes par heure n'est pas l'objet de ces tests. */
const nouvelleIp = () => `203.0.113.${(SUFFIXE + ip++) % 250}`

let siteId: string
let praticienId: string
let fauteuilId: string
let motifId: string
const cree = { plages: [] as string[] }

const codes = new Map<string, string>()
const envoyes: Message[] = []
definirTransporteur({
  nom: 'essai',
  async envoyer(m: Message) {
    envoyes.push(m)
    const code = /(\d{6})/.exec(m.texte)?.[1]
    if (code) codes.set(m.destinataire, code)
    return { ok: true as const, reference: 'essai' }
  },
})

/** Un instant à « dans n jours, hh:mm » en UTC, posé dans la présence du praticien. */
const jour = (n: number, heure: string) => {
  const j = new Date(Date.now() + n * 86_400_000)
  return new Date(`${j.toISOString().slice(0, 10)}T${heure}:00.000Z`)
}

async function ouvrirEspace(telephone: string) {
  const demande = await demanderAcces(telephone, nouvelleIp())
  if (demande.etat !== 'code_envoye') throw new Error(demande.etat)
  const verif = await verifierAcces(telephone, codes.get(telephone) ?? '')
  if (verif.etat !== 'ouvert') throw new Error(verif.etat)
  return verif.jeton
}

async function rdvDirect(telephone: string, debut: Date, options: { bloque?: boolean } = {}) {
  const patient =
    (await prisma.patient.findFirst({ where: { telephone } })) ??
    (await prisma.patient.create({
      data: {
        nom: `Patient${SUFFIXE}`,
        prenom: 'Test',
        telephone,
        ...(options.bloque ? { manquements: 3, reservationBloquee: true } : {}),
      },
    }))
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
  return rdv.id
}

beforeAll(async () => {
  siteId = (await prisma.site.findFirstOrThrow({ where: { code: 'MARIE_GALANTE' }, select: { id: true } })).id
  praticienId = (
    await prisma.praticien.create({
      data: { nom: `Patient${SUFFIXE}`, prenom: 'Dr', couleur: '#0078cc' },
      select: { id: true },
    })
  ).id
  fauteuilId = (
    await prisma.fauteuil.create({ data: { siteId, nom: `Fauteuil patient ${SUFFIXE}` }, select: { id: true } })
  ).id
  motifId = (
    await prisma.motifConsultation.create({
      data: { libelle: `Détartrage patient ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc', ordre: 9200 },
      select: { id: true },
    })
  ).id
  await prisma.praticienMotif.create({ data: { praticienId, motifId, dureeMinutes: 30 } })
  // Le praticien reçoit demain, et de J+3 à J+12, de 12h à 21h UTC (8h-17h en Guadeloupe).
  for (const n of [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const plage = await prisma.plageDePresence.create({
      data: { praticienId, siteId, fauteuilId, debut: jour(n, '12:00'), fin: jour(n, '21:00') },
      select: { id: true },
    })
    cree.plages.push(plage.id)
  }
})

beforeEach(async () => {
  envoyes.length = 0
  codes.clear()
  await prisma.accesPatient.deleteMany({ where: { telephone: { in: TELS } } })
})

afterAll(async () => {
  await prisma.inscriptionListeAttente.deleteMany({ where: { telephone: { in: TELS } } })
  await prisma.preferenceNotification.deleteMany({ where: { destinataire: { in: TELS } } })
  await prisma.notification.deleteMany({
    where: { OR: [{ destinataire: { in: TELS } }, { rendezVous: { praticienId } }] },
  })
  await prisma.reservationPublique.deleteMany({ where: { praticienId } })
  await prisma.rendezVous.deleteMany({ where: { praticienId } })
  await prisma.accesPatient.deleteMany({ where: { telephone: { in: TELS } } })
  await prisma.patient.deleteMany({ where: { telephone: { in: TELS } } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: cree.plages } } })
  await prisma.fauteuil.deleteMany({ where: { id: fauteuilId } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId } })
  await prisma.praticien.deleteMany({ where: { id: praticienId } })
  await prisma.motifConsultation.deleteMany({ where: { id: motifId } })
})

// ─── 1. Le parcours ─────────────────────────────────────────────────────────

describe('1. Madame Dupont réserve en ligne, retrouve son rendez-vous, le déplace, puis l’annule', () => {
  let rdvId: string

  it('réserve : un code part par SMS, rien n’est écrit dans l’agenda avant qu’elle le saisisse', async () => {
    const avant = await prisma.rendezVous.count({ where: { praticienId } })
    const d = await demarrerReservation({
      motifId,
      praticienId,
      siteId,
      debut: jour(5, '13:00'),
      nom: `Dupont${SUFFIXE}`,
      prenom: 'Marie',
      telephone: TEL_DUPONT,
      ipAddress: nouvelleIp(),
    })
    expect(d.etat).toBe('code_envoye')
    expect(envoyes.map((m) => m.destinataire)).toEqual([TEL_DUPONT])
    expect(await prisma.rendezVous.count({ where: { praticienId } })).toBe(avant)

    const f = await confirmerReservation((d as { id: string }).id, codes.get(TEL_DUPONT)!, nouvelleIp())
    expect(f.etat).toBe('confirme')
    rdvId = (f as { rendezVousId: string }).rendezVousId
    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdvId }, include: { patient: true } })
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)
    expect(rdv.patient).toMatchObject({ prenom: 'Marie', telephone: TEL_DUPONT, profilComplet: false })
    expect(
      await prisma.notification.count({
        where: { rendezVousId: rdvId, type: TypeNotification.CONFIRMATION_RESERVATION },
      }),
    ).toBe(1)
  })

  it('le même code ne confirme pas une seconde fois', async () => {
    const reservation = await prisma.reservationPublique.findFirstOrThrow({ where: { rendezVousId: rdvId } })
    // Le code n'est plus connu en clair : un code quelconque suffit, la réservation est close.
    expect((await confirmerReservation(reservation.id, '000000', nouvelleIp())).etat).toBe('code_expire')
    expect(await prisma.rendezVous.count({ where: { patient: { telephone: TEL_DUPONT } } })).toBe(1)
  })

  it('« Mes rendez-vous » : son numéro et le code ouvrent l’espace, où elle voit son rendez-vous', async () => {
    const jeton = await ouvrirEspace(TEL_DUPONT)
    const liste = await rendezVousDuPatient(jeton, new Date())
    expect(liste).toEqual([expect.objectContaining({ id: rdvId, annulable: true, deplacable: true })])
  })

  it('le code d’accès ne sert qu’une fois', async () => {
    await demanderAcces(TEL_DUPONT, nouvelleIp())
    const code = codes.get(TEL_DUPONT)!
    expect((await verifierAcces(TEL_DUPONT, code)).etat).toBe('ouvert')
    expect((await verifierAcces(TEL_DUPONT, code)).etat).toBe('code_expire')
  })

  it('déplace : même acte, même cabinet, sans absence comptée, le statut ne change pas', async () => {
    const jeton = await ouvrirEspace(TEL_DUPONT)
    const proposes = await creneauxPourDeplacement(jeton, rdvId, new Date())
    expect(proposes!.length).toBeGreaterThan(0)
    expect(proposes!.every((c) => c.siteId === siteId)).toBe(true)
    // À plus de 48 h : l'annulation qui suit doit rester ouverte (Q28).
    const cible = proposes!.find(
      (c) => c.debut.getTime() > Date.now() + 48 * 3_600_000 && c.debut.getTime() !== jour(5, '13:00').getTime(),
    )!
    const r = await deplacerParPatient(jeton, rdvId, cible.debut, cible.praticienId, nouvelleIp(), new Date())
    expect(r.etat).toBe('deplace')
    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdvId }, include: { patient: true } })
    expect(rdv.debut.getTime()).toBe(cible.debut.getTime())
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)
    expect(rdv.patient.manquements).toBe(0)
    expect(
      await prisma.notification.count({
        where: { rendezVousId: rdvId, type: TypeNotification.MODIFICATION_RENDEZ_VOUS },
      }),
    ).toBe(1)
  })

  it('annule à plus de 24 h : le rendez-vous est annulé, une absence comptée (Q27), un SMS prévu', async () => {
    const jeton = await ouvrirEspace(TEL_DUPONT)
    const r = await annulerParPatient(jeton, rdvId, nouvelleIp(), new Date())
    expect(r.etat).toBe('annule')
    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdvId }, include: { patient: true } })
    expect(rdv.statut).toBe(StatutRendezVous.ANNULE)
    expect(rdv.patient.manquements).toBe(1)
    expect(
      await prisma.notification.count({ where: { rendezVousId: rdvId, type: TypeNotification.ANNULATION_PATIENT } }),
    ).toBe(1)
    expect(await rendezVousDuPatient(jeton, new Date())).toEqual([])
  })

  it('le journal garde la trace de chaque geste, sans nom ni numéro', async () => {
    // Sans les lectures : un écran du cabinet ouvert pendant ce temps note légitimement qu'il a vu passer le
    // rendez-vous (agenda en direct, D61). Ce test ne regarde que les gestes du patient.
    const traces = await prisma.auditLog.findMany({
      where: { entityId: rdvId, action: { not: 'READ' } },
      orderBy: { id: 'asc' },
    })
    expect(traces.map((t) => t.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE'])
    for (const t of traces) {
      expect(t.actorId).toBeNull()
      expect(JSON.stringify(t.metadata)).not.toContain('Dupont')
      expect(JSON.stringify(t.metadata)).not.toContain(TEL_DUPONT.slice(3))
    }
  })
})

// ─── 2. Ce qui ne doit pas fuir ─────────────────────────────────────────────

describe('2. Une voisine qui connaît le numéro de Madame Dupont n’apprend rien', () => {
  let rdvDupont: string

  beforeAll(async () => {
    rdvDupont = await rdvDirect(TEL_DUPONT, jour(7, '14:00'))
  })

  it('demander un code pour un numéro patient ou inconnu donne exactement la même réponse, et aucun SMS vers l’inconnu', async () => {
    const connu = await demanderAcces(TEL_DUPONT, nouvelleIp())
    const inconnu = await demanderAcces(TEL_INCONNU, nouvelleIp())
    expect(Object.keys(connu).sort()).toEqual(Object.keys(inconnu).sort())
    expect(connu.etat).toBe(inconnu.etat)
    expect(envoyes.map((m) => m.destinataire)).toEqual([TEL_DUPONT])
  })

  it('avec son propre espace, la voisine ne voit, ne déplace ni n’annule le rendez-vous de Madame Dupont', async () => {
    await rdvDirect(TEL_VOISINE, jour(8, '14:00'))
    const jeton = await ouvrirEspace(TEL_VOISINE)
    expect((await rendezVousDuPatient(jeton, new Date()))!.map((r) => r.id)).not.toContain(rdvDupont)
    expect(await creneauxPourDeplacement(jeton, rdvDupont, new Date())).toBeNull()
    expect(
      (await deplacerParPatient(jeton, rdvDupont, jour(9, '14:00'), praticienId, nouvelleIp(), new Date())).etat,
    ).toBe('introuvable')
    expect((await annulerParPatient(jeton, rdvDupont, nouvelleIp(), new Date())).etat).toBe('introuvable')
    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdvDupont } })
    expect(rdv).toMatchObject({ statut: StatutRendezVous.A_CONFIRMER, debut: jour(7, '14:00') })
  })

  it('le site ne dit pas qui vient : un créneau pris disparaît, et un créneau proposé ne porte que l’heure et le praticien', async () => {
    const proposes = await creneauxDisponibles({ motifId, siteId, debut: jour(7, '00:00'), fin: jour(8, '00:00') })
    expect(proposes.some((c) => c.debut.getTime() === jour(7, '14:00').getTime())).toBe(false)
    for (const c of proposes) expect(Object.keys(c).sort()).toEqual(['debut', 'fin', 'praticienId', 'siteId'])
  })

  it('un mauvais code laisse trois essais, puis l’accès se ferme même avec le bon', async () => {
    await demanderAcces(TEL_DUPONT, nouvelleIp())
    const bon = codes.get(TEL_DUPONT)!
    const faux = bon === '000000' ? '111111' : '000000'
    expect(await verifierAcces(TEL_DUPONT, faux)).toEqual({ etat: 'code_invalide', restantes: 2 })
    expect(await verifierAcces(TEL_DUPONT, faux)).toEqual({ etat: 'code_invalide', restantes: 1 })
    expect(await verifierAcces(TEL_DUPONT, faux)).toEqual({ etat: 'code_invalide', restantes: 0 })
    expect((await verifierAcces(TEL_DUPONT, bon)).etat).toBe('code_expire')
  })

  it('un robot qui envoie vingt codes à la fois n’obtient pas plus de trois essais', async () => {
    await demanderAcces(TEL_DUPONT, nouvelleIp())
    const bon = codes.get(TEL_DUPONT)!
    const faux = Array.from({ length: 20 }, (_, i) => String((Number(bon) + 1 + i) % 1_000_000).padStart(6, '0'))
    const reponses = await Promise.all(faux.map((c) => verifierAcces(TEL_DUPONT, c)))
    expect(reponses.filter((r) => r.etat === 'code_invalide').length).toBeLessThanOrEqual(3)
    expect((await verifierAcces(TEL_DUPONT, bon)).etat).toBe('code_expire')
  })

  it('même chose pour le code de confirmation d’une réservation', async () => {
    const d = await demarrerReservation({
      motifId,
      praticienId,
      siteId,
      debut: jour(9, '15:00'),
      nom: `Robot${SUFFIXE}`,
      prenom: 'X',
      telephone: TEL_INCONNU,
      ipAddress: nouvelleIp(),
    })
    if (d.etat !== 'code_envoye') throw new Error(d.etat)
    const bon = codes.get(TEL_INCONNU)!
    const faux = Array.from({ length: 20 }, (_, i) => String((Number(bon) + 1 + i) % 1_000_000).padStart(6, '0'))
    const reponses = await Promise.all(faux.map((c) => confirmerReservation(d.id, c, nouvelleIp())))
    expect(reponses.filter((r) => r.etat === 'code_invalide').length).toBeLessThanOrEqual(3)
    expect((await confirmerReservation(d.id, bon, nouvelleIp())).etat).toBe('code_expire')
    expect(await prisma.rendezVous.count({ where: { patient: { telephone: TEL_INCONNU } } })).toBe(0)
  })

  it('un espace refermé (15 minutes sans geste) ne se rouvre pas avec l’ancien jeton', async () => {
    const jeton = await ouvrirEspace(TEL_DUPONT)
    await prisma.accesPatient.updateMany({
      where: { telephone: TEL_DUPONT, jetonHash: { not: null } },
      data: { fenetreExpire: new Date(Date.now() - 1000) },
    })
    expect(await rendezVousDuPatient(jeton, new Date())).toBeNull()
    expect(await historiqueDuPatient(jeton, new Date())).toBeNull()
    expect((await annulerParPatient(jeton, rdvDupont, nouvelleIp(), new Date())).etat).toBe('fenetre_expiree')
    expect(
      (await deplacerParPatient(jeton, rdvDupont, jour(9, '16:00'), praticienId, nouvelleIp(), new Date())).etat,
    ).toBe('fenetre_expiree')
    expect((await inscrireListeAttente(jeton, { motifId, siteId }, nouvelleIp(), new Date())).etat).toBe(
      'fenetre_expiree',
    )
    expect((await preferencesDuPatient(jeton)).etat).toBe('fenetre_expiree')
  })
})

// ─── 3. Les règles du cabinet, vues du patient ──────────────────────────────

describe('3. Les règles du cabinet, appliquées au patient', () => {
  it('à moins de 24 h, pas d’annulation en ligne — ni bouton, ni geste forcé — mais le déplacement reste ouvert', async () => {
    const debut = new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 900_000) * 900_000)
    const rdvId = await rdvDirect(TEL_DUPONT, debut)
    const jeton = await ouvrirEspace(TEL_DUPONT)
    const vu = (await rendezVousDuPatient(jeton, new Date()))!.find((r) => r.id === rdvId)
    expect(vu).toMatchObject({ annulable: false, deplacable: true })
    expect((await annulerParPatient(jeton, rdvId, nouvelleIp(), new Date())).etat).toBe('trop_tard')
    expect((await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdvId } })).statut).toBe(
      StatutRendezVous.A_CONFIRMER,
    )
  })

  it('deux « Annuler » touchés coup sur coup ne comptent qu’une absence', async () => {
    const rdvId = await rdvDirect(TEL_VOISINE, jour(10, '13:00'))
    const avant = (await prisma.patient.findFirstOrThrow({ where: { telephone: TEL_VOISINE } })).manquements
    const jeton = await ouvrirEspace(TEL_VOISINE)
    const [a, b] = await Promise.all([
      annulerParPatient(jeton, rdvId, nouvelleIp(), new Date()),
      annulerParPatient(jeton, rdvId, nouvelleIp(), new Date()),
    ])
    expect([a.etat, b.etat].filter((e) => e === 'annule')).toHaveLength(1)
    const apres = (await prisma.patient.findFirstOrThrow({ where: { telephone: TEL_VOISINE } })).manquements
    expect(apres - avant).toBe(1)
  })

  it('patient bloqué (trois absences) : réservation en ligne et liste d’attente refusées, mais il voit et déplace son rendez-vous', async () => {
    const rdvId = await rdvDirect(TEL_BLOQUE, jour(11, '13:00'), { bloque: true })
    const d = await demarrerReservation({
      motifId,
      praticienId,
      siteId,
      debut: jour(11, '16:00'),
      nom: 'Bloque',
      prenom: 'Hugo',
      telephone: TEL_BLOQUE,
      ipAddress: nouvelleIp(),
    })
    expect(d.etat).toBe('code_envoye')
    const f = await confirmerReservation((d as { id: string }).id, codes.get(TEL_BLOQUE)!, nouvelleIp())
    expect(f.etat).toBe('reservation_bloquee')
    expect(await prisma.rendezVous.count({ where: { patient: { telephone: TEL_BLOQUE } } })).toBe(1)

    const jeton = await ouvrirEspace(TEL_BLOQUE)
    expect((await inscrireListeAttente(jeton, { motifId, siteId }, nouvelleIp(), new Date())).etat).toBe(
      'reservation_bloquee',
    )
    expect((await rendezVousDuPatient(jeton, new Date()))!.map((r) => r.id)).toEqual([rdvId])
    const proposes = await creneauxPourDeplacement(jeton, rdvId, new Date())
    const r = await deplacerParPatient(
      jeton,
      rdvId,
      proposes![0]!.debut,
      proposes![0]!.praticienId,
      nouvelleIp(),
      new Date(),
    )
    expect(r.etat).toBe('deplace')
  })

  it('deux patients réservent le même créneau à la même seconde : un seul l’obtient', async () => {
    const debut = jour(12, '13:00')
    const [a, b] = await Promise.all(
      [TEL_DUPONT, TEL_VOISINE].map((telephone) =>
        demarrerReservation({
          motifId,
          praticienId,
          siteId,
          debut,
          nom: `Course${SUFFIXE}`,
          prenom: 'X',
          telephone,
          ipAddress: nouvelleIp(),
        }),
      ),
    )
    const fins = await Promise.all(
      [
        [a, TEL_DUPONT],
        [b, TEL_VOISINE],
      ].map(([d, tel]) => confirmerReservation((d as { id: string }).id, codes.get(tel as string)!, nouvelleIp())),
    )
    expect(fins.filter((f) => f.etat === 'confirme')).toHaveLength(1)
    expect(fins.filter((f) => f.etat === 'creneau_pris')).toHaveLength(1)
  })
})

// ─── 4. Liste d'attente et préférences ──────────────────────────────────────

describe('4. Liste d’attente et préférences de messages', () => {
  it('s’inscrit, se retrouve dans sa liste, se désinscrit — et une seconde désinscription ne casse rien', async () => {
    const jeton = await ouvrirEspace(TEL_DUPONT)
    const r = await inscrireListeAttente(jeton, { motifId, siteId }, nouvelleIp(), new Date())
    expect(r.etat).toBe('inscrit')
    const id = (r as { id: string }).id
    expect((await inscriptionsDuPatient(jeton, new Date()))!.map((i) => i.id)).toContain(id)
    expect(
      await prisma.auditLog.count({ where: { entityType: 'liste_attente', entityId: id, action: 'CREATE' } }),
    ).toBe(1)

    expect((await desinscrireListeAttente(jeton, id, nouvelleIp())).etat).toBe('desinscrit')
    expect(
      await prisma.auditLog.count({ where: { entityType: 'liste_attente', entityId: id, action: 'DELETE' } }),
    ).toBe(1)
    expect((await desinscrireListeAttente(jeton, id, nouvelleIp())).etat).toBe('introuvable')
  })

  it('deux désinscriptions simultanées : une seule réussit, l’autre répond « introuvable », sans erreur', async () => {
    const jeton = await ouvrirEspace(TEL_DUPONT)
    const r = await inscrireListeAttente(jeton, { motifId, siteId }, nouvelleIp(), new Date())
    const id = (r as { id: string }).id
    const reponses = await Promise.all([
      desinscrireListeAttente(jeton, id, nouvelleIp()),
      desinscrireListeAttente(jeton, id, nouvelleIp()),
    ])
    expect(reponses.map((x) => x.etat).sort()).toEqual(['desinscrit', 'introuvable'])
  })

  it('coupe les messages non essentiels ; les rappels restent ; la voisine n’y touche pas', async () => {
    const jeton = await ouvrirEspace(TEL_DUPONT)
    expect(
      (await enregistrerPreferences(jeton, { sms: { rappels: true, nonEssentiels: false } }, nouvelleIp())).etat,
    ).not.toBe('fenetre_expiree')
    const lues = await preferencesDuPatient(jeton)
    expect(lues).toMatchObject({ etat: 'chargees', preferences: { sms: { rappels: true, nonEssentiels: false } } })

    const jetonVoisine = await ouvrirEspace(TEL_VOISINE)
    expect(await preferencesDuPatient(jetonVoisine)).toMatchObject({
      preferences: { sms: { rappels: true, nonEssentiels: true } },
    })
  })
})

// ─── 5. Une famille, un numéro (D68) ────────────────────────────────────────

describe('5. Madame Dupont réserve pour son fils Hugo avec son propre numéro', () => {
  const reserverPour = async (prenom: string, heure: string) => {
    const d = await demarrerReservation({
      motifId,
      praticienId,
      siteId,
      debut: jour(10, heure),
      nom: `Famille${SUFFIXE}`,
      prenom,
      telephone: TEL_FAMILLE,
      ipAddress: nouvelleIp(),
    })
    if (d.etat !== 'code_envoye') throw new Error(d.etat)
    return confirmerReservation(d.id, codes.get(TEL_FAMILLE)!, nouvelleIp())
  }

  it('le rendez-vous d’Hugo arrive sur une fiche à son nom, celle de Marie n’est pas touchée', async () => {
    const marie = await prisma.patient.create({
      data: { nom: `Famille${SUFFIXE}`, prenom: 'Marie', telephone: TEL_FAMILLE },
    })
    const r = await reserverPour('Hugo', '14:00')
    expect(r.etat).toBe('confirme')
    const rdv = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: (r as { rendezVousId: string }).rendezVousId },
      include: { patient: true },
    })
    expect(rdv.patient.prenom).toBe('Hugo')
    expect(rdv.patientId).not.toBe(marie.id)
    expect(await prisma.patient.count({ where: { telephone: TEL_FAMILLE } })).toBe(2)
  })

  it('« hugo » tapé une autre fois retrouve la fiche d’Hugo au lieu d’en créer une troisième', async () => {
    const r = await reserverPour('hugo ', '15:00')
    expect(r.etat).toBe('confirme')
    expect(await prisma.patient.count({ where: { telephone: TEL_FAMILLE } })).toBe(2)
  })

  it('l’espace du numéro montre les rendez-vous de toute la famille', async () => {
    const jeton = await ouvrirEspace(TEL_FAMILLE)
    expect((await rendezVousDuPatient(jeton, new Date()))!.length).toBe(2)
  })

  it('si la fiche de Marie est bloquée, réserver sous le prénom d’Hugo ne contourne pas la sanction', async () => {
    await prisma.patient.updateMany({
      where: { telephone: TEL_FAMILLE, prenom: 'Marie' },
      data: { manquements: 3, reservationBloquee: true },
    })
    expect((await reserverPour('Hugo', '16:00')).etat).toBe('reservation_bloquee')
  })
})

describe('6. « Fermer mon espace »', () => {
  it('referme la fenêtre en base : le jeton ne rouvre plus rien, même recopié', async () => {
    const jeton = await ouvrirEspace(TEL_DUPONT)
    expect(await rendezVousDuPatient(jeton, new Date())).not.toBeNull()
    await fermerFenetre(jeton)
    expect(await rendezVousDuPatient(jeton, new Date())).toBeNull()
    expect((await preferencesDuPatient(jeton)).etat).toBe('fenetre_expiree')
  })
})

describe('7. Cinq codes par heure et par numéro, quelle que soit l’adresse de connexion', () => {
  it('« Mes rendez-vous » : le sixième code demandé pour le même numéro est refusé, et aucun SMS ne part', async () => {
    for (let i = 0; i < 5; i++) expect((await demanderAcces(TEL_VOISINE, nouvelleIp())).etat).toBe('code_envoye')
    envoyes.length = 0
    expect((await demanderAcces(TEL_VOISINE, nouvelleIp())).etat).toBe('trop_de_tentatives')
    expect(envoyes).toEqual([])
  })

  it('pour un numéro inconnu aussi : rien ne trahit qui est patient', async () => {
    for (let i = 0; i < 5; i++) await demanderAcces(TEL_INCONNU, nouvelleIp())
    expect((await demanderAcces(TEL_INCONNU, nouvelleIp())).etat).toBe('trop_de_tentatives')
  })

  it('réservation en ligne : au sixième code pour le même numéro, refus et aucun SMS', async () => {
    const tel = `+3361800${fin4}`
    try {
      for (let i = 0; i < 5; i++) {
        const d = await demarrerReservation({
          motifId,
          praticienId,
          siteId,
          debut: jour(12, '18:00'),
          nom: 'Robot',
          prenom: 'X',
          telephone: tel,
          ipAddress: nouvelleIp(),
        })
        expect(d.etat).toBe('code_envoye')
      }
      envoyes.length = 0
      const sixieme = await demarrerReservation({
        motifId,
        praticienId,
        siteId,
        debut: jour(12, '18:00'),
        nom: 'Robot',
        prenom: 'X',
        telephone: tel,
        ipAddress: nouvelleIp(),
      })
      expect(sixieme.etat).toBe('trop_de_tentatives')
      expect(envoyes).toEqual([])
    } finally {
      await prisma.reservationPublique.deleteMany({ where: { telephone: tel } })
    }
  })
})
