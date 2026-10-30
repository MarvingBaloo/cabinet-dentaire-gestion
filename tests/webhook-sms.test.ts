import { CanalNotification, StatutNotification, StatutRendezVous, TypeNotification } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/server/db/client'

// Ce que ces tests cherchent à prouver (phase 4, lot 4), dans l'ordre du brief :
//   - authentification du webhook : en-tête absent → 401, mauvais secret →
//     401, secret non configuré → 404, et rien n'est modifié dans les trois cas
//   - NON à plus de 24 h : rendez-vous annulé, manquement compté, notification
//     ANNULATION_PATIENT émise
//   - NON à moins de 24 h : rendez-vous inchangé, REPONSE_SMS « appelez le
//     cabinet » émise
//   - OUI sur A_CONFIRMER : passe CONFIRME
//   - même message entrant rejoué : traité une seule fois (idempotence)
//   - réponse d'un numéro sans rappel associé : ignorée, 200
//   - planifierRappels : attendReponse et texte du rappel selon la présence du
//     secret
//
// `BREVO_WEBHOOK_SECRET` est lu par `src/config/env.ts` à l'IMPORT du module,
// et par `route.ts` via ce même module — donc `vi.stubEnv` + `vi.resetModules`
// + réimport dynamique, comme `tests/env-app-url.test.ts` (même contrainte,
// même remède).

const SECRET = 'a'.repeat(32)
const URL = 'http://localhost/api/webhooks/brevo/sms'
const SUFFIXE = Date.now()

let compteurTelephones = 0
function telephone(): string {
  compteurTelephones += 1
  return `+3367${String(SUFFIXE).slice(-4)}${String(compteurTelephones).padStart(3, '0')}`
}

/** Le numéro tel que Brevo le rend en entrée : sans le `+` (voir
 *  `destinataireBrevo()`, src/server/sms/brevo.ts, et son inverse
 *  `normaliserTelephoneEntrant`). */
const sansPlus = (tel: string) => tel.slice(1)

let siteId: string
let praticienId: string
let fauteuilId: string
let motifId: string

const cree = { praticiens: [] as string[], fauteuils: [] as string[], motifs: [] as string[], patients: [] as string[] }
const messageIds: string[] = []

// Un compteur d'écart en plus des heures demandées : plusieurs tests de ce
// fichier utilisent le même `debutDansHeures` (72h, le plus loin dans
// l'horizon des rappels) sur le même fauteuil — sans décalage, deux
// rendez-vous créés à la même seconde se chevauchent et la contrainte
// d'exclusion de la base (`rdv_fauteuil_sans_chevauchement`) les refuse.
let decalageMinutes = 0

async function creerRdvAvecRappelEnvoye(params: {
  debutDansHeures: number
  statut?: StatutRendezVous
  attendReponse?: boolean
  envoyeeIlYA_ms?: number
}) {
  const tel = telephone()
  const patient = await prisma.patient.create({
    data: { nom: `Webhook${SUFFIXE}`, prenom: 'Test', telephone: tel },
    select: { id: true },
  })
  cree.patients.push(patient.id)

  decalageMinutes += 45
  const debut = new Date(Date.now() + params.debutDansHeures * 3_600_000 + decalageMinutes * 60_000)
  const rdv = await prisma.rendezVous.create({
    data: {
      patientId: patient.id,
      praticienId,
      siteId,
      fauteuilId,
      motifId,
      debut,
      fin: new Date(debut.getTime() + 30 * 60_000),
      statut: params.statut ?? StatutRendezVous.A_CONFIRMER,
    },
    select: { id: true, debut: true },
  })

  await prisma.notification.create({
    data: {
      type: TypeNotification.RAPPEL_H3,
      canal: CanalNotification.SMS,
      cleIdempotence: `test-webhook-sms-${SUFFIXE}-${tel}`,
      destinataire: tel,
      texte: 'rappel de test — répondez OUI pour confirmer, NON pour annuler',
      rendezVousId: rdv.id,
      rendezVousDebut: rdv.debut,
      siteId,
      statut: StatutNotification.ENVOYEE,
      attendReponse: params.attendReponse ?? true,
      envoyeeLe: new Date(Date.now() - (params.envoyeeIlYA_ms ?? 60_000)),
    },
  })

  return { telephone: tel, rendezVousId: rdv.id, debut: rdv.debut, patientId: patient.id }
}

function corpsReplied(tel: string, texte: string, messageId?: string) {
  const id = messageId ?? `${SUFFIXE}-${Math.random().toString(36).slice(2)}`
  messageIds.push(id)
  return {
    msg_status: 'replied',
    to: sansPlus(tel),
    reply: texte,
    messageId: id,
    ts_event: 1_700_000_000,
  }
}

