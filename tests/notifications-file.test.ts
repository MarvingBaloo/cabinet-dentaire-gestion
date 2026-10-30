import { CanalNotification, StatutNotification, TypeNotification } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { instantCabinet } from '@/lib/dates'
import { prisma } from '@/server/db/client'
import { definirTransporteurEmail, type MessageEmail } from '@/server/email/envoi'
import { cleIdempotence, emettre, marquerIncertaines, prendreLot, traiterLot } from '@/server/notifications/file'
import { definirTransporteur, type Message, type ResultatEnvoi } from '@/server/sms/envoi'

// Ce que ces tests cherchent à prouver (D37-D40), dans l'ordre du brief :
//   - `emettre` est idempotente : une même clé n'écrit jamais deux lignes, et
//     rejouer `traiterLot` n'envoie jamais deux fois ce qui est déjà parti
//   - un worker qui prend une ligne (`prendreLot`) puis ne la finit jamais la
//     laisse `INCERTAINE` au bout de dix minutes — sans jamais la rappeler
//   - `FOR UPDATE SKIP LOCKED` tient sous deux prises concurrentes : aucune
//     ligne n'est prise deux fois, et l'union des deux lots couvre tout
//   - un échec explicite du fournisseur reprogramme avec un backoff croissant,
//     jusqu'à l'échec définitif à la cinquième tentative
//   - rien ne part entre 21h et 8h (heure du cabinet) ; ce qui est dû dans la
//     plage part au prochain passage après 8h
//
// Chaque test utilise un numéro de téléphone JAMAIS réutilisé (compteur
// monotone sur tout le fichier) : les assertions filtrent toujours par ce
// numéro, jamais par la taille totale d'un tableau partagé — un lot traité
// par un test peut légitimement contenir des lignes laissées par un autre.

const SUFFIXE = Date.now()
const PREFIXE_TEL = `+3371${String(SUFFIXE).slice(-4)}`

let compteurTelephones = 0
function prochainTelephone(): string {
  compteurTelephones += 1
  return `${PREFIXE_TEL}${String(compteurTelephones).padStart(3, '0')}`
}

type Reponse = ResultatEnvoi | (() => ResultatEnvoi)

let appels: Message[] = []
let reponses: Reponse[] = []
let indexReponse = 0

const transporteurEssai = {
  nom: 'essai',
  async envoyer(m: Message): Promise<ResultatEnvoi> {
    appels.push(m)
    const r = reponses[indexReponse]
    indexReponse += 1
    if (r === undefined) return { ok: true, reference: 'essai' }
    return typeof r === 'function' ? r() : r
  },
}

/** Programme les réponses successives du transporteur pour CE test — au-delà,
 *  le transporteur répond `ok: true` par défaut. */
function programmerReponses(...r: Reponse[]) {
  reponses = r
  indexReponse = 0
}

/** Les appels reçus pour CE numéro précisément — jamais le tableau entier,
 *  qui peut porter les appels d'un autre test traité dans le même lot. */
function appelsPour(dest: string): Message[] {
  return appels.filter((m) => m.destinataire === dest)
}

let appelsEmail: MessageEmail[] = []

const transporteurEmailEssai = {
  nom: 'essai-email',
  async envoyer(m: MessageEmail): Promise<ResultatEnvoi> {
    appelsEmail.push(m)
    return { ok: true, reference: 'essai-email' }
  },
}

function appelsEmailPour(dest: string): MessageEmail[] {
  return appelsEmail.filter((m) => m.destinataire === dest)
}

beforeEach(() => {
  appels = []
  appelsEmail = []
  programmerReponses()
  definirTransporteur(transporteurEssai)
  definirTransporteurEmail(transporteurEmailEssai)
})

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { destinataire: { startsWith: PREFIXE_TEL } } })
  await prisma.$disconnect()
})

