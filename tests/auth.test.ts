import { RoleName } from '@prisma/client'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { estPosteDeConfiance } from '@/server/auth/confiance'
import { declarerPoste } from '@/server/auth/poste'
import { demarrerConnexion, deconnecter, renvoyerCode, validerSecondFacteur } from '@/server/auth/connexion'
import { hashPassword } from '@/server/auth/password'
import { resoudreSession, revoquerToutesLesSessions } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import {
  type Message,
  type Transporteur,
  definirTransporteur,
  transporteurConsole,
} from '@/server/sms/envoi'

const SUFFIXE = Date.now()

// IP propre à chaque exécution : la limitation par adresse compte les échecs
// récents d'une même origine, et ces tests en produisent une douzaine. Sans
// cela, deux exécutions à quinze minutes d'intervalle se bloqueraient l'une
// l'autre — un test qui échoue selon l'heure à laquelle on le lance.
const IP_TEST = `10.${(SUFFIXE >> 16) & 255}.${(SUFFIXE >> 8) & 255}.${SUFFIXE & 255}`
const ORIGINE = { ipAddress: IP_TEST, userAgent: 'vitest' }
const MOT_DE_PASSE = 'unmotdepassesuffisammentlong'
const MOBILE = '+590690112233'

/** Capture les SMS au lieu de les envoyer, et rend le code qu'ils portent. */
const envoyes: Message[] = []
const espion: Transporteur = {
  nom: 'espion',
  async envoyer(message) {
    envoyes.push(message)
    return { ok: true, reference: 'espion' }
  },
}

/** Le code du dernier SMS parti — ce que l'utilisateur lirait sur son téléphone. */
function dernierCode(): string {
  const dernier = envoyes.at(-1)
  if (!dernier) throw new Error('Aucun SMS envoyé')
  const trouve = dernier.texte.match(/\b(\d{6})\b/)
  if (!trouve) throw new Error(`Aucun code dans le SMS : ${dernier.texte}`)
  return trouve[1]!
}

beforeEach(() => {
  envoyes.length = 0
  definirTransporteur(espion)
})

afterEach(() => {
  definirTransporteur(transporteurConsole)
})

let compteur = 0
async function creerCompte(options: { actif?: boolean; mobile?: string | null } = {}) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SECRETAIRE } })
  return prisma.user.create({
    data: {
      email: `auth-${SUFFIXE}-${compteur++}@test.local`,
      nom: 'Test',
      prenom: 'Auth',
      passwordHash: await hashPassword(MOT_DE_PASSE),
      actif: options.actif ?? true,
      // Par défaut le compte a un numéro : c'est le cas courant. `null` sert à
      // éprouver le compte qu'on ne peut pas joindre.
      telephoneMobile: options.mobile === undefined ? MOBILE : options.mobile,
      roles: { create: { roleId: role.id } },
    },
    select: { id: true, email: true },
  })
}

afterAll(async () => {
  await prisma.$disconnect()
})