function requetePost(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

/** Réimporte la route (et donc `@/config/env`) à froid, secret déjà stubé. */
async function importerPost() {
  vi.resetModules()
  const mod = await import('@/app/api/webhooks/brevo/sms/route')
  return mod.POST
}

beforeAll(async () => {
  siteId = (await prisma.site.findFirstOrThrow({ select: { id: true } })).id

  const p = await prisma.praticien.create({
    data: { nom: `Webhook${SUFFIXE}`, prenom: 'Test', titre: 'Chirurgien-dentiste', couleur: '#0078cc' },
    select: { id: true },
  })
  praticienId = p.id
  cree.praticiens.push(p.id)

  const f = await prisma.fauteuil.create({
    data: { siteId, nom: `Fauteuil webhook ${SUFFIXE}` },
    select: { id: true },
  })
  fauteuilId = f.id
  cree.fauteuils.push(f.id)

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Acte webhook ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc' },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

afterAll(async () => {
  const prefixe = `+3367${String(SUFFIXE).slice(-4)}`
  await prisma.notification.deleteMany({ where: { destinataire: { startsWith: prefixe } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  await prisma.webhookSmsEntrant.deleteMany({ where: { cleIdempotence: { in: messageIds.map((id) => `${id}:1700000000`) } } })
  await prisma.$disconnect()
})

describe('authentification du webhook', () => {
  it('secret non configuré → 404, rien n’est modifié', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', undefined)
    const POST = await importerPost()

    const { telephone: tel, rendezVousId } = await creerRdvAvecRappelEnvoye({ debutDansHeures: 72 })

    const reponse = await POST(requetePost(corpsReplied(tel, 'NON')))
    expect(reponse.status).toBe(404)

    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rendezVousId }, select: { statut: true } })
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)
  })

  it('en-tête Authorization absent → 401, rien n’est modifié', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', SECRET)
    const POST = await importerPost()

    const { telephone: tel, rendezVousId } = await creerRdvAvecRappelEnvoye({ debutDansHeures: 72 })

    const reponse = await POST(requetePost(corpsReplied(tel, 'NON')))
    expect(reponse.status).toBe(401)

    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rendezVousId }, select: { statut: true } })
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)
  })

  it('mauvais secret → 401, rien n’est modifié', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', SECRET)
    const POST = await importerPost()

    const { telephone: tel, rendezVousId } = await creerRdvAvecRappelEnvoye({ debutDansHeures: 72 })

    const reponse = await POST(
      requetePost(corpsReplied(tel, 'NON'), { authorization: 'Bearer mauvais-secret-mauvais-secret-mauvais' }),
    )
    expect(reponse.status).toBe(401)

    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rendezVousId }, select: { statut: true } })
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)
  })
})

describe('NON — annulation (D22/Q27)', () => {
  it('à plus de 24 h : rendez-vous annulé, manquement compté, ANNULATION_PATIENT émise', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', SECRET)
    const POST = await importerPost()

    const { telephone: tel, rendezVousId, patientId } = await creerRdvAvecRappelEnvoye({ debutDansHeures: 72 })
    const manquementsAvant = (await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { manquements: true } }))
      .manquements

    const reponse = await POST(requetePost(corpsReplied(tel, 'non'), { authorization: `Bearer ${SECRET}` }))
    expect(reponse.status).toBe(200)

    const rdv = await prisma.rendezVous.findUniqueOrThrow({
      where: { id: rendezVousId },
      select: { statut: true, manquementCompte: true },
    })
    expect(rdv.statut).toBe(StatutRendezVous.ANNULE)
    expect(rdv.manquementCompte).toBe(true)

    const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { manquements: true } })
    expect(patient.manquements).toBe(manquementsAvant + 1)

    const notifAnnulation = await prisma.notification.findFirst({
      where: { rendezVousId, type: TypeNotification.ANNULATION_PATIENT },
    })
    expect(notifAnnulation).toBeTruthy()
    expect(notifAnnulation?.destinataire).toBe(tel)
  })
})

describe('NON — trop tard (D22)', () => {
  it('à moins de 24 h : rendez-vous inchangé, REPONSE_SMS « appelez le cabinet » émise', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', SECRET)
    const POST = await importerPost()

    const { telephone: tel, rendezVousId } = await creerRdvAvecRappelEnvoye({ debutDansHeures: 3 })

    const reponse = await POST(requetePost(corpsReplied(tel, 'NON'), { authorization: `Bearer ${SECRET}` }))
    expect(reponse.status).toBe(200)

    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rendezVousId }, select: { statut: true } })
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)

    const notifReponse = await prisma.notification.findFirst({
      where: { rendezVousId, type: TypeNotification.REPONSE_SMS },
    })
    expect(notifReponse).toBeTruthy()
    expect(notifReponse?.texte).toMatch(/appelez le cabinet/i)
  })
})

