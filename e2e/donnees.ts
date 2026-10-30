import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, RoleName, SiteCode } from '@prisma/client'

import { hashPassword } from '../src/server/auth/password'

// Les données des parcours dans le navigateur, dans la base de TEST (jamais la base de travail ni la démo) :
// le serveur lancé par playwright.config.ts y est branché, et ce module y écrit par le rôle applicatif, comme
// les tests Vitest. Tout ce qu'il crée porte le suffixe de la passe et disparaît au nettoyage — sauf les
// comptes, que le journal d'audit référence pour toujours.

export const MOT_DE_PASSE = 'Secretaire-e2e-2026!'
export const FUSEAU = 'America/Guadeloupe'
const FICHIER_ETAT = join(__dirname, '.etat.json')

export type Etat = {
  suffixe: string
  aujourdhui: string
  secretaire: { id: string; email: string }
  /** Le compte de la Dr Claire Rivière, rattaché à la fiche `praticienMG`. */
  praticien: { id: string; email: string }
  /** L'administrateur du cabinet (rôle ADMIN seul). */
  admin?: { id: string; email: string }
  /** Un confrère au même cabinet, avec son propre fauteuil et ses rendez-vous. */
  confrere: { id: string; nom: string; fauteuil: string }
  praticienMG: { id: string; nom: string }
  praticienGP: { id: string; nom: string }
  patients: {
    dupont: { id: string; nom: string }
    martin: { id: string; nom: string }
    guadeloupe: { id: string; nom: string }
  }
  rdv: { dupontAujourdhui: string; martinAujourdhui: string; guadeloupe: string }
  fauteuils: string[]
  motifId: string
  portail: Portail
}

/** Le côté patient : un praticien qui reçoit les dix prochains jours, un motif proposé sur le site, des patients. */
export type Portail = {
  praticien: { id: string; nom: string }
  fauteuil: string
  motifId: string
  menuId: string
  menuLibelle: string
  dupont: { id: string; nom: string; telephone: string; local: string }
  rdvDans5Jours: { id: string; debut: string }
  rdvDans3Heures: { id: string; debut: string }
  bloque: { telephone: string; local: string }
  /** Un numéro neuf par navigateur, pour la réservation d'un nouveau patient. */
  nouveaux: Record<string, { telephone: string; local: string }>
}

const versLocal = (telephone: string) => `0${telephone.slice(4)}`

