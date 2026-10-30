import { RoleName, SiteCode } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { paire, quandCourt } from '@/server/domaine/chat'
import { compterNonLus, listerConversations, lireConversation } from '@/server/queries/chat'
import { ChatError, envoyerMessage, marquerLu, reglerSon } from '@/server/services/chat'
import { type EvenementChat, abonnerChat, arreterEcouteChat } from '@/server/temps-reel/chat'

// Le chat interne (D82) : une conversation par paire, les non-lus, le cloisonnement des conversations et des
// citations, et le signal en direct. Sur des comptes, un fauteuil, un motif et des patients propres à ce fichier.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let siteMG: string
let ctxSecretaire: AuthContext
let ctxRiviere: AuthContext
let ctxMorel: AuthContext
let idSecretaire: string
let idRiviere: string
let idMorel: string
let patientRiviere: string
let patientMorel: string
let rdvMorel: string

const cree = {
  users: [] as string[],
  praticiens: [] as string[],
  patients: [] as string[],
  fauteuils: [] as string[],
  motifs: [] as string[],
}

async function compte(roles: RoleName[], cle: string) {
  const ids = await prisma.role.findMany({ where: { name: { in: roles } }, select: { id: true } })
  const u = await prisma.user.create({
    data: {
      email: `chat-${cle}-${SUFFIXE}@test.local`,
      nom: `Chat${cle}`,
      prenom: cle,
      passwordHash: 'x',
      roles: { create: ids.map((r) => ({ roleId: r.id })) },
      sites: { create: [{ siteId: siteMG }] },
    },
    select: { id: true },
  })
  cree.users.push(u.id)
  return u.id
}

async function contexte(id: string) {
  const ctx = await loadAuthContext(id, ORIGINE)
  if (!ctx) throw new Error('Contexte introuvable')
  return ctx
}

