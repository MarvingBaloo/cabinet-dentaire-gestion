import { CanalNotification, StatutEnvoiListeAttente, TypeNotification } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { instantCabinet } from '@/lib/dates'
import { prisma } from '@/server/db/client'
import { cleIdempotence, emettre, traiterLot } from '@/server/notifications/file'
import { demanderAcces, verifierAcces } from '@/server/services/acces-patient'
import {
  desinscrireListeAttente,
  inscrireListeAttente,
  inscriptionsDuPatient,
} from '@/server/services/inscription-liste-attente'
import { creneauxDisponibles } from '@/server/queries/public/creneaux'
import { creneauLibere, purgerInscriptionsExpirees } from '@/server/services/liste-attente'
import { confirmerReservation, demarrerReservation } from '@/server/services/reservation-publique'
import { definirTransporteur, type Message } from '@/server/sms/envoi'

// ⚠ DEPUIS LA FILE DE NOTIFICATIONS (phase 4, lot 1, D37) : `creneauLibere`
// n'envoie plus aucun SMS de façon synchrone — elle ÉMET une ligne dans la
// file (`notification`), que seul `traiterLot` (le worker, en test : appelé
// directement) traite réellement. Partout où ce fichier vérifiait un envoi
// immédiat, un appel à `traiterLot(maintenant)` a été ajouté après
// `creneauLibere` — sinon rien ne part jamais, par construction.
//
// Ce que ça change AUSSI : reprendre un envoi différé (fenêtre 21h-8h) n'est
// plus un appel dédié (`reprendreEnvoiDiffere`, supprimé) mais un passage de
// `traiterLot` après 8h, comme n'importe quelle autre ligne due — les tests
// de ce describe ont été réécrits pour passer par `creneauLibere` +
// `traiterLot` plutôt que par la fonction interne disparue.

// Ce que ces tests cherchent à prouver (D29-D32), dans l'ordre du brief :
//   - au plus CINQ inscrits notifiés par créneau libéré, dans l'ordre d'inscription
//   - ce plafond tient sous DEUX libérations concurrentes du même créneau (D30)
//   - rien ne part entre 21h et 8h ; ce qui tombe dans la plage part à 8h si le
//     créneau est encore libre et à venir, jamais sinon
//   - le lien envoyé mène au parcours de réservation existant, dont l'atomicité
//     n'est pas dupliquée : deux patients qui réservent le même créneau, un seul
//     gagne (D31)
//   - un patient bloqué (D21) n'est ni inscrit ni notifié
//   - la correspondance motif + site + praticien (facultatif) est respectée
//   - désinscription et expiration retirent bien un inscrit de la sélection
//   - tout est tracé au journal, sans jamais y faire figurer un numéro

const SUFFIXE = Date.now()
const IP = `198.51.100.${(SUFFIXE + 13) % 200}`

let siteId: string
let autreSiteId: string
let praticienId: string
let autrePraticienId: string
let fauteuilId: string
let motifId: string
let autreMotifId: string

const cree = {
  praticiens: [] as string[],
  fauteuils: [] as string[],
  motifs: [] as string[],
}

/** Décale l'instant courant — jamais de date UTC fixe, comme le reste du dépôt. */
const decale = (heures: number) => new Date(Date.now() + heures * 3_600_000)

const envoyes: Message[] = []
const transporteurEssai = {
  nom: 'essai',
  async envoyer(m: Message) {
    envoyes.push(m)
    return { ok: true as const, reference: 'essai' }
  },
}

/** Le dernier SMS envoyé à ce numéro — pour en extraire un code ou un lien. */
function dernierMessagePour(telephone: string): Message | undefined {
  return [...envoyes].reverse().find((m) => m.destinataire === telephone)
}
function dernierCodePour(telephone: string): string {
  return /(\d{6})/.exec(dernierMessagePour(telephone)?.texte ?? '')?.[1] ?? ''
}