async function preparerPortail(
  prisma: PrismaClient,
  suffixe: string,
  aujourdhui: string,
  siteId: string,
): Promise<Portail> {
  const fin = suffixe.slice(-4)
  const tel = (prefixe: string) => `+590690${prefixe}${fin}`
  const motif = await prisma.motifConsultation.create({
    data: { libelle: `Détartrage portail ${suffixe}`, dureeIndicative: 30, couleur: '#0ea5e9', ordre: 9600 },
    select: { id: true },
  })
  const menuLibelle = `Un détartrage (essai ${fin})`
  const menu = await prisma.motifPatient.create({
    data: { libelle: menuLibelle, aide: 'Entrée de menu des parcours Playwright.', ordre: 9600, motifId: motif.id },
    select: { id: true },
  })
  const praticien = await prisma.praticien.create({
    data: { nom: `Portail${fin}`, prenom: 'Léa', couleur: '#16a34a' },
    select: { id: true, nom: true },
  })
  await prisma.praticienMotif.create({ data: { praticienId: praticien.id, motifId: motif.id, dureeMinutes: 30 } })
  const fauteuil = await prisma.fauteuil.create({
    data: { siteId, nom: `Fauteuil portail ${fin}` },
    select: { id: true },
  })
  for (let n = 1; n <= 10; n++) {
    const jour = decaler(aujourdhui, n)
    await prisma.plageDePresence.create({
      data: {
        praticienId: praticien.id,
        siteId,
        fauteuilId: fauteuil.id,
        debut: instant(jour, '07:00'),
        fin: instant(jour, '19:00'),
      },
    })
  }
  const dupont = await prisma.patient.create({
    data: { nom: `Dupont${fin}`, prenom: 'Marie', telephone: tel('31') },
    select: { id: true, nom: true, telephone: true },
  })
  const rdv = async (debut: Date) =>
    prisma.rendezVous.create({
      data: {
        patientId: dupont.id,
        praticienId: praticien.id,
        siteId,
        fauteuilId: fauteuil.id,
        motifId: motif.id,
        debut,
        fin: new Date(debut.getTime() + 30 * 60_000),
        statut: 'CONFIRME',
      },
      select: { id: true, debut: true },
    })
  const dans5 = await rdv(instant(decaler(aujourdhui, 5), '09:00'))
  const dans3h = await rdv(new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 900_000) * 900_000))
  const bloque = await prisma.patient.create({
    data: { nom: `Bloque${fin}`, prenom: 'Hugo', telephone: tel('32'), manquements: 3, reservationBloquee: true },
    select: { telephone: true },
  })
  const nouveaux: Portail['nouveaux'] = {}
  for (const [i, nom] of ['chrome', 'safari', 'iphone'].entries()) {
    const t = tel(`4${i}`)
    nouveaux[nom] = { telephone: t, local: versLocal(t) }
  }
  return {
    praticien,
    fauteuil: fauteuil.id,
    motifId: motif.id,
    menuId: menu.id,
    menuLibelle,
    dupont: { ...dupont, local: versLocal(dupont.telephone) },
    rdvDans5Jours: { id: dans5.id, debut: dans5.debut.toISOString() },
    rdvDans3Heures: { id: dans3h.id, debut: dans3h.debut.toISOString() },
    bloque: { telephone: bloque.telephone, local: versLocal(bloque.telephone) },
    nouveaux,
  }
}

/** Tous les numéros du côté patient de la passe : la limite par connexion et les traces s'y rattachent. */
export const numerosDuPortail = (p: Portail) => [
  p.dupont.telephone,
  p.bloque.telephone,
  ...Object.values(p.nouveaux).map((n) => n.telephone),
]

export function client() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !/\/cabinet_test$/.test(url)) throw new Error('TEST_DATABASE_URL doit désigner la base cabinet_test.')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
}

/** « AAAA-MM-JJ » du jour, heure de Guadeloupe. */
export function jourLocal(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU }).format(d)
}

/** Un instant à « jour hh:mm » heure de Guadeloupe (UTC-4, sans changement d'heure, D10). */
export function instant(jour: string, heure: string) {
  return new Date(`${jour}T${heure}:00-04:00`)
}