describe('emettre — idempotence (D38)', () => {
  it('une même clé d’idempotence n’écrit jamais deux lignes, et rejouer traiterLot n’envoie jamais deux fois', async () => {
    const dest = prochainTelephone()
    const cle = cleIdempotence(['IDEMPOTENCE', dest, 'SMS'])
    const midi = instantCabinet('2026-01-05', '12:00') as Date

    const premiere = await emettre(prisma, {
      type: TypeNotification.CONFIRMATION_RESERVATION,
      canal: CanalNotification.SMS,
      destinataire: dest,
      texte: 'Confirmation de test',
      planifiePour: midi,
      cle,
    })
    const seconde = await emettre(prisma, {
      type: TypeNotification.CONFIRMATION_RESERVATION,
      canal: CanalNotification.SMS,
      destinataire: dest,
      texte: 'Confirmation de test — rejouée',
      planifiePour: midi,
      cle,
    })
    expect(premiere).toBe(true)
    expect(seconde).toBe(false)
    expect(await prisma.notification.count({ where: { cleIdempotence: cle } })).toBe(1)

    await traiterLot(midi)
    await traiterLot(new Date(midi.getTime() + 60_000))

    expect(appelsPour(dest)).toHaveLength(1)
    const relue = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })
    expect(relue.statut).toBe(StatutNotification.ENVOYEE)
  })
})

describe('traiterLot — worker tué en cours de route (D39)', () => {
  it('une ligne prise puis jamais finalisée devient INCERTAINE après dix minutes, sans être rappelée', async () => {
    const dest = prochainTelephone()
    const cle = cleIdempotence(['INCERTAINE', dest, 'SMS'])
    const t0 = instantCabinet('2026-01-05', '12:00') as Date

    await emettre(prisma, {
      type: TypeNotification.CONFIRMATION_RESERVATION,
      canal: CanalNotification.SMS,
      destinataire: dest,
      texte: 'Confirmation de test',
      planifiePour: t0,
      cle,
    })

    // Le worker prend le lot... et meurt avant d'appeler le transporteur ou
    // d'écrire le statut final : rien de plus que `prendreLot` lui-même.
    const prises = await prendreLot(50, t0)
    expect(prises.some((p) => p.destinataire === dest)).toBe(true)
    expect(appelsPour(dest)).toHaveLength(0)

    const t11 = new Date(t0.getTime() + 11 * 60_000)
    expect(await marquerIncertaines(t11)).toBeGreaterThanOrEqual(1)

    const relue = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })
    expect(relue.statut).toBe(StatutNotification.INCERTAINE)

    // Ni `EN_COURS` ni `INCERTAINE` n'est `A_ENVOYER` : un passage ultérieur
    // ne la reprend jamais — un rappel ne part jamais deux fois.
    await traiterLot(new Date(t11.getTime() + 60_000))
    expect(appelsPour(dest)).toHaveLength(0)
  })
})

describe('prendreLot — FOR UPDATE SKIP LOCKED', () => {
  it('deux prises concurrentes ne prennent jamais la même ligne, et leur union couvre tout ce qui était dû', async () => {
    const t0 = instantCabinet('2026-01-05', '12:00') as Date
    const N = 6
    const dests: string[] = []
    for (let i = 0; i < N; i += 1) {
      const dest = prochainTelephone()
      dests.push(dest)
      await emettre(prisma, {
        type: TypeNotification.CONFIRMATION_RESERVATION,
        canal: CanalNotification.SMS,
        destinataire: dest,
        texte: 'Confirmation de test',
        planifiePour: t0,
        cle: cleIdempotence(['SKIP_LOCKED', dest, 'SMS']),
      })
    }

    const [lotA, lotB] = await Promise.all([prendreLot(N, t0), prendreLot(N, t0)])
    const idsA = new Set(lotA.filter((l) => dests.includes(l.destinataire)).map((l) => l.id))
    const idsB = new Set(lotB.filter((l) => dests.includes(l.destinataire)).map((l) => l.id))

    for (const id of idsA) expect(idsB.has(id)).toBe(false)
    expect(new Set([...idsA, ...idsB]).size).toBe(N)

    // Nettoyage : ces lignes sont `EN_COURS`, jamais reprises automatiquement —
    // on ne veut rien laisser en `A_ENVOYER` pour les tests suivants.
    await prisma.notification.updateMany({
      where: { id: { in: [...idsA, ...idsB] } },
      data: { statut: StatutNotification.ENVOYEE, envoyeeLe: t0 },
    })
  })
})