let compteurTelephones = 0
/** Un numéro distinct à chaque appel : évite qu'un test hérite des inscrits d'un autre. */
function telephone(): string {
  compteurTelephones += 1
  return `+3370${String(SUFFIXE).slice(-4)}${String(compteurTelephones).padStart(3, '0')}`
}

/**
 * `demanderAcces` n'envoie un SMS réel que pour un numéro déjà connu — sinon
 * la réponse resterait `code_envoye` mais rien ne part, pour ne jamais laisser
 * deviner qu'un numéro est ou non suivi par le cabinet (D8). Un test qui veut
 * un vrai code à vérifier doit donc d'abord poser un `Patient` sur ce numéro.
 */
async function creerPatientPourTelephone(tel: string) {
  return prisma.patient.create({ data: { nom: `Attente${SUFFIXE}`, prenom: 'Test', telephone: tel } })
}

/** Ouvre une fenêtre d'accès patient, comme le ferait le parcours complet (D23). */
async function ouvrirFenetre(tel: string) {
  const demande = await demanderAcces(tel, IP)
  if (demande.etat !== 'code_envoye') throw new Error(demande.etat)
  const verif = await verifierAcces(tel, dernierCodePour(tel))
  if (verif.etat !== 'ouvert') throw new Error(verif.etat)
  return verif.jeton
}

/** Inscription directe en base, pour contrôler précisément l'ordre d'inscription
 *  (`createdAt`) sans dépendre de la vitesse d'exécution des tests. */