describe('OUI — confirmation (Q26)', () => {
  it('sur A_CONFIRMER : passe CONFIRME', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', SECRET)
    const POST = await importerPost()

    const { telephone: tel, rendezVousId } = await creerRdvAvecRappelEnvoye({
      debutDansHeures: 72,
      statut: StatutRendezVous.A_CONFIRMER,
    })

    const reponse = await POST(requetePost(corpsReplied(tel, 'OUI'), { authorization: `Bearer ${SECRET}` }))
    expect(reponse.status).toBe(200)

    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rendezVousId }, select: { statut: true } })
    expect(rdv.statut).toBe(StatutRendezVous.CONFIRME)
  })
})

describe('idempotence du webhook', () => {
  it('le même message entrant rejoué n’est traité qu’une seule fois', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', SECRET)
    const POST = await importerPost()

    const { telephone: tel, rendezVousId, patientId } = await creerRdvAvecRappelEnvoye({ debutDansHeures: 72 })
    const manquementsAvant = (await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { manquements: true } }))
      .manquements

    const corps = corpsReplied(tel, 'NON', `rejeu-${SUFFIXE}`)

    const premiere = await POST(requetePost(corps, { authorization: `Bearer ${SECRET}` }))
    expect(premiere.status).toBe(200)

    const seconde = await POST(requetePost(corps, { authorization: `Bearer ${SECRET}` }))
    expect(seconde.status).toBe(200)

    const rdv = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rendezVousId }, select: { statut: true } })
    expect(rdv.statut).toBe(StatutRendezVous.ANNULE)

    // Le manquement n'a été compté qu'une fois : `ajusterManquement` est
    // idempotent (drapeau `manquementCompte`), le rejeu ne l'a jamais atteint
    // une seconde fois puisque le webhook l'a arrêté avant `traiterReponseSms`.
    const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { manquements: true } })
    expect(patient.manquements).toBe(manquementsAvant + 1)

    const notifs = await prisma.notification.findMany({
      where: { rendezVousId, type: TypeNotification.ANNULATION_PATIENT },
    })
    expect(notifs).toHaveLength(1)
  })
})

describe('numéro sans rappel associé', () => {
  it('réponse ignorée, 200 renvoyé à Brevo', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', SECRET)
    const POST = await importerPost()

    const telInconnu = telephone()
    const reponse = await POST(requetePost(corpsReplied(telInconnu, 'OUI'), { authorization: `Bearer ${SECRET}` }))
    expect(reponse.status).toBe(200)

    const notifs = await prisma.notification.findMany({ where: { destinataire: telInconnu } })
    expect(notifs).toHaveLength(0)
  })
})

describe('planifierRappels — attendReponse et texte selon la présence du secret', () => {
  it('sans secret : attendReponse=false, le rappel donne le lien vers l’espace patient', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', undefined)
    vi.resetModules()
    const { planifierRappels } = await import('@/server/notifications/rappels')
    const { prisma: prismaFrais } = await import('@/server/db/client')

    const { telephone: tel, rendezVousId } = await creerRdvSansRappelDirect(60)

    await planifierRappels(new Date())

    const notif = await prismaFrais.notification.findFirstOrThrow({
      where: { rendezVousId, type: TypeNotification.RAPPEL_J2 },
    })
    expect(notif.attendReponse).toBe(false)
    expect(notif.texte).toMatch(/Pour le gérer : https?:\/\/\S+\/mes-rendez-vous/)
    expect(notif.texte).not.toMatch(/OUI/)

    await prisma.notification.deleteMany({ where: { destinataire: tel } })
  })

  it('avec secret : attendReponse=true, texte « répondez OUI »', async () => {
    vi.stubEnv('BREVO_WEBHOOK_SECRET', SECRET)
    vi.resetModules()
    const { planifierRappels } = await import('@/server/notifications/rappels')
    const { prisma: prismaFrais } = await import('@/server/db/client')

    const { telephone: tel, rendezVousId } = await creerRdvSansRappelDirect(61)

    await planifierRappels(new Date())

    const notif = await prismaFrais.notification.findFirstOrThrow({
      where: { rendezVousId, type: TypeNotification.RAPPEL_J2 },
    })
    expect(notif.attendReponse).toBe(true)
    expect(notif.texte).toMatch(/répondez oui/i)

    await prisma.notification.deleteMany({ where: { destinataire: tel } })
  })
})

// `planifierRappels` ne cherche que les rendez-vous dans les 72h — cette
// fixture-ci n'émet PAS de rappel au préalable (contrairement à
// `creerRdvAvecRappelEnvoye`, qui simule un rappel déjà ENVOYE) : c'est
// `planifierRappels` lui-même qui doit l'émettre, donc le début est choisi
// dans les 72h mais suffisamment loin (>48h) pour que le J-2 soit dû.
async function creerRdvSansRappelDirect(dansHeures: number) {
  const tel = telephone()
  const patient = await prisma.patient.create({
    data: { nom: `WebhookRappel${SUFFIXE}`, prenom: 'Test', telephone: tel },
    select: { id: true },
  })
  cree.patients.push(patient.id)
  const debut = new Date(Date.now() + dansHeures * 3_600_000)
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
  return { telephone: tel, rendezVousId: rdv.id }
}