function decaler(jour: string, n: number) {
  const d = new Date(`${jour}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Heure locale « hh:mm » à `minutes` d'ici (négatif : dans le passé), arrondie aux 5 minutes suivantes. */
export function heureDans(minutes: number) {
  const local = new Date(Date.now() - 4 * 3_600_000 + minutes * 60_000)
  const total = Math.ceil((local.getUTCHours() * 60 + local.getUTCMinutes()) / 5) * 5
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Prochain quart d'heure à au moins `minutes` d'ici, heure locale, borné au soir. */
function heureProche(minutes: number) {
  const local = new Date(Date.now() - 4 * 3_600_000 + minutes * 60_000)
  let h = local.getUTCHours()
  let m = Math.ceil(local.getUTCMinutes() / 15) * 15
  if (m === 60) {
    h += 1
    m = 0
  }
  if (h >= 22) return '21:30'
  if (h < 7) return '07:00'
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export async function preparer(): Promise<Etat> {
  const prisma = client()
  const suffixe = String(Date.now())
  try {
    const aujourdhui = jourLocal()
    const siteMG = await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })
    const siteGP = await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SECRETAIRE } })

    const email = `secretaire-e2e-${suffixe}@test.local`
    const secretaire = await prisma.user.create({
      data: {
        email,
        nom: 'Lebon',
        prenom: 'Nadège',
        passwordHash: await hashPassword(MOT_DE_PASSE),
        // Numéro fictif hors de SMS_NUMEROS_AUTORISES : le code s'écrit dans la console du serveur, aucun SMS ne part.
        telephoneMobile: '+590690000999',
        mfaEnrolledAt: new Date(),
        roles: { create: { roleId: role.id } },
        sites: { create: { siteId: siteMG.id } },
      },
      select: { id: true },
    })

    const motif = await prisma.motifConsultation.create({
      data: { libelle: `Détartrage E2E ${suffixe}`, dureeIndicative: 30, couleur: '#0ea5e9', ordre: 9500 },
      select: { id: true },
    })

    const praticienMG = await prisma.praticien.create({
      data: { nom: `Rivière${suffixe.slice(-4)}`, prenom: 'Claire', couleur: '#0078cc' },
      select: { id: true, nom: true },
    })
    const praticienGP = await prisma.praticien.create({
      data: { nom: `Bastien${suffixe.slice(-4)}`, prenom: 'Paul', couleur: '#7c5cd6' },
      select: { id: true, nom: true },
    })
    for (const p of [praticienMG, praticienGP]) {
      await prisma.praticienMotif.create({ data: { praticienId: p.id, motifId: motif.id, dureeMinutes: 30 } })
    }

    const fMG = await prisma.fauteuil.create({
      data: { siteId: siteMG.id, nom: `Fauteuil E2E ${suffixe.slice(-4)}` },
      select: { id: true },
    })
    const fGP = await prisma.fauteuil.create({
      data: { siteId: siteGP.id, nom: `Fauteuil E2E ${suffixe.slice(-4)}` },
      select: { id: true },
    })

    // Le praticien de Marie-Galante est là aujourd'hui (toute la journée, pour que l'heure de la passe n'importe
    // pas) et les sept jours suivants de 7h à 19h ; celui de la Guadeloupe aujourd'hui aussi.
    await prisma.plageDePresence.create({
      data: {
        praticienId: praticienMG.id,
        siteId: siteMG.id,
        fauteuilId: fMG.id,
        debut: instant(aujourdhui, '06:00'),
        fin: instant(aujourdhui, '23:30'),
      },
    })
    for (let n = 1; n <= 7; n++) {
      const jour = decaler(aujourdhui, n)
      await prisma.plageDePresence.create({
        data: {
          praticienId: praticienMG.id,
          siteId: siteMG.id,
          fauteuilId: fMG.id,
          debut: instant(jour, '07:00'),
          fin: instant(jour, '19:00'),
        },
      })
    }
    await prisma.plageDePresence.create({
      data: {
        praticienId: praticienGP.id,
        siteId: siteGP.id,
        fauteuilId: fGP.id,
        debut: instant(aujourdhui, '06:00'),
        fin: instant(aujourdhui, '23:30'),
      },
    })

    const patient = (nom: string, prenom: string, telephone: string) =>
      prisma.patient.create({
        data: { nom, prenom, telephone, dateNaissance: new Date('1975-05-20'), profilComplet: true },
        select: { id: true, nom: true },
      })
    const dupont = await patient(`Dupont${suffixe.slice(-5)}`, 'Marie', '+590690100001')
    const martin = await patient(`Martin${suffixe.slice(-5)}`, 'Jules', '+590690100002')
    const guadeloupe = await patient(`Secret${suffixe.slice(-5)}`, 'Gaston', '+590690100003')

    const rdv = (patientId: string, praticienId: string, siteId: string, fauteuilId: string, heure: string) =>
      prisma.rendezVous.create({
        data: {
          patientId,
          praticienId,
          siteId,
          fauteuilId,
          motifId: motif.id,
          debut: instant(aujourdhui, heure),
          fin: new Date(instant(aujourdhui, heure).getTime() + 30 * 60_000),
          statut: 'CONFIRME',
        },
        select: { id: true },
      })
    // Une heure d'écart, toujours : le soir, l'heure plafonnée à 21h30 faisait se chevaucher les deux.
    const h1 = heureProche(30)
    const [hh, mm] = h1.split(':').map(Number) as [number, number]
    const h2 = `${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    const dupontAujourdhui = await rdv(dupont.id, praticienMG.id, siteMG.id, fMG.id, h1)
    const martinAujourdhui = await rdv(martin.id, praticienMG.id, siteMG.id, fMG.id, h2)
    const enGuadeloupe = await rdv(guadeloupe.id, praticienGP.id, siteGP.id, fGP.id, h1)

    // La Dr Rivière se connecte : son compte porte la fiche `praticienMG`.
    const rolePraticien = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PRATICIEN } })
    const emailPraticien = `praticien-e2e-${suffixe}@test.local`
    const comptePraticien = await prisma.user.create({
      data: {
        email: emailPraticien,
        nom: 'Rivière',
        prenom: 'Claire',
        passwordHash: await hashPassword(MOT_DE_PASSE),
        telephoneMobile: '+590690000998',
        mfaEnrolledAt: new Date(),
        roles: { create: { roleId: rolePraticien.id } },
        sites: { create: { siteId: siteMG.id } },
      },
      select: { id: true },
    })
    await prisma.praticien.update({ where: { id: praticienMG.id }, data: { userId: comptePraticien.id } })

    const roleAdmin = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } })
    const emailAdmin = `admin-e2e-${suffixe}@test.local`
    const compteAdmin = await prisma.user.create({
      data: {
        email: emailAdmin,
        nom: 'Gustave',
        prenom: 'Aline',
        passwordHash: await hashPassword(MOT_DE_PASSE),
        telephoneMobile: '+590690000997',
        mfaEnrolledAt: new Date(),
        roles: { create: { roleId: roleAdmin.id } },
        sites: { create: { siteId: siteMG.id } },
      },
      select: { id: true },
    })

    const confrere = await prisma.praticien.create({
      data: { nom: `Morel${suffixe.slice(-4)}`, prenom: 'Paul', couleur: '#e11d48' },
      select: { id: true, nom: true },
    })
    await prisma.praticienMotif.create({ data: { praticienId: confrere.id, motifId: motif.id, dureeMinutes: 30 } })
    const fConfrere = await prisma.fauteuil.create({
      data: { siteId: siteMG.id, nom: `Fauteuil E2E ${suffixe.slice(-4)} bis` },
      select: { id: true },
    })
    await prisma.plageDePresence.create({
      data: {
        praticienId: confrere.id,
        siteId: siteMG.id,
        fauteuilId: fConfrere.id,
        debut: instant(aujourdhui, '06:00'),
        fin: instant(aujourdhui, '23:30'),
      },
    })
    for (let n = 1; n <= 7; n++) {
      const jour = decaler(aujourdhui, n)
      await prisma.plageDePresence.create({
        data: {
          praticienId: confrere.id,
          siteId: siteMG.id,
          fauteuilId: fConfrere.id,
          debut: instant(jour, '07:00'),
          fin: instant(jour, '19:00'),
        },
      })
    }

    const etat: Etat = {
      suffixe,
      aujourdhui,
      secretaire: { id: secretaire.id, email },
      praticien: { id: comptePraticien.id, email: emailPraticien },
      admin: { id: compteAdmin.id, email: emailAdmin },
      confrere: { ...confrere, fauteuil: fConfrere.id },
      praticienMG,
      praticienGP,
      patients: { dupont, martin, guadeloupe },
      rdv: {
        dupontAujourdhui: dupontAujourdhui.id,
        martinAujourdhui: martinAujourdhui.id,
        guadeloupe: enGuadeloupe.id,
      },
      fauteuils: [fMG.id, fGP.id, fConfrere.id],
      motifId: motif.id,
      portail: await preparerPortail(prisma, suffixe, aujourdhui, siteMG.id),
    }
    writeFileSync(FICHIER_ETAT, JSON.stringify(etat, null, 2))
    return etat
  } catch (e) {
    // Interrompue à mi-chemin, la préparation n'a pas écrit d'état : elle retire elle-même ce qu'elle a créé,
    // reconnaissable à son suffixe, sans quoi la base de test garde des fauteuils et des praticiens orphelins.
    await nettoyerPassePartielle(prisma, suffixe).catch(() => {})
    throw e
  } finally {
    await prisma.$disconnect()
  }
}