describe('traiterLot — échec du fournisseur (D40)', () => {
  it('reprogramme avec un backoff croissant, jusqu’à l’échec définitif à la cinquième tentative', async () => {
    const dest = prochainTelephone()
    const cle = cleIdempotence(['BACKOFF', dest, 'SMS'])
    let t = instantCabinet('2026-01-06', '10:00') as Date

    await emettre(prisma, {
      type: TypeNotification.CONFIRMATION_RESERVATION,
      canal: CanalNotification.SMS,
      destinataire: dest,
      texte: 'Confirmation de test',
      planifiePour: t,
      cle,
    })

    const backoffsMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000]
    for (let essai = 1; essai <= 4; essai += 1) {
      programmerReponses({ ok: false, raison: 'panne simulée' })
      await traiterLot(t)

      const relue = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })
      expect(relue.statut).toBe(StatutNotification.A_ENVOYER)
      expect(relue.tentatives).toBe(essai)
      expect(relue.planifiePour.getTime()).toBe(t.getTime() + backoffsMs[essai - 1]!)

      t = relue.planifiePour
    }

    programmerReponses({ ok: false, raison: 'panne simulée' })
    await traiterLot(t)

    const finale = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })
    expect(finale.statut).toBe(StatutNotification.ECHEC)
    expect(finale.tentatives).toBe(5)
    expect(finale.derniereErreur).toContain('panne simulée')
  })
})

describe('traiterLot — fenêtre de silence 21h-8h (D29, America/Guadeloupe)', () => {
  it('rien ne part entre 21h et 8h ; une ligne due pendant la fenêtre part au prochain passage après 8h', async () => {
    const dest = prochainTelephone()
    const cle = cleIdempotence(['FENETRE', dest, 'SMS'])
    const a22h = instantCabinet('2026-02-10', '22:00') as Date
    const a8h01 = instantCabinet('2026-02-11', '08:01') as Date

    await emettre(prisma, {
      type: TypeNotification.CONFIRMATION_RESERVATION,
      canal: CanalNotification.SMS,
      destinataire: dest,
      texte: 'Confirmation de test',
      planifiePour: a22h,
      cle,
    })

    await traiterLot(a22h)
    expect(appelsPour(dest)).toHaveLength(0)
    expect((await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })).statut).toBe(
      StatutNotification.A_ENVOYER,
    )

    await traiterLot(a8h01)
    expect(appelsPour(dest)).toHaveLength(1)
    expect((await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })).statut).toBe(
      StatutNotification.ENVOYEE,
    )
  })
})

describe('traiterLot — canal e-mail (lot 2)', () => {
  it('une notification EMAIL part par le transporteur e-mail installé en test', async () => {
    const dest = `notification-test-${SUFFIXE}@example.invalid`
    const cle = cleIdempotence(['EMAIL_BRANCHE', dest])
    const midi = instantCabinet('2026-01-05', '12:00') as Date

    await emettre(prisma, {
      type: TypeNotification.CONFIRMATION_RESERVATION,
      canal: CanalNotification.EMAIL,
      destinataire: dest,
      sujet: 'Confirmation de votre rendez-vous',
      texte: 'Confirmation de test',
      planifiePour: midi,
      cle,
    })

    await traiterLot(midi)

    expect(appelsEmailPour(dest)).toHaveLength(1)
    const relue = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })
    expect(relue.statut).toBe(StatutNotification.ENVOYEE)
    expect(relue.fournisseur).toBe('essai-email')
  })

  it('échoue quand le sujet manque, comme tout autre échec du canal (même backoff)', async () => {
    const dest = `notification-test-sans-sujet-${SUFFIXE}@example.invalid`
    const cle = cleIdempotence(['EMAIL_SANS_SUJET', dest])
    const midi = instantCabinet('2026-01-05', '12:00') as Date

    await emettre(prisma, {
      type: TypeNotification.CONFIRMATION_RESERVATION,
      canal: CanalNotification.EMAIL,
      destinataire: dest,
      texte: 'Confirmation de test',
      planifiePour: midi,
      cle,
    })

    await traiterLot(midi)

    expect(appelsEmailPour(dest)).toHaveLength(0)
    const relue = await prisma.notification.findUniqueOrThrow({ where: { cleIdempotence: cle } })
    // Pas de traitement spécial pour ce cas : même backoff qu'un échec fournisseur
    // (D40), la ligne est reprogrammée plutôt que définitivement en échec.
    expect(relue.statut).toBe(StatutNotification.A_ENVOYER)
    expect(relue.tentatives).toBe(1)
    expect(relue.derniereErreur).toMatch(/sujet/i)
  })
})
