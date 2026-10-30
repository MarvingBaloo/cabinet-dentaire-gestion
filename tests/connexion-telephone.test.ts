import { RoleName } from '@prisma/client'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { accorderConfiance, estPosteDeConfiance } from '@/server/auth/confiance'
import { demarrerConnexion, renvoyerCode } from '@/server/auth/connexion'
import { hashPassword } from '@/server/auth/password'
import { declarerPoste, estUnTelephone } from '@/server/auth/poste'
import { resoudreSession } from '@/server/auth/session'
import {
  approuver,
  decrireDemande,
  etatValidation,
  modeSecondFacteur,
  preparerValidation,
  refuser,
} from '@/server/auth/telephone'
import { prisma } from '@/server/db/client'
import { type Message, type Transporteur, definirTransporteur, transporteurConsole } from '@/server/sms/envoi'

// La connexion validée depuis le téléphone (D83). Ce qui s'éprouve ici : seul un téléphone de confiance pour la
// personne qui se connecte peut ouvrir le poste ; « Non » coupe la tentative ; un QR ne sert qu'une fois et pas
// longtemps ; le SMS reste possible.

const SUFFIXE = Date.now()
const IP_TEST = `10.${(SUFFIXE >> 16) & 255}.${(SUFFIXE >> 8) & 255}.${(SUFFIXE + 7) & 255}`
const MOT_DE_PASSE = 'unmotdepassesuffisammentlong'

const envoyes: Message[] = []
const espion: Transporteur = {
  nom: 'espion',
  async envoyer(message) {
    envoyes.push(message)
    return { ok: true, reference: 'espion' }
  },
}

beforeEach(() => {
  envoyes.length = 0
  definirTransporteur(espion)
})

afterEach(() => {
  definirTransporteur(transporteurConsole)
})

afterAll(async () => {
  await prisma.$disconnect()
})

let compteur = 0
async function creerCompte() {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SECRETAIRE } })
  return prisma.user.create({
    data: {
      email: `telephone-${SUFFIXE}-${compteur++}@test.local`,
      nom: 'Lacour',
      prenom: 'Nadège',
      passwordHash: await hashPassword(MOT_DE_PASSE),
      telephoneMobile: '+590690112233',
      roles: { create: { roleId: role.id } },
    },
    select: { id: true, email: true },
  })
}

/** Un téléphone, de confiance pour cette personne : elle s'y est déjà connectée avec le code SMS. */
async function telephoneDe(userId: string) {
  const { poste } = await declarerPoste()
  await prisma.workstation.update({ where: { id: poste.id }, data: { telephone: true } })
  await accorderConfiance(userId, poste.id)
  return { ipAddress: IP_TEST, userAgent: 'iPhone', workstationId: poste.id }
}

/** Nadège tape son mot de passe sur un poste qui ne la connaît pas encore. */
async function connexionSurUnPoste(email: string) {
  const { poste } = await declarerPoste()
  const origine = { ipAddress: IP_TEST, userAgent: 'vitest', workstationId: poste.id }
  const r = await demarrerConnexion(email, MOT_DE_PASSE, origine)
  if (r.etat !== 'telephone_requis') throw new Error(`état inattendu : ${r.etat}`)
  return { ...r, origine, posteId: poste.id }
}

describe('le poste propose le QR, pas le SMS', () => {
  it('avec un téléphone de confiance, aucun SMS ne part', async () => {
    const u = await creerCompte()
    await telephoneDe(u.id)
    const r = await connexionSurUnPoste(u.email)
    expect(envoyes).toHaveLength(0)
    expect(await modeSecondFacteur(r.sessionId)).toBe('telephone')
    expect((await resoudreSession(r.jeton, r.origine)).etat).toBe('mfa_requis')
  })

  it('sans téléphone reconnu, le SMS part comme avant — un autre ordinateur de confiance ne compte pas', async () => {
    const u = await creerCompte()
    const { poste: autrePc } = await declarerPoste()
    await accorderConfiance(u.id, autrePc.id)
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, { ipAddress: IP_TEST })
    expect(r.etat).toBe('mfa_requis')
    expect(envoyes).toHaveLength(1)
  })

  it('« Recevoir plutôt un code par SMS » : le code part et l’écran passe à sa saisie', async () => {
    const u = await creerCompte()
    await telephoneDe(u.id)
    const r = await connexionSurUnPoste(u.email)
    expect((await renvoyerCode(r.sessionId)).etat).toBe('envoye')
    expect(envoyes).toHaveLength(1)
    expect(await modeSecondFacteur(r.sessionId)).toBe('sms')
  })
})