async function nettoyerPassePartielle(prisma: PrismaClient, suffixe: string) {
  const fin = suffixe.slice(-4)
  const praticiens = (
    await prisma.praticien.findMany({
      where: { nom: { in: ['Rivière', 'Bastien', 'Morel', 'Portail'].map((n) => `${n}${fin}`) } },
      select: { id: true },
    })
  ).map((p) => p.id)
  const fauteuils = (
    await prisma.fauteuil.findMany({
      where: {
        nom: { contains: fin },
        OR: [{ nom: { startsWith: 'Fauteuil E2E' } }, { nom: { startsWith: 'Fauteuil portail' } }],
      },
      select: { id: true },
    })
  ).map((f) => f.id)
  const motifs = (
    await prisma.motifConsultation.findMany({ where: { libelle: { endsWith: suffixe } }, select: { id: true } })
  ).map((m) => m.id)
  await prisma.notification.deleteMany({
    where: { rendezVous: { OR: [{ praticienId: { in: praticiens } }, { fauteuilId: { in: fauteuils } }] } },
  })
  await prisma.rendezVous.deleteMany({
    where: { OR: [{ praticienId: { in: praticiens } }, { fauteuilId: { in: fauteuils } }] },
  })
  await prisma.plageDePresence.deleteMany({
    where: { OR: [{ praticienId: { in: praticiens } }, { fauteuilId: { in: fauteuils } }] },
  })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: fauteuils } } })
  await prisma.patient.deleteMany({
    where: {
      OR: [{ nom: { endsWith: suffixe.slice(-5) } }, { nom: { endsWith: fin }, telephone: { startsWith: '+590690' } }],
    },
  })
  await prisma.motifPatient.deleteMany({ where: { motifId: { in: motifs } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: motifs } } })
}