// Le code à usage unique remplace le TOTP (D7, révisée le 2026-09-15). Ce qui
// s'éprouve ici : qu'il parte vraiment, qu'il ne serve qu'une fois, qu'il
// expire, et que les essais soient comptés.
describe('code à usage unique par SMS', () => {
  it('un code à six chiffres part sur le numéro du compte', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)

    expect(r.etat).toBe('mfa_requis')
    expect(envoyes).toHaveLength(1)
    expect(envoyes[0]!.destinataire).toBe(MOBILE)
    expect(dernierCode()).toMatch(/^\d{6}$/)
  })

  it('le numéro n’est jamais affiché en entier', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('attendu mfa_requis')

    // Assez pour se reconnaître, pas assez pour désigner quelqu'un.
    expect(r.masque).not.toContain('690112233')
    expect(r.masque.endsWith('33')).toBe(true)
  })

  it('le code n’est pas stocké en clair', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('attendu mfa_requis')

    const enregistre = await prisma.codeSms.findUniqueOrThrow({
      where: { sessionId: r.sessionId },
    })
    expect(enregistre.codeHash).not.toBe(dernierCode())
    expect(enregistre.codeHash.length).toBeGreaterThan(20)
  })

  it('un code ne sert qu’une fois', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('attendu mfa_requis')
    const code = dernierCode()

    expect((await validerSecondFacteur(r.sessionId, code, ORIGINE)).etat).toBe('connecte')
    // Rejoué, il ne vaut plus rien : le premier usage l'a détruit.
    expect((await validerSecondFacteur(r.sessionId, code, ORIGINE)).etat).toBe('session_invalide')
  })

  it('trois essais ratés et le code est détruit', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('attendu mfa_requis')

    const premier = await validerSecondFacteur(r.sessionId, '000000', ORIGINE)
    expect(premier.etat).toBe('code_invalide')
    if (premier.etat === 'code_invalide') expect(premier.tentativesRestantes).toBe(2)

    await validerSecondFacteur(r.sessionId, '000000', ORIGINE)
    expect((await validerSecondFacteur(r.sessionId, '000000', ORIGINE)).etat).toBe(
      'trop_de_tentatives',
    )

    // Même le bon code ne passe plus : il n'existe simplement plus.
    expect((await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)).etat).toBe(
      'session_invalide',
    )
  })

  it('un code expiré est refusé', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('attendu mfa_requis')

    await prisma.codeSms.update({
      where: { sessionId: r.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    expect((await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)).etat).toBe(
      'code_expire',
    )
  })

  it('demander un nouveau code invalide le précédent', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('attendu mfa_requis')
    const ancien = dernierCode()

    const renvoi = await renvoyerCode(r.sessionId)
    expect(renvoi.etat).toBe('envoye')
    expect(envoyes).toHaveLength(2)

    // Deux codes valides en circulation rendraient la limite d'essais illusoire.
    expect((await validerSecondFacteur(r.sessionId, ancien, ORIGINE)).etat).toBe('code_invalide')
    expect((await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)).etat).toBe('connecte')
  })

  it('un compte sans numéro ne peut pas recevoir de code — et le dit', async () => {
    const u = await creerCompte({ mobile: null })
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)

    // Ni connecté, ni « mot de passe incorrect » : le mot de passe était bon.
    expect(r.etat).toBe('numero_manquant')
    expect(envoyes).toHaveLength(0)
  })

  it('le nombre d’envois par heure est borné', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('attendu mfa_requis')

    // Sans cette borne, une boucle sur le formulaire ferait grimper la facture
    // et saturerait le téléphone de la personne visée.
    const resultats = []
    for (let i = 0; i < 6; i++) resultats.push(await renvoyerCode(r.sessionId))

    expect(resultats.some((x) => x.etat === 'impossible')).toBe(true)
  })
})

describe('connexion — premier facteur', () => {
  it('refuse un identifiant inconnu et le journalise', async () => {
    const adresse = `inconnu-${SUFFIXE}@test.local`
    const r = await demarrerConnexion(adresse, MOT_DE_PASSE, ORIGINE)
    expect(r.etat).toBe('identifiants_invalides')

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'LOGIN_FAILURE', actorEmail: adresse },
    })
    expect(trace.succeeded).toBe(false)
    expect(trace.actorId).toBeNull()
    expect(trace.deniedReason).toBe('identifiant inconnu')
  })

  it('refuse un mauvais mot de passe et incrémente le compteur d’échecs', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, 'mauvais mot de passe', ORIGINE)
    expect(r.etat).toBe('identifiants_invalides')

    const apres = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(apres.failedLoginCount).toBe(1)
  })

  it('verrouille le compte après 5 échecs', async () => {
    const u = await creerCompte()
    for (let i = 0; i < 5; i++) await demarrerConnexion(u.email, 'faux', ORIGINE)

    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    expect(r.etat).toBe('compte_verrouille')

    // Le bon mot de passe ne doit PAS déverrouiller : sinon le verrou ne
    // protégerait que celui qui ne connaît pas le mot de passe.
    const apres = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(apres.lockedUntil).not.toBeNull()
  })

  it('remet le compteur à zéro après une connexion réussie', async () => {
    const u = await creerCompte()
    await demarrerConnexion(u.email, 'faux', ORIGINE)
    await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)

    const apres = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(apres.failedLoginCount).toBe(0)
  })


  it('un compte désactivé est refusé — mais seulement après le mot de passe', async () => {
    const u = await creerCompte({ actif: false })
    expect((await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)).etat).toBe('compte_desactive')
    expect((await demarrerConnexion(u.email, 'faux', ORIGINE)).etat).toBe('identifiants_invalides')
  })
})