function prochain(recus: EvenementChat[], delaiMs = 3000): Promise<EvenementChat | null> {
  const depart = recus.length
  return new Promise((ok) => {
    const t0 = Date.now()
    const tic = setInterval(() => {
      if (recus.length > depart) {
        clearInterval(tic)
        ok(recus[depart]!)
      } else if (Date.now() - t0 > delaiMs) {
        clearInterval(tic)
        ok(null)
      }
    }, 25)
  })
}

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  idSecretaire = await compte([RoleName.SECRETAIRE], 'sec')
  idRiviere = await compte([RoleName.PRATICIEN], 'riviere')
  idMorel = await compte([RoleName.PRATICIEN], 'morel')
  const riviere = await prisma.praticien.create({
    data: { userId: idRiviere, nom: `Riviere${SUFFIXE}`, prenom: 'Claire', couleur: '#0078cc' },
  })
  const morel = await prisma.praticien.create({
    data: { userId: idMorel, nom: `Morel${SUFFIXE}`, prenom: 'Paul', couleur: '#c2185b' },
  })
  cree.praticiens.push(riviere.id, morel.id)
  const fauteuil = await prisma.fauteuil.create({ data: { siteId: siteMG, nom: `Fauteuil chat ${SUFFIXE}` } })
  cree.fauteuils.push(fauteuil.id)
  const motif = await prisma.motifConsultation.create({
    data: { libelle: `Chat ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc', ordre: 9100 },
  })
  cree.motifs.push(motif.id)
  const [pR, pM] = await Promise.all([
    prisma.patient.create({ data: { nom: `ChatDupont${SUFFIXE}`, prenom: 'Marie', telephone: '+33600000011' } }),
    prisma.patient.create({ data: { nom: `ChatMartin${SUFFIXE}`, prenom: 'Jules', telephone: '+33600000012' } }),
  ])
  patientRiviere = pR.id
  patientMorel = pM.id
  cree.patients.push(pR.id, pM.id)
  const rdv = (praticienId: string, patientId: string, jour: number) =>
    prisma.rendezVous.create({
      data: {
        patientId,
        praticienId,
        siteId: siteMG,
        fauteuilId: fauteuil.id,
        motifId: motif.id,
        debut: new Date(Date.UTC(2028, 3, jour, 13, 0)),
        fin: new Date(Date.UTC(2028, 3, jour, 13, 30)),
        statut: 'CONFIRME',
      },
      select: { id: true },
    })
  await rdv(riviere.id, patientRiviere, 3)
  rdvMorel = (await rdv(morel.id, patientMorel, 4)).id
  ;[ctxSecretaire, ctxRiviere, ctxMorel] = await Promise.all([
    contexte(idSecretaire),
    contexte(idRiviere),
    contexte(idMorel),
  ])
})

afterAll(async () => {
  await arreterEcouteChat()
  await prisma.conversationChat.deleteMany({
    where: { OR: [{ userAId: { in: cree.users } }, { userBId: { in: cree.users } }] },
  })
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  // Le journal d'audit les cite : les comptes se désactivent, ils ne se suppriment pas (D9).
  await prisma.user.updateMany({ where: { id: { in: cree.users } }, data: { actif: false } })
})

describe('sans base', () => {
  it('la paire est la même quel que soit celui qui écrit', () => {
    expect(paire('b', 'a')).toEqual(paire('a', 'b'))
    expect(paire('a', 'b')).toEqual({ userAId: 'a', userBId: 'b' })
  })

  it('l’heure d’un message : l’heure aujourd’hui, « hier », puis le jour', () => {
    const maintenant = new Date('2027-08-12T15:00:00Z')
    expect(quandCourt(new Date('2027-08-12T14:14:00Z'), maintenant)).toBe('10:14')
    expect(quandCourt(new Date('2027-08-11T14:14:00Z'), maintenant)).toBe('hier')
    expect(quandCourt(new Date('2027-08-09T14:14:00Z'), maintenant)).toMatch(/^lun\.? 9 août/)
  })
})

describe('écrire à un collègue', () => {
  it('une seule conversation entre deux personnes ; les non-lus montent, puis retombent à la lecture', async () => {
    await envoyerMessage(ctxSecretaire, {
      collegueId: idRiviere,
      texte: '  Mme Dupont arrive 10 min plus tard.  ',
      cite: null,
    })
    await envoyerMessage(ctxRiviere, { collegueId: idSecretaire, texte: 'Je la décale à 8 h 30.', cite: null })
    await envoyerMessage(ctxSecretaire, { collegueId: idRiviere, texte: 'Parfait.', cite: null })
    expect(await prisma.conversationChat.count({ where: paire(idSecretaire, idRiviere) })).toBe(1)

    expect(await compterNonLus(ctxRiviere)).toBe(2)
    const lue = await lireConversation(ctxRiviere, idSecretaire)
    expect(lue?.messages.map((m) => [m.texte, m.deMoi])).toEqual([
      ['Mme Dupont arrive 10 min plus tard.', false],
      ['Je la décale à 8 h 30.', true],
      ['Parfait.', false],
    ])
    const ligne = (await listerConversations(ctxRiviere)).find((l) => l.collegue.id === idSecretaire)
    expect(ligne?.nonLus).toBe(2)
    expect(ligne?.dernier).toMatchObject({ texte: 'Parfait.', deMoi: false })

    expect(await marquerLu(ctxRiviere, idSecretaire)).toBe(2)
    expect(await compterNonLus(ctxRiviere)).toBe(0)
    // Les messages de Rivière, eux, restent non lus pour la secrétaire.
    expect(await compterNonLus(ctxSecretaire)).toBe(1)
  })

  it('un tiers ne lit pas la conversation des autres', async () => {
    const vue = await lireConversation(ctxMorel, idSecretaire)
    expect(vue?.messages).toEqual([])
    const ligne = (await listerConversations(ctxMorel)).find((l) => l.collegue.id === idRiviere)
    expect(ligne?.dernier).toBeNull()
  })

  it('refuse un message vide, à soi-même, ou à un compte désactivé', async () => {
    await expect(
      envoyerMessage(ctxSecretaire, { collegueId: idRiviere, texte: '   ', cite: null }),
    ).rejects.toBeInstanceOf(ChatError)
    await expect(
      envoyerMessage(ctxSecretaire, { collegueId: idSecretaire, texte: 'moi', cite: null }),
    ).rejects.toBeInstanceOf(ChatError)
    await prisma.user.update({ where: { id: idMorel }, data: { actif: false } })
    try {
      await expect(
        envoyerMessage(ctxSecretaire, { collegueId: idMorel, texte: 'Bonjour', cite: null }),
      ).rejects.toBeInstanceOf(ChatError)
      expect((await listerConversations(ctxSecretaire)).some((l) => l.collegue.id === idMorel)).toBe(false)
    } finally {
      await prisma.user.update({ where: { id: idMorel }, data: { actif: true } })
    }
  })
})

describe('citer un patient ou un rendez-vous', () => {
  it('la secrétaire cite un rendez-vous du Dr Morel ; le Dr Morel l’ouvre, le Dr Rivière ne voit pas le patient', async () => {
    await envoyerMessage(ctxSecretaire, {
      collegueId: idMorel,
      texte: 'Il demande à avancer.',
      cite: { type: 'rendezVous', id: rdvMorel },
    })
    const vueMorel = await lireConversation(ctxMorel, idSecretaire)
    expect(vueMorel?.messages.at(-1)?.citation).toMatchObject({
      accessible: true,
      href: expect.stringContaining(`rdv=${rdvMorel}`),
    })

    await envoyerMessage(ctxSecretaire, {
      collegueId: idRiviere,
      texte: 'Pour info.',
      cite: { type: 'patient', id: patientMorel },
    })
    const vueRiviere = await lireConversation(ctxRiviere, idSecretaire)
    expect(vueRiviere?.messages.at(-1)?.citation).toEqual({ accessible: false })
  })

  it('un praticien qui n’administre pas ne cite que ses patients', async () => {
    await expect(
      envoyerMessage(ctxRiviere, {
        collegueId: idSecretaire,
        texte: 'Et lui ?',
        cite: { type: 'patient', id: patientMorel },
      }),
    ).rejects.toBeInstanceOf(ChatError)
    await expect(
      envoyerMessage(ctxRiviere, {
        collegueId: idSecretaire,
        texte: 'Et lui ?',
        cite: { type: 'rendezVous', id: rdvMorel },
      }),
    ).rejects.toBeInstanceOf(ChatError)
    await envoyerMessage(ctxRiviere, {
      collegueId: idSecretaire,
      texte: 'Ma patiente.',
      cite: { type: 'patient', id: patientRiviere },
    })
  })
})

describe('en direct', () => {
  it('le destinataire est prévenu (pour lui), l’auteur aussi (pour rafraîchir), un tiers non ; la lecture prévient le lecteur', async () => {
    const recusRiviere: EvenementChat[] = []
    const recusSecretaire: EvenementChat[] = []
    const recusMorel: EvenementChat[] = []
    const fins = await Promise.all([
      abonnerChat(ctxRiviere, (e) => recusRiviere.push(e)),
      abonnerChat(ctxSecretaire, (e) => recusSecretaire.push(e)),
      abonnerChat(ctxMorel, (e) => recusMorel.push(e)),
    ])
    const [aR, aS, aM] = [prochain(recusRiviere), prochain(recusSecretaire), prochain(recusMorel, 1500)]
    await envoyerMessage(ctxSecretaire, { collegueId: idRiviere, texte: 'Le labo a appelé.', cite: null })
    expect(await aR).toEqual({ op: 'message', de: idSecretaire, pourMoi: true })
    expect(await aS).toEqual({ op: 'message', de: idSecretaire, pourMoi: false })
    expect(await aM).toBeNull()

    const lu = prochain(recusRiviere)
    await marquerLu(ctxRiviere, idSecretaire)
    expect(await lu).toEqual({ op: 'lu', de: null, pourMoi: false })
    for (const fin of fins) fin()
  })
})

describe('le son', () => {
  it('se coupe et se rallume, pour soi seul', async () => {
    await reglerSon(ctxSecretaire, true)
    const [s, r] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: idSecretaire }, select: { chatSonCoupe: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: idRiviere }, select: { chatSonCoupe: true } }),
    ])
    expect(s.chatSonCoupe).toBe(true)
    expect(r.chatSonCoupe).toBe(false)
    await reglerSon(ctxSecretaire, false)
  })
})