async function nettoyerPortail(prisma: PrismaClient, p: Portail) {
  const numeros = numerosDuPortail(p)
  await prisma.inscriptionListeAttente.deleteMany({ where: { telephone: { in: numeros } } })
  await prisma.preferenceNotification.deleteMany({ where: { destinataire: { in: numeros } } })
  await prisma.notification.deleteMany({
    where: { OR: [{ destinataire: { in: numeros } }, { rendezVous: { praticienId: p.praticien.id } }] },
  })
  await prisma.reservationPublique.deleteMany({
    where: { OR: [{ praticienId: p.praticien.id }, { telephone: { in: numeros } }] },
  })
  await prisma.rendezVous.deleteMany({
    where: { OR: [{ praticienId: p.praticien.id }, { patient: { telephone: { in: numeros } } }] },
  })
  await prisma.accesPatient.deleteMany({ where: { telephone: { in: numeros } } })
  await prisma.patient.deleteMany({ where: { telephone: { in: numeros } } })
  await prisma.motifPatient.deleteMany({ where: { id: p.menuId } })
  await prisma.plageDePresence.deleteMany({ where: { praticienId: p.praticien.id } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: p.praticien.id } })
  await prisma.praticien.deleteMany({ where: { id: p.praticien.id } })
  await prisma.fauteuil.deleteMany({ where: { id: p.fauteuil } })
  await prisma.motifConsultation.deleteMany({ where: { id: p.motifId } })
}

export function lireEtat(): Etat {
  return JSON.parse(readFileSync(FICHIER_ETAT, 'utf8')) as Etat
}