describe('connexion — second facteur et session', () => {
  it('la session n’ouvre AUCUN droit avant validation du second facteur', async () => {
    const u = await creerCompte()

    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    expect(r.etat).toBe('mfa_requis')
    if (r.etat !== 'mfa_requis') return

    const avant = await resoudreSession(r.jeton, ORIGINE)
    expect(avant.etat).toBe('mfa_requis')
    expect(avant).not.toHaveProperty('ctx')

    expect((await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)).etat).toBe(
      'connecte',
    )

    const apres = await resoudreSession(r.jeton, ORIGINE)
    expect(apres.etat).toBe('valide')
    if (apres.etat !== 'valide') return
    expect(apres.ctx.email).toBe(u.email)
    expect(apres.ctx.roles).toEqual([RoleName.SECRETAIRE])
  })

  it('refuse un mauvais code et le journalise', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('état inattendu')

    expect((await validerSecondFacteur(r.sessionId, '000000', ORIGINE)).etat).toBe('code_invalide')

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: u.id, action: 'LOGIN_FAILURE' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(trace.deniedReason).toBe('second facteur : invalide')
  })

  it('journalise la connexion réussie', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('état inattendu')

    await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: u.id, action: 'LOGIN_SUCCESS' },
    })
    expect(trace.succeeded).toBe(true)
  })

  it('un jeton inconnu ne donne rien', async () => {
    expect((await resoudreSession('jeton-inventé', ORIGINE)).etat).toBe('absente')
    expect((await resoudreSession(undefined, ORIGINE)).etat).toBe('absente')
  })

  // Le jeton en clair ne doit exister que dans le cookie : un export de la base
  // ne doit pas permettre d'usurper une session ouverte.
  it('la base ne stocke que le condensat du jeton', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('état inattendu')

    const session = await prisma.session.findUniqueOrThrow({ where: { id: r.sessionId } })
    expect(session.sessionToken).not.toBe(r.jeton)
    expect(session.sessionToken).toHaveLength(64) // sha256 en hexadécimal
  })

  it('le verrouillage sur inactivité révoque la session', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)

    await prisma.session.update({
      where: { id: r.sessionId },
      data: { lastActivityAt: new Date(Date.now() - 60 * 60_000) },
    })

    expect((await resoudreSession(r.jeton, ORIGINE)).etat).toBe('inactivite')

    // Révoquée, et non simplement ignorée : rafraîchir la page ne doit pas
    // rendre le poste utilisable à nouveau.
    expect((await resoudreSession(r.jeton, ORIGINE)).etat).toBe('revoquee')
  })

  // D61 : le flux de l'agenda en direct reste ouvert sans geste de la personne.
  // S'il prolongeait la session, un poste abandonné ne serait jamais verrouillé.
  it('une lecture sans prolongation laisse courir le délai d’inactivité', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)

    const ilYa = new Date(Date.now() - 5 * 60_000)
    await prisma.session.update({ where: { id: r.sessionId }, data: { lastActivityAt: ilYa } })

    expect((await resoudreSession(r.jeton, ORIGINE, { prolonger: false })).etat).toBe('valide')
    const apres = await prisma.session.findUniqueOrThrow({ where: { id: r.sessionId } })
    expect(apres.lastActivityAt.getTime()).toBe(ilYa.getTime())

    expect((await resoudreSession(r.jeton, ORIGINE)).etat).toBe('valide')
    const prolongee = await prisma.session.findUniqueOrThrow({ where: { id: r.sessionId } })
    expect(prolongee.lastActivityAt.getTime()).toBeGreaterThan(ilYa.getTime())
  })

  it('la déconnexion invalide immédiatement le jeton', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)

    await deconnecter(r.sessionId, { id: u.id, email: u.email }, ORIGINE)

    expect((await resoudreSession(r.jeton, ORIGINE)).etat).toBe('revoquee')
    await prisma.auditLog.findFirstOrThrow({ where: { actorId: u.id, action: 'LOGOUT' } })
  })

  // C'est précisément ce qu'un JWT ne saurait pas faire (D6).
  it('désactiver le compte fait tomber la session en cours', async () => {
    const u = await creerCompte()
    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (r.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)
    expect((await resoudreSession(r.jeton, ORIGINE)).etat).toBe('valide')

    await prisma.user.update({ where: { id: u.id }, data: { actif: false } })

    expect((await resoudreSession(r.jeton, ORIGINE)).etat).toBe('revoquee')
  })

  it('la révocation en masse coupe toutes les sessions d’un compte', async () => {
    const u = await creerCompte()

    const jetons: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
      if (r.etat !== 'mfa_requis') throw new Error('état inattendu')
      await validerSecondFacteur(r.sessionId, dernierCode(), ORIGINE)
      jetons.push(r.jeton)
    }

    expect(await revoquerToutesLesSessions(u.id)).toBe(3)
    for (const jeton of jetons) {
      expect((await resoudreSession(jeton, ORIGINE)).etat).toBe('revoquee')
    }
  })
})