describe('« Oui, c’est moi »', () => {
  it('ouvre le poste, qui devient de confiance, et le journal le dit', async () => {
    const u = await creerCompte()
    const telephone = await telephoneDe(u.id)
    const r = await connexionSurUnPoste(u.email)
    const jeton = await preparerValidation(r.sessionId)

    const demande = await decrireDemande(jeton, telephone.workstationId)
    expect(demande).toMatchObject({ etat: 'a_confirmer', prenom: 'Nadège', nom: 'Lacour' })

    expect((await approuver(jeton, telephone)).etat).toBe('fait')
    expect((await resoudreSession(r.jeton, r.origine)).etat).toBe('valide')
    expect(await estPosteDeConfiance(u.id, r.posteId)).toBe(true)
    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: u.id, action: 'LOGIN_SUCCESS' },
    })
    expect(trace.deniedReason).toBe('second facteur : validé depuis le téléphone')
    expect(trace.workstationId).toBe(r.posteId)
  })

  it('un QR ne sert qu’une fois', async () => {
    const u = await creerCompte()
    const telephone = await telephoneDe(u.id)
    const r = await connexionSurUnPoste(u.email)
    const jeton = await preparerValidation(r.sessionId)
    expect((await approuver(jeton, telephone)).etat).toBe('fait')
    expect((await approuver(jeton, telephone)).etat).toBe('perimee')
  })

  it('un QR expiré, ou remplacé par un nouveau, ne vaut plus rien', async () => {
    const u = await creerCompte()
    const telephone = await telephoneDe(u.id)
    const r = await connexionSurUnPoste(u.email)

    const ancien = await preparerValidation(r.sessionId)
    await preparerValidation(r.sessionId)
    expect((await approuver(ancien, telephone)).etat).toBe('perimee')

    const jeton = await preparerValidation(r.sessionId)
    await prisma.validationTelephone.update({
      where: { sessionId: r.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect(await etatValidation(r.sessionId)).toBe('expire')
    expect((await approuver(jeton, telephone)).etat).toBe('perimee')
    expect((await resoudreSession(r.jeton, r.origine)).etat).toBe('mfa_requis')
  })
})

describe('celui qui a volé le mot de passe', () => {
  it('scanne avec son propre téléphone : refusé, sans apprendre qui se connecte', async () => {
    const u = await creerCompte()
    await telephoneDe(u.id)
    const r = await connexionSurUnPoste(u.email)
    const jeton = await preparerValidation(r.sessionId)

    const { poste: sonTelephone } = await declarerPoste()
    await prisma.workstation.update({ where: { id: sonTelephone.id }, data: { telephone: true } })
    const origine = { ipAddress: IP_TEST, userAgent: 'iPhone', workstationId: sonTelephone.id }

    expect(await decrireDemande(jeton, sonTelephone.id)).toEqual({ etat: 'non_reconnu' })
    expect((await approuver(jeton, origine)).etat).toBe('non_reconnu')
    expect((await resoudreSession(r.jeton, r.origine)).etat).toBe('mfa_requis')
    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: u.id, action: 'LOGIN_FAILURE', workstationId: sonTelephone.id },
    })
    expect(trace.deniedReason).toBe('QR de connexion utilisé par un appareil non reconnu')
  })

  it('le téléphone d’une collègue ne valide pas la connexion de Nadège', async () => {
    const u = await creerCompte()
    await telephoneDe(u.id)
    const collegue = await creerCompte()
    const telephoneCollegue = await telephoneDe(collegue.id)
    const r = await connexionSurUnPoste(u.email)
    const jeton = await preparerValidation(r.sessionId)
    expect((await approuver(jeton, telephoneCollegue)).etat).toBe('non_reconnu')
  })

  it('sans appareil identifié, rien à valider', async () => {
    const u = await creerCompte()
    await telephoneDe(u.id)
    const r = await connexionSurUnPoste(u.email)
    const jeton = await preparerValidation(r.sessionId)
    expect((await approuver(jeton, { ipAddress: IP_TEST })).etat).toBe('non_reconnu')
  })
})

describe('« Non, ce n’est pas moi »', () => {
  it('coupe la tentative : le poste reste fermé et le journal le garde', async () => {
    const u = await creerCompte()
    const telephone = await telephoneDe(u.id)
    const r = await connexionSurUnPoste(u.email)
    const jeton = await preparerValidation(r.sessionId)

    expect((await refuser(jeton, telephone)).etat).toBe('fait')
    expect((await resoudreSession(r.jeton, r.origine)).etat).toBe('revoquee')
    expect(await etatValidation(r.sessionId)).toBe('refuse')
    expect(await estPosteDeConfiance(u.id, r.posteId)).toBe(false)
    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: u.id, action: 'LOGIN_FAILURE', deniedReason: 'connexion refusée depuis le téléphone' },
    })
    expect(trace.workstationId).toBe(r.posteId)
  })
})

describe('reconnaître un téléphone à son navigateur', () => {
  it('iPhone et Android mobile, pas un ordinateur ni une tablette Android', () => {
    expect(
      estUnTelephone('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'),
    ).toBe(true)
    expect(estUnTelephone('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36')).toBe(
      true,
    )
    expect(estUnTelephone('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toBe(
      false,
    )
    expect(estUnTelephone('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Safari/537.36')).toBe(false)
    expect(estUnTelephone(null)).toBe(false)
  })
})