export async function nettoyer() {
  let etat: Etat
  try {
    etat = lireEtat()
  } catch {
    return
  }
  const prisma = client()
  try {
    // `confrere` et `praticien` manquent dans l'état d'une passe antérieure au 21/10.
    const praticiens = [etat.praticienMG.id, etat.praticienGP.id, ...(etat.confrere ? [etat.confrere.id] : [])]
    // Les patients créés pendant la passe (à l'écran) portent le suffixe dans leur nom.
    const patients = await prisma.patient.findMany({
      where: {
        OR: [
          { nom: { contains: etat.suffixe.slice(-5) } },
          { id: { in: Object.values(etat.patients).map((p) => p.id) } },
        ],
      },
      select: { id: true },
    })
    const idsPatients = patients.map((p) => p.id)
    await prisma.notification.deleteMany({
      where: { rendezVous: { OR: [{ praticienId: { in: praticiens } }, { patientId: { in: idsPatients } }] } },
    })
    await prisma.rendezVous.deleteMany({
      where: { OR: [{ praticienId: { in: praticiens } }, { patientId: { in: idsPatients } }] },
    })
    await prisma.noteJour.deleteMany({ where: { auteurId: etat.secretaire.id } })
    await prisma.indisponibilite.deleteMany({ where: { praticienId: { in: praticiens } } })
    await prisma.plageDePresence.deleteMany({ where: { praticienId: { in: praticiens } } })
    await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: praticiens } } })
    await prisma.praticien.deleteMany({ where: { id: { in: praticiens } } })
    await prisma.fauteuil.deleteMany({ where: { id: { in: etat.fauteuils } } })
    await prisma.patient.deleteMany({ where: { id: { in: idsPatients } } })
    await prisma.motifConsultation.deleteMany({ where: { id: etat.motifId } })
    await nettoyerPortail(prisma, etat.portail)
    // Sessions closes : le compte ne peut plus servir.
    await prisma.session.updateMany({
      where: {
        userId: {
          in: [
            etat.secretaire.id,
            ...(etat.praticien ? [etat.praticien.id] : []),
            ...(etat.admin ? [etat.admin.id] : []),
          ],
        },
      },
      data: { revokedAt: new Date() },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Un téléphone déjà reconnu pour cette personne (D83), comme après une première connexion avec le code SMS : rend
 * le secret de son cookie de poste, et de quoi le retirer — les autres parcours attendent le SMS.
 */
export async function telephoneDeConfiance(userId: string): Promise<{ secret: string; retirer: () => Promise<void> }> {
  const prisma = client()
  const secret = randomBytes(32).toString('base64url')
  const poste = await prisma.workstation.create({
    data: {
      nom: `Téléphone E2E ${secret.slice(0, 6)}`,
      secretHash: createHash('sha256').update(secret).digest('hex'),
      telephone: true,
    },
    select: { id: true },
  })
  await prisma.trustedWorkstation.create({
    data: { userId, workstationId: poste.id, trustedUntil: new Date(Date.now() + 86_400_000) },
  })
  await prisma.$disconnect()
  return {
    secret,
    retirer: async () => {
      const p = client()
      await p.trustedWorkstation.deleteMany({ where: { workstationId: poste.id } })
      await p.$disconnect()
    },
  }
}

/**
 * Le code reçu « par SMS ». Hors production, il ne part pas : il s'écrit dans la console du serveur, et seul son
 * condensat SHA-256 est en base. Six chiffres ne font qu'un million de candidats : on le retrouve en le
 * recalculant, sans rien ajouter à l'application ni lire la console.
 */
export async function codeRecu(userId: string, depuis: Date): Promise<string> {
  const prisma = client()
  try {
    for (let essai = 0; essai < 20; essai++) {
      const ligne = await prisma.codeSms.findFirst({
        where: { session: { userId, createdAt: { gte: depuis } } },
        orderBy: { session: { createdAt: 'desc' } },
        select: { codeHash: true },
      })
      if (ligne) {
        for (let n = 0; n < 1_000_000; n++) {
          const code = String(n).padStart(6, '0')
          if (createHash('sha256').update(code).digest('hex') === ligne.codeHash) return code
        }
        throw new Error('Code introuvable : le condensat ne correspond à aucun code à six chiffres.')
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('Aucun code émis pour cette session.')
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Un patient neuf et son rendez-vous, sur le premier quart d'heure libre du praticien de Marie-Galante :
 * chaque parcours qui modifie un rendez-vous a le sien, et les trois navigateurs ne se marchent pas dessus.
 *
 * Un jour à venir complet (une passe des trois navigateurs remplit « demain » avant l'iPhone, 26/10) : le jour suivant,
 * jusqu'à la fin des présences de la passe. Le jour retenu est rendu : le parcours ouvre celui-là.
 */
export async function rendezVousFrais(
  etat: Etat,
  options: Parameters<typeof rendezVousDuJour>[1] = {},
): ReturnType<typeof rendezVousDuJour> {
  const jour = options.jour ?? etat.aujourdhui
  if (jour === etat.aujourdhui) return rendezVousDuJour(etat, options)
  for (let n = 0; ; n++) {
    const essai = decaler(jour, n)
    try {
      return await rendezVousDuJour(etat, { ...options, jour: essai })
    } catch (e) {
      if (n >= 5 || !(e instanceof Error) || !e.message.startsWith('Plus de créneau libre')) throw e
    }
  }
}

async function rendezVousDuJour(
  etat: Etat,
  options: {
    jour?: string
    apres?: string
    prenom?: string
    duree?: number
    pas?: number
    /** Le rendez-vous d'un confrère de la Dr Rivière plutôt que le sien. */
    confrere?: boolean
    /** Une demande d'annulation transmise par la secrétaire, en attente du praticien. */
    demandeAnnulation?: boolean
  } = {},
) {
  const prisma = client()
  try {
    const jour = options.jour ?? etat.aujourdhui
    const praticienId = options.confrere ? etat.confrere.id : etat.praticienMG.id
    const siteMG = await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })
    const occupes = await prisma.rendezVous.findMany({
      where: { praticienId, debut: { gte: instant(jour, '00:00'), lt: instant(jour, '23:59') } },
      select: { debut: true, fin: true },
    })
    const depart = options.apres ?? (jour === etat.aujourdhui ? heureProche(15) : '08:00')
    const duree = (options.duree ?? 30) * 60_000
    const pas = (options.pas ?? 15) * 60_000
    let debut = instant(jour, depart)
    // Jusqu'au bout de la présence (23h30 aujourd'hui, 19h ensuite), durée du rendez-vous comprise.
    const limite = new Date(instant(jour, jour === etat.aujourdhui ? '23:30' : '19:00').getTime() - duree)
    while (occupes.some((o) => o.debut < new Date(debut.getTime() + duree) && o.fin > debut)) {
      debut = new Date(debut.getTime() + pas)
      if (debut >= limite)
        throw new Error(
          `Plus de créneau libre le ${jour} après ${depart} : ${occupes
            .map((o) => `${o.debut.toISOString().slice(11, 16)}-${o.fin.toISOString().slice(11, 16)}`)
            .join(' ')} (UTC).`,
        )
    }
    const n = await prisma.patient.count({ where: { nom: { contains: etat.suffixe.slice(-5) } } })
    const patient = await prisma.patient.create({
      data: {
        nom: `Frais${n}x${etat.suffixe.slice(-5)}`,
        prenom: options.prenom ?? 'Ana',
        telephone: `+5906901${String(20000 + n).padStart(5, '0')}`,
      },
      select: { id: true, nom: true, prenom: true },
    })
    const rdv = await prisma.rendezVous.create({
      data: {
        patientId: patient.id,
        praticienId,
        siteId: siteMG.id,
        fauteuilId: options.confrere ? etat.confrere.fauteuil : etat.fauteuils[0]!,
        motifId: etat.motifId,
        debut,
        fin: new Date(debut.getTime() + duree),
        ...(options.demandeAnnulation
          ? {
              statut: 'ANNULATION_DEMANDEE' as const,
              statutAvantAnnulation: 'CONFIRME' as const,
              annulationDemandeeParId: etat.secretaire.id,
              annulationDemandeeLe: new Date(),
            }
          : { statut: 'CONFIRME' as const }),
      },
      select: { id: true, debut: true },
    })
    return { patient, rdv, jour }
  } finally {
    await prisma.$disconnect()
  }
}

/** Range un patient vu en fin de parcours : « terminé », il quitte la file des prochains rendez-vous de l'accueil,
 *  qui n'en montre que cinq — sans quoi les patients des navigateurs précédents en chassent ceux du suivant. */
export async function terminerRendezVous(id: string) {
  const prisma = client()
  try {
    await prisma.rendezVous.update({ where: { id }, data: { statut: 'TERMINE' } })
  } finally {
    await prisma.$disconnect()
  }
}

export async function lireRendezVous(id: string) {
  const prisma = client()
  try {
    return await prisma.rendezVous.findUniqueOrThrow({ where: { id } })
  } finally {
    await prisma.$disconnect()
  }
}

export { decaler }

/** Retrouve un code à six chiffres depuis son condensat SHA-256 (un million de candidats). */
function retrouverCode(condensat: string): string {
  for (let n = 0; n < 1_000_000; n++) {
    const code = String(n).padStart(6, '0')
    if (createHash('sha256').update(code).digest('hex') === condensat) return code
  }
  throw new Error('Code introuvable : le condensat ne correspond à aucun code à six chiffres.')
}

/** Le code « reçu par SMS » par un patient : réservation en ligne ou accès à « Mes rendez-vous ». */
export async function codePatient(telephone: string, quoi: 'reservation' | 'acces', depuis: Date): Promise<string> {
  const prisma = client()
  try {
    for (let essai = 0; essai < 40; essai++) {
      const ligne =
        quoi === 'reservation'
          ? await prisma.reservationPublique.findFirst({
              where: { telephone, createdAt: { gte: depuis } },
              orderBy: { createdAt: 'desc' },
              select: { codeHash: true },
            })
          : await prisma.accesPatient.findFirst({
              where: { telephone, createdAt: { gte: depuis } },
              orderBy: { createdAt: 'desc' },
              select: { codeHash: true },
            })
      if (ligne) return retrouverCode(ligne.codeHash)
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`Aucun code émis pour ${telephone}.`)
  } finally {
    await prisma.$disconnect()
  }
}

/** Un rendez-vous de Madame Dupont posé pour un parcours, « dans n jours à hh:mm », heure de Guadeloupe. */
export async function rendezVousDupont(etat: Etat, dansJours: number, heure: string) {
  const prisma = client()
  try {
    const p = etat.portail
    const siteMG = await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })
    const debut = instant(decaler(etat.aujourdhui, dansJours), heure)
    return await prisma.rendezVous.create({
      data: {
        patientId: p.dupont.id,
        praticienId: p.praticien.id,
        siteId: siteMG.id,
        fauteuilId: p.fauteuil,
        motifId: p.motifId,
        debut,
        fin: new Date(debut.getTime() + 30 * 60_000),
        statut: 'CONFIRME',
      },
      select: { id: true, debut: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/** Repart d'un compteur vierge de demandes de code pour ce numéro : la limite de cinq par heure (éprouvée par
 *  tests/role-patient.test.ts) n'est pas l'objet des parcours, qui ouvrent l'espace d'un même patient souvent. */
export async function oublierDemandesCode(telephone: string) {
  const prisma = client()
  try {
    // Ouvertes ou non, toutes les demandes de l'heure comptent dans la limite : toutes s'effacent.
    await prisma.accesPatient.deleteMany({ where: { telephone } })
  } finally {
    await prisma.$disconnect()
  }
}