async function inscrireDirect(
  tel: string,
  options: {
    motifId?: string
    siteId?: string
    praticienId?: string | null
    expiresAt?: Date
    createdAt?: Date
    avantLe?: Date | null
  } = {},
) {
  return prisma.inscriptionListeAttente.create({
    data: {
      telephone: tel,
      motifId: options.motifId ?? motifId,
      siteId: options.siteId ?? siteId,
      praticienId: options.praticienId ?? null,
      expiresAt: options.expiresAt ?? decale(24 * 60),
      avantLe: options.avantLe ?? null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
    select: { id: true, telephone: true, createdAt: true },
  })
}

beforeAll(async () => {
  definirTransporteur(transporteurEssai)

  const sites = await prisma.site.findMany({ select: { id: true }, orderBy: { code: 'asc' } })
  siteId = sites[0]!.id
  autreSiteId = (sites[1] ?? sites[0])!.id

  const p = await prisma.praticien.create({
    data: { nom: `ListeAttente${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const autre = await prisma.praticien.create({
    data: { nom: `AutreListeAttente${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  autrePraticienId = autre.id
  cree.praticiens.push(autre.id)

  const f = await prisma.fauteuil.create({
    data: { siteId, nom: `Fauteuil liste attente ${SUFFIXE}` },
    select: { id: true },
  })
  fauteuilId = f.id
  cree.fauteuils.push(f.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Acte liste attente ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)

  const autreM = await prisma.motifConsultation.create({
    data: { libelle: `Autre acte liste attente ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  autreMotifId = autreM.id
  cree.motifs.push(autreM.id)

  await prisma.praticienMotif.create({ data: { praticienId, motifId, dureeMinutes: 30 } })

  // Présence large : de la veille à 90 jours devant, sur le fauteuil dédié.
  await prisma.plageDePresence.create({
    data: { praticienId, siteId, fauteuilId, debut: decale(-24), fin: decale(90 * 24) },
  })
})

beforeEach(async () => {
  envoyes.length = 0
  // Chaque test repart d'une liste d'attente vide : sans ce nettoyage, les
  // inscriptions d'un test resteraient candidates (motif + site + praticien
  // nul = « peu importe ») pour les libérations testées plus loin dans le
  // fichier — un inscrit ne s'efface jamais tout seul, seule l'expiration ou
  // la désinscription le retire.
  await prisma.inscriptionListeAttente.deleteMany({ where: { motifId: { in: cree.motifs } } })
  // Ce fichier utilise une adresse UNIQUE mais des numéros toujours NOUVEAUX
  // (contrairement à `deplacement-patient.test.ts`, qui réutilise deux
  // numéros fixes et les purge à chaque test) : sans ce nettoyage, la
  // limitation par IP de `demanderAcces` (cinq demandes par heure) finirait
  // par se déclencher au fil des tests de ce fichier, pour une raison sans
  // rapport avec ce qu'ils éprouvent.
  await prisma.accesPatient.deleteMany({ where: { ipAddress: IP } })
})

afterAll(async () => {
  await prisma.envoiListeAttente.deleteMany({ where: { praticienId: { in: [praticienId, autrePraticienId] } } })
  await prisma.inscriptionListeAttente.deleteMany({ where: { motifId: { in: cree.motifs } } })
  await prisma.accesPatient.deleteMany({ where: { telephone: { startsWith: `+3370${String(SUFFIXE).slice(-4)}` } } })
  // Doit précéder la suppression des rendez-vous : `Notification.rendezVous`
  // est `onDelete: Restrict` (phase 4, lot 3, D37) — les réservations confirmées
  // dans ce fichier émettent désormais une ligne CONFIRMATION_RESERVATION.
  await prisma.notification.deleteMany({ where: { destinataire: { startsWith: `+3370${String(SUFFIXE).slice(-4)}` } } })
  await prisma.reservationPublique.deleteMany({ where: { motifId: { in: cree.motifs } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { telephone: { startsWith: `+3370${String(SUFFIXE).slice(-4)}` } } })
  await prisma.plageDePresence.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  await prisma.$disconnect()
})

// Un instant garanti dans la fenêtre d'envoi (8h-21h, America/Guadeloupe).
const midiOuvert = instantCabinet('2026-01-05', '12:00') as Date

describe('creneauLibere — plafond et ordre d’inscription', () => {
  it('notifie au plus cinq inscrits, les cinq premiers par ordre d’inscription', async () => {
    const base = new Date('2026-01-01T00:00:00.000Z')
    const telephones = Array.from({ length: 7 }, () => telephone())
    for (const [i, tel] of telephones.entries()) {
      await inscrireDirect(tel, { createdAt: new Date(base.getTime() + i * 1_000) })
    }

    const debut = decale(5 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)
    await traiterLot(midiOuvert)

    const envois = await prisma.envoiListeAttente.findMany({
      where: { praticienId, creneauDebut: debut, creneauFin: fin },
      include: { inscription: { select: { telephone: true } } },
      orderBy: { createdAt: 'asc' },
    })
    expect(envois).toHaveLength(5)
    expect(envois.map((e) => e.inscription.telephone)).toEqual(telephones.slice(0, 5))
    expect(envoyes).toHaveLength(5)
    expect(envoyes.map((m) => m.destinataire).sort()).toEqual(telephones.slice(0, 5).sort())
  })

  it('tient le plafond sous deux libérations concurrentes du même créneau (D30)', async () => {
    const base = new Date('2026-01-01T00:00:00.000Z')
    const telephones = Array.from({ length: 7 }, () => telephone())
    for (const [i, tel] of telephones.entries()) {
      await inscrireDirect(tel, { createdAt: new Date(base.getTime() + i * 1_000) })
    }

    const debut = decale(6 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    const evenement = { siteId, praticienId, motifId, debut, fin }

    // Deux appels concurrents pour EXACTEMENT le même créneau : le verrou
    // consultatif doit les sérialiser, jamais laisser les deux compter zéro.
    await Promise.all([creneauLibere(evenement, midiOuvert), creneauLibere(evenement, midiOuvert)])
    // Purge la file pour ce créneau : sans ça, ces lignes resteraient
    // `A_ENVOYER` et pollueraient le lot d'un test ultérieur qui appelle
    // `traiterLot(midiOuvert)` sans rapport avec CE créneau-ci.
    await traiterLot(midiOuvert)

    const total = await prisma.envoiListeAttente.count({ where: { praticienId, creneauDebut: debut, creneauFin: fin } })
    expect(total).toBe(5)
  })

  it('ne notifie pas deux fois le même inscrit pour le même créneau', async () => {
    const tel = telephone()
    await inscrireDirect(tel)
    const debut = decale(7 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    const evenement = { siteId, praticienId, motifId, debut, fin }

    await creneauLibere(evenement, midiOuvert)
    await creneauLibere(evenement, midiOuvert)
    await traiterLot(midiOuvert) // purge la file, comme le test précédent.

    const total = await prisma.envoiListeAttente.count({ where: { praticienId, creneauDebut: debut, creneauFin: fin } })
    expect(total).toBe(1)
  })
})

describe('creneauLibere — fenêtre 21h-8h (America/Guadeloupe)', () => {
  it('n’envoie rien immédiatement quand la libération tombe à 22h, et programme la reprise à 8h', async () => {
    const tel = telephone()
    await inscrireDirect(tel)
    const debut = decale(5 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    const a22h = instantCabinet('2026-02-10', '22:00') as Date

    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, a22h)

    expect(envoyes).toHaveLength(0)
    const envoi = await prisma.envoiListeAttente.findFirstOrThrow({
      where: { praticienId, creneauDebut: debut, creneauFin: fin },
    })
    expect(envoi.statut).toBe(StatutEnvoiListeAttente.EN_ATTENTE)
    expect(envoi.planifiePour?.toISOString()).toBe((instantCabinet('2026-02-11', '08:00') as Date).toISOString())
  })

  it('à 8h, envoie si le créneau est encore libre et à venir', async () => {
    const tel = telephone()
    const debut = decale(5 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    const a22h = instantCabinet('2026-03-01', '22:00') as Date
    const a8h01 = instantCabinet('2026-03-02', '08:01') as Date

    await inscrireDirect(tel)
    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, a22h)
    expect(envoyes).toHaveLength(0) // différé par la fenêtre, comme le describe précédent le montre déjà.

    await traiterLot(a8h01)

    expect(envoyes.map((m) => m.destinataire)).toContain(tel)
    const relu = await prisma.envoiListeAttente.findFirstOrThrow({
      where: { praticienId, creneauDebut: debut, creneauFin: fin },
    })
    expect(relu.statut).toBe(StatutEnvoiListeAttente.ENVOYE)
    expect(relu.envoyeLe).not.toBeNull()
  })

  it('à 8h, abandonne si le créneau a été repris entre-temps — jamais de SMS', async () => {
    const tel = telephone()
    const debut = decale(6 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    const a22h = instantCabinet('2026-03-03', '22:00') as Date
    const a8h01 = instantCabinet('2026-03-04', '08:01') as Date

    await inscrireDirect(tel)
    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, a22h)

    // Quelqu'un d'autre a pris le créneau avant la reprise différée.
    const patient = await prisma.patient.create({ data: { nom: `Occupe${SUFFIXE}`, prenom: 'Test', telephone: telephone() } })
    await prisma.rendezVous.create({
      data: { patientId: patient.id, praticienId, siteId, fauteuilId, motifId, debut, fin },
    })

    await traiterLot(a8h01)

    expect(envoyes.map((m) => m.destinataire)).not.toContain(tel)
    const relu = await prisma.envoiListeAttente.findFirstOrThrow({
      where: { praticienId, creneauDebut: debut, creneauFin: fin },
    })
    expect(relu.statut).toBe(StatutEnvoiListeAttente.ABANDONNE)
  })

  it('à 8h, abandonne si le créneau est déjà passé — jamais de SMS', async () => {
    // Fige l'horloge dans la fenêtre d'envoi (8h-21h, D29) : `decale()` et
    // `traiterLot(new Date())` lisent tous deux l'horloge système, et
    // `traiterLot` sort SANS RIEN TRAITER dès que l'instant réel tombe dans
    // la fenêtre de silence 21h-8h (`if (!dansLaFenetreEnvoi(maintenant))
    // return resultat`, src/server/notifications/file.ts) — laissant
    // `envoi.statut` inchangé et l'assertion ci-dessous en échec, un échec qui
    // ne démontre rien sur la règle testée ici. Seul `Date` est simulé : les
    // délais réels (I/O, connexion base) continuent de s'écouler normalement.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(instantCabinet('2026-03-04', '10:00') as Date)

    try {
      const tel = telephone()
      const debut = decale(-2) // déjà passé
      const fin = new Date(debut.getTime() + 30 * 60_000)

      // Construit directement l'état qu'une libération suivie d'une fenêtre
      // fermée aurait laissé — `creneauLibere` ne libère jamais un créneau déjà
      // passé, ce scénario simule donc la reprise du lendemain d'un cas qui
      // était à venir au moment de l'émission.
      const inscription = await inscrireDirect(tel)
      const envoi = await prisma.envoiListeAttente.create({
        data: {
          inscriptionId: inscription.id,
          creneauDebut: debut,
          creneauFin: fin,
          praticienId,
          siteId,
          motifId,
          planifiePour: new Date(Date.now() - 1_000),
        },
      })
      await emettre(prisma, {
        type: TypeNotification.CRENEAU_LIBERE,
        canal: CanalNotification.SMS,
        destinataire: tel,
        texte: 'Test',
        envoiListeAttenteId: envoi.id,
        siteId,
        planifiePour: new Date(Date.now() - 1_000),
        cle: cleIdempotence(['TEST_CRENEAU_PASSE', envoi.id, 'SMS']),
      })

      await traiterLot(new Date())

      expect(envoyes.map((m) => m.destinataire)).not.toContain(tel)
      const relu = await prisma.envoiListeAttente.findUniqueOrThrow({ where: { id: envoi.id } })
      expect(relu.statut).toBe(StatutEnvoiListeAttente.ABANDONNE)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('creneauLibere — correspondance et patient bloqué', () => {
  it('respecte le motif, le site et le praticien (facultatif)', async () => {
    const telPeuImporte = telephone()
    const telCePraticien = telephone()
    const telAutrePraticien = telephone()
    const telAutreMotif = telephone()
    const telAutreSite = telephone()

    await inscrireDirect(telPeuImporte, { praticienId: null })
    await inscrireDirect(telCePraticien, { praticienId })
    await inscrireDirect(telAutrePraticien, { praticienId: autrePraticienId })
    await inscrireDirect(telAutreMotif, { motifId: autreMotifId })
    if (autreSiteId !== siteId) await inscrireDirect(telAutreSite, { siteId: autreSiteId })

    const debut = decale(8 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)
    await traiterLot(midiOuvert) // purge la file (voir la note en tête de fichier).

    const notifies = (
      await prisma.envoiListeAttente.findMany({
        where: { praticienId, creneauDebut: debut, creneauFin: fin },
        include: { inscription: { select: { telephone: true } } },
      })
    ).map((e) => e.inscription.telephone)

    expect(notifies.sort()).toEqual([telCePraticien, telPeuImporte].sort())
    expect(notifies).not.toContain(telAutrePraticien)
    expect(notifies).not.toContain(telAutreMotif)
    if (autreSiteId !== siteId) expect(notifies).not.toContain(telAutreSite)
  })

  it('n’inscrit pas un patient bloqué (D21)', async () => {
    const tel = telephone()
    await prisma.patient.create({
      data: { nom: `Bloque${SUFFIXE}`, prenom: 'Test', telephone: tel, reservationBloquee: true, manquements: 3 },
    })
    const jeton = await ouvrirFenetre(tel)

    const r = await inscrireListeAttente(jeton, { motifId, siteId }, IP, new Date())
    expect(r.etat).toBe('reservation_bloquee')

    const inscriptions = await prisma.inscriptionListeAttente.findMany({ where: { telephone: tel } })
    expect(inscriptions).toHaveLength(0)
  })

  it('ne notifie pas un inscrit devenu bloqué depuis son inscription', async () => {
    const tel = telephone()
    await inscrireDirect(tel)
    await prisma.patient.create({
      data: { nom: `BloqueApres${SUFFIXE}`, prenom: 'Test', telephone: tel, reservationBloquee: true, manquements: 3 },
    })

    const debut = decale(9 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)

    const total = await prisma.envoiListeAttente.count({ where: { praticienId, creneauDebut: debut, creneauFin: fin } })
    expect(total).toBe(0)
    expect(envoyes).toHaveLength(0)
  })
})

describe('date butoir (avantLe, D29)', () => {
  it('un créneau libéré avant la date butoir prévient l’inscrit', async () => {
    const tel = telephone()
    const debut = decale(14 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    // Butoir strictement après le créneau libéré : encore éligible.
    await inscrireDirect(tel, { avantLe: new Date(debut.getTime() + 1_000) })

    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)
    await traiterLot(midiOuvert)

    const total = await prisma.envoiListeAttente.count({ where: { praticienId, creneauDebut: debut, creneauFin: fin } })
    expect(total).toBe(1)
    expect(envoyes.map((m) => m.destinataire)).toContain(tel)
  })

  it('un créneau libéré à la date butoir, ou après, ne prévient pas l’inscrit', async () => {
    const telEgal = telephone()
    const telApres = telephone()
    const debut = decale(15 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    // Butoir égale au début du créneau libéré : plus rien à lui apporter.
    await inscrireDirect(telEgal, { avantLe: debut })
    // Butoir avant le début du créneau libéré : idem.
    await inscrireDirect(telApres, { avantLe: new Date(debut.getTime() - 1_000) })

    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)

    const total = await prisma.envoiListeAttente.count({ where: { praticienId, creneauDebut: debut, creneauFin: fin } })
    expect(total).toBe(0)
    expect(envoyes).toHaveLength(0)
  })

  it('sans date butoir, l’inscrit est toujours prévenu', async () => {
    const tel = telephone()
    const debut = decale(16 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    await inscrireDirect(tel, { avantLe: null })

    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)
    await traiterLot(midiOuvert)

    const total = await prisma.envoiListeAttente.count({ where: { praticienId, creneauDebut: debut, creneauFin: fin } })
    expect(total).toBe(1)
    expect(envoyes.map((m) => m.destinataire)).toContain(tel)
  })

  it('l’inscription enregistre avantLe = début du premier créneau disponible, et ignore toute valeur envoyée par le client', async () => {
    const tel = telephone()
    await creerPatientPourTelephone(tel)
    const jeton = await ouvrirFenetre(tel)

    const attendu = await creneauxDisponibles({ motifId, siteId, praticienId })
    expect(attendu.length).toBeGreaterThan(0)

    // Une valeur `avantLe` glissée dans l'entrée (comme le ferait un client
    // malveillant, hors du schéma Zod qui ne la porte pas) : la fonction ne
    // la lit jamais, elle recalcule toujours elle-même.
    const entree = { motifId, siteId, praticienId, avantLe: new Date('2099-01-01') }
    const r = await inscrireListeAttente(jeton, entree as unknown as Parameters<typeof inscrireListeAttente>[1], IP, new Date())
    expect(r.etat).toBe('inscrit')
    if (r.etat !== 'inscrit') return

    const enregistree = await prisma.inscriptionListeAttente.findUniqueOrThrow({ where: { id: r.id } })
    expect(enregistree.avantLe?.toISOString()).toBe(attendu[0]!.debut.toISOString())
  })

  it('sans créneau disponible pour ce motif, l’inscription n’a pas de date butoir', async () => {
    const tel = telephone()
    await creerPatientPourTelephone(tel)
    const jeton = await ouvrirFenetre(tel)

    // `autreMotifId` n'a aucun `praticienMotif` : aucun créneau ne peut jamais
    // être proposé pour cet acte.
    const r = await inscrireListeAttente(jeton, { motifId: autreMotifId, siteId }, IP, new Date())
    expect(r.etat).toBe('inscrit')
    if (r.etat !== 'inscrit') return

    const enregistree = await prisma.inscriptionListeAttente.findUniqueOrThrow({ where: { id: r.id } })
    expect(enregistree.avantLe).toBeNull()
  })
})

describe('inscription, désinscription et expiration (D23, D29)', () => {
  it('inscrit, liste puis désinscrit — via le mécanisme de l’accès patient', async () => {
    const tel = telephone()
    await creerPatientPourTelephone(tel)
    const jeton = await ouvrirFenetre(tel)

    const inscrit = await inscrireListeAttente(jeton, { motifId, siteId, praticienId }, IP, new Date())
    expect(inscrit.etat).toBe('inscrit')
    if (inscrit.etat !== 'inscrit') return

    const mesInscriptions = await inscriptionsDuPatient(jeton, new Date())
    expect(mesInscriptions).toHaveLength(1)
    expect(mesInscriptions?.[0]?.id).toBe(inscrit.id)

    const desinscription = await desinscrireListeAttente(jeton, inscrit.id, IP)
    expect(desinscription.etat).toBe('desinscrit')

    const apres = await inscriptionsDuPatient(jeton, new Date())
    expect(apres).toHaveLength(0)
  })

  it('une inscription identique déjà active n’est pas dupliquée', async () => {
    const tel = telephone()
    await creerPatientPourTelephone(tel)
    const jeton = await ouvrirFenetre(tel)

    const premiere = await inscrireListeAttente(jeton, { motifId, siteId }, IP, new Date())
    const seconde = await inscrireListeAttente(jeton, { motifId, siteId }, IP, new Date())
    expect(premiere.etat).toBe('inscrit')
    expect(seconde.etat).toBe('inscrit')
    if (premiere.etat !== 'inscrit' || seconde.etat !== 'inscrit') return
    expect(seconde.id).toBe(premiere.id)

    const total = await prisma.inscriptionListeAttente.count({ where: { telephone: tel } })
    expect(total).toBe(1)
  })

  it('ne désinscrit pas l’inscription d’un autre numéro', async () => {
    const telA = telephone()
    const telB = telephone()
    await creerPatientPourTelephone(telA)
    await creerPatientPourTelephone(telB)
    const jetonA = await ouvrirFenetre(telA)
    const jetonB = await ouvrirFenetre(telB)

    const inscrit = await inscrireListeAttente(jetonA, { motifId, siteId }, IP, new Date())
    expect(inscrit.etat).toBe('inscrit')
    if (inscrit.etat !== 'inscrit') return

    const r = await desinscrireListeAttente(jetonB, inscrit.id, IP)
    expect(r.etat).toBe('introuvable')

    const total = await prisma.inscriptionListeAttente.count({ where: { id: inscrit.id } })
    expect(total).toBe(1)
  })

  it('une inscription expirée ne correspond plus à rien, et la purge la retire', async () => {
    const tel = telephone()
    // Expirée relativement à `midiOuvert` — le même instant que celui passé à
    // `creneauLibere` ci-dessous, pas à l'horloge réelle : c'est CET instant
    // qui décide, jamais `Date.now()` caché.
    await inscrireDirect(tel, { expiresAt: new Date(midiOuvert.getTime() - 1_000) })

    const debut = decale(10 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)

    const total = await prisma.envoiListeAttente.count({ where: { praticienId, creneauDebut: debut, creneauFin: fin } })
    expect(total).toBe(0)

    const purgees = await purgerInscriptionsExpirees(new Date())
    expect(purgees).toBeGreaterThanOrEqual(1)
    const reste = await prisma.inscriptionListeAttente.findFirst({ where: { telephone: tel } })
    expect(reste).toBeNull()
  })
})

describe('audit (D9) et lien de réservation (D31)', () => {
  it('trace inscription et désinscription dans le journal (sans le numéro), l’envoi dans la file de notifications (D37)', async () => {
    const tel = telephone()
    await creerPatientPourTelephone(tel)
    const jeton = await ouvrirFenetre(tel)

    const inscrit = await inscrireListeAttente(jeton, { motifId, siteId }, IP, new Date())
    expect(inscrit.etat).toBe('inscrit')
    if (inscrit.etat !== 'inscrit') return

    // La date butoir (D29) est couverte par son propre describe ; ici on isole l'audit.
    await prisma.inscriptionListeAttente.update({ where: { id: inscrit.id }, data: { avantLe: null } })

    const traceInscription = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'liste_attente', entityId: inscrit.id, action: 'CREATE' },
    })
    expect(JSON.stringify(traceInscription.metadata)).not.toContain(tel)

    const debut = decale(11 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)
    await traiterLot(midiOuvert)

    // Depuis la file de notifications (D37), l'envoi n'est plus tracé dans
    // `audit_log` : c'est la ligne `Notification` elle-même qui journalise le
    // résultat (fournisseur, statut) — `audit_log` reste réservé aux actions
    // humaines et de sécurité.
    const envoi = await prisma.envoiListeAttente.findFirstOrThrow({
      where: { praticienId, creneauDebut: debut, creneauFin: fin },
    })
    expect(envoi.statut).toBe(StatutEnvoiListeAttente.ENVOYE)
    const notification = await prisma.notification.findFirstOrThrow({ where: { envoiListeAttenteId: envoi.id } })
    expect(notification.statut).toBe('ENVOYEE')
    expect(notification.fournisseur).toBe('essai')

    await desinscrireListeAttente(jeton, inscrit.id, IP)
    const traceDesinscription = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'liste_attente', entityId: inscrit.id, action: 'DELETE' },
    })
    expect(JSON.stringify(traceDesinscription.metadata)).not.toContain(tel)
  })

  it('le lien envoyé mène au parcours de réservation existant, pré-rempli', async () => {
    const tel = telephone()
    await inscrireDirect(tel)

    const debut = decale(12 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)
    await traiterLot(midiOuvert)

    const message = dernierMessagePour(tel)
    // Même construction que le service : la comparer directement évite toute
    // hypothèse sur l'encodage exact des paramètres.
    const requete = new URLSearchParams({
      site: siteId,
      motif: motifId,
      praticien: praticienId,
      creneau: debut.toISOString(),
    }).toString()
    expect(message?.texte).toContain(`/rendez-vous?${requete}`)
    // Minimisation RGPD : ni motif ni nom en clair dans le texte du SMS.
    expect(message?.texte).not.toContain('Acte liste attente')
  })

  it('deux inscrits qui réservent le même créneau libéré : un seul gagne (D31, atomicité déjà testée à la réservation)', async () => {
    const telA = telephone()
    const telB = telephone()
    await inscrireDirect(telA, { createdAt: new Date(Date.now() - 2_000) })
    await inscrireDirect(telB, { createdAt: new Date(Date.now() - 1_000) })

    const debut = decale(13 * 24)
    const fin = new Date(debut.getTime() + 30 * 60_000)
    await creneauLibere({ siteId, praticienId, motifId, debut, fin }, midiOuvert)
    await traiterLot(midiOuvert)
    expect(envoyes).toHaveLength(2)
    envoyes.length = 0 // on ne garde que les SMS de confirmation de la course ci-dessous

    // Les deux inscrits suivent le même lien : ils atterrissent sur le même
    // parcours de réservation (`/rendez-vous`), donc sur `confirmerReservation`
    // — RIEN de nouveau côté atomicité (D31).
    const [d1, d2] = await Promise.all([
      demarrerReservation({ motifId, praticienId, siteId, debut, nom: 'Un', prenom: 'Test', telephone: telA, ipAddress: IP }),
      demarrerReservation({ motifId, praticienId, siteId, debut, nom: 'Deux', prenom: 'Test', telephone: telB, ipAddress: IP }),
    ])
    expect(d1.etat).toBe('code_envoye')
    expect(d2.etat).toBe('code_envoye')
    if (d1.etat !== 'code_envoye' || d2.etat !== 'code_envoye') return

    const [c1, c2] = await Promise.all([
      confirmerReservation(d1.id, dernierCodePour(telA), IP),
      confirmerReservation(d2.id, dernierCodePour(telB), IP),
    ])
    const etats = [c1.etat, c2.etat].sort()
    expect(etats).toEqual(['confirme', 'creneau_pris'])
  })
})