describe('limitation par adresse IP', () => {
  // Le verrou par compte ne protège pas d'une pulvérisation : peu de mots de
  // passe essayés sur beaucoup de comptes ne déclenche aucun verrou.
  it('bloque une pulvérisation sur des comptes différents', async () => {
    const ip = `10.99.${(SUFFIXE >> 8) & 255}.${SUFFIXE & 255}`
    const origine = { ipAddress: ip, userAgent: 'vitest-pulverisation' }

    // Vingt comptes distincts, deux essais chacun : jamais cinq échecs sur un
    // même compte, donc aucun verrou de compte ne se déclencherait.
    for (let i = 0; i < 20; i++) {
      await demarrerConnexion(`cible-${SUFFIXE}-${i}@test.local`, 'essai', origine)
    }

    const r = await demarrerConnexion('cible-suivante@test.local', 'essai', origine)
    expect(r.etat).toBe('trop_de_tentatives')

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { ipAddress: ip, action: 'LOGIN_FAILURE' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(trace.deniedReason).toBe('trop de tentatives depuis cette adresse')
  })

  it('n’affecte pas une autre adresse', async () => {
    const u = await creerCompte()
    const autre = { ipAddress: `10.98.${SUFFIXE & 255}.7`, userAgent: 'vitest' }

    const r = await demarrerConnexion(u.email, MOT_DE_PASSE, autre)
    expect(r.etat).toBe('mfa_requis')
  })
})

// D7quater : le code n'est demandé que depuis une machine que cette personne
// n'a pas encore éprouvée.
describe('poste de confiance', () => {
  it('demande le code la première fois, plus ensuite', async () => {
    const u = await creerCompte()
    const { poste } = await declarerPoste()
    const origine = { ...ORIGINE, workstationId: poste.id }

    const premiere = await demarrerConnexion(u.email, MOT_DE_PASSE, origine)
    expect(premiere.etat).toBe('mfa_requis')
    if (premiere.etat !== 'mfa_requis') return

    await validerSecondFacteur(premiere.sessionId, dernierCode(), origine)
    expect(await estPosteDeConfiance(u.id, poste.id)).toBe(true)

    const seconde = await demarrerConnexion(u.email, MOT_DE_PASSE, origine)
    expect(seconde.etat).toBe('connecte')
  })

  // Le second facteur protège d'abord contre le vol d'identifiants à distance :
  // cette menace-là doit rester couverte.
  it('redemande le code depuis une AUTRE machine', async () => {
    const u = await creerCompte()
    const connu = await declarerPoste()
    const inconnu = await declarerPoste()

    const p = await demarrerConnexion(u.email, MOT_DE_PASSE, {
      ...ORIGINE,
      workstationId: connu.poste.id,
    })
    if (p.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(p.sessionId, dernierCode(), {
      ...ORIGINE,
      workstationId: connu.poste.id,
    })

    const ailleurs = await demarrerConnexion(u.email, MOT_DE_PASSE, {
      ...ORIGINE,
      workstationId: inconnu.poste.id,
    })
    expect(ailleurs.etat).toBe('mfa_requis')
  })

  it('la confiance vaut pour UNE personne, pas pour la machine', async () => {
    const a = await creerCompte()
    const b = await creerCompte()
    const { poste } = await declarerPoste()
    const origine = { ...ORIGINE, workstationId: poste.id }

    const p = await demarrerConnexion(a.email, MOT_DE_PASSE, origine)
    if (p.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(p.sessionId, dernierCode(), origine)

    // B n'a jamais validé sur ce poste : le code lui est demandé.
    expect((await demarrerConnexion(b.email, MOT_DE_PASSE, origine)).etat).toBe('mfa_requis')
  })

  it('sans poste identifié, le code est toujours demandé', async () => {
    const u = await creerCompte()

    const p = await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)
    if (p.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(p.sessionId, dernierCode(), ORIGINE)

    expect((await demarrerConnexion(u.email, MOT_DE_PASSE, ORIGINE)).etat).toBe('mfa_requis')
  })

  it('une confiance expirée ne vaut plus', async () => {
    const u = await creerCompte()
    const { poste } = await declarerPoste()
    const origine = { ...ORIGINE, workstationId: poste.id }

    const p = await demarrerConnexion(u.email, MOT_DE_PASSE, origine)
    if (p.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(p.sessionId, dernierCode(), origine)

    await prisma.trustedWorkstation.update({
      where: { userId_workstationId: { userId: u.id, workstationId: poste.id } },
      data: { trustedUntil: new Date(Date.now() - 1000) },
    })

    expect(await estPosteDeConfiance(u.id, poste.id)).toBe(false)
    expect((await demarrerConnexion(u.email, MOT_DE_PASSE, origine)).etat).toBe('mfa_requis')
  })

  // C'est le poste OUBLIÉ que D7quater veut voir expirer, pas celui qui sert
  // tous les matins. Le délai court donc depuis la dernière connexion, et non
  // depuis la dernière validation du second facteur.
  it('chaque connexion repousse l’expiration de la confiance', async () => {
    const u = await creerCompte()
    const { poste } = await declarerPoste()
    const origine = { ...ORIGINE, workstationId: poste.id }

    const p = await demarrerConnexion(u.email, MOT_DE_PASSE, origine)
    if (p.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(p.sessionId, dernierCode(), origine)

    // Vingt-neuf jours plus tard : la confiance touche à sa fin.
    const presqueExpiree = new Date(Date.now() + 24 * 3_600_000)
    await prisma.trustedWorkstation.update({
      where: { userId_workstationId: { userId: u.id, workstationId: poste.id } },
      data: { trustedUntil: presqueExpiree },
    })

    const seconde = await demarrerConnexion(u.email, MOT_DE_PASSE, origine)
    expect(seconde.etat).toBe('connecte')

    const apres = await prisma.trustedWorkstation.findUniqueOrThrow({
      where: { userId_workstationId: { userId: u.id, workstationId: poste.id } },
      select: { trustedUntil: true },
    })
    // Repartie pour trente jours, sans avoir redemandé de code.
    expect(apres.trustedUntil.getTime()).toBeGreaterThan(
      presqueExpiree.getTime() + 20 * 24 * 3_600_000,
    )
  })

  it('la connexion dispensée de code est tracée comme telle', async () => {
    const u = await creerCompte()
    const { poste } = await declarerPoste()
    const origine = { ...ORIGINE, workstationId: poste.id }

    const p = await demarrerConnexion(u.email, MOT_DE_PASSE, origine)
    if (p.etat !== 'mfa_requis') throw new Error('état inattendu')
    await validerSecondFacteur(p.sessionId, dernierCode(), origine)
    await demarrerConnexion(u.email, MOT_DE_PASSE, origine)

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: u.id, action: 'LOGIN_SUCCESS' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(trace.deniedReason).toContain('poste de confiance')
  })
})
