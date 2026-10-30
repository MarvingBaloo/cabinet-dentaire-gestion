import { CanalNotification, RoleName, SiteCode, StatutRendezVous, TypeNotification } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext, permissionKey } from '@/server/auth/context'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { PorteeConsolideeError, PorteeSiteError } from '@/server/auth/portee'
import { prisma } from '@/server/db/client'
import { lireAccueil } from '@/server/queries/accueil'
import {
  compterRendezVousParJour,
  lireDemandesAnnulationEnAttente,
  lireFicheRendezVous,
  lireListeAttente,
  lireRendezVous,
  listerFauteuils,
  listerMotifs,
  listerMotifsPatientAdmin,
  listerPraticiens,
  listerPresences,
  listerRendezVous,
  listerRendezVousConsolide,
} from '@/server/queries/agenda'
import { listerNotesJour } from '@/server/queries/notes-jour'
import { lireFichePatient, patientsBloques, rechercheRapide, rechercherPatients } from '@/server/queries/patients'
import { listerPostes } from '@/server/queries/postes'
import { lireActiviteRecente, lireIndicateurs } from '@/server/queries/tableau-bord'
import { lireUtilisateur, listerSites, listerUtilisateurs } from '@/server/queries/users'
import {
  AnnulationDejaDemandeeError,
  CreneauPrisEntretempsError,
  CreneauRefuseError,
  ReserveAuPraticienError,
  annulerRendezVous,
  apercuCreneau,
  changerStatut,
  creerPatient,
  creerRendezVous,
  deplacerRendezVous,
  dupliquerRendezVous,
  refuserAnnulation,
  validerAnnulation,
} from '@/server/services/agenda'
import {
  IndisponibiliteBloqueeError,
  creerIndisponibilite,
  supprimerIndisponibilite,
} from '@/server/services/indisponibilites'
import {
  enregistrerModeleMessage,
  listerModelesMessages,
  reinitialiserModeleMessage,
} from '@/server/services/modeles-messages'
import { creerMotifPatient, modifierMotifPatient, supprimerMotifPatient } from '@/server/services/motifs-patient'
import { creerNoteJour, modifierNoteJour, supprimerNoteJour } from '@/server/services/notes-jour'
import { debloquerPatient, modifierPatient } from '@/server/services/patients'
import { desactiverPoste, nommerPoste } from '@/server/services/postes'
import { enregistrerException, enregistrerJourSemaineType, supprimerException } from '@/server/services/presences'
import {
  creerUtilisateur,
  desactiverUtilisateur,
  modifierUtilisateur,
  reactiverUtilisateur,
  reinitialiserMfa,
} from '@/server/services/users'
import { definirTransporteur, type Message } from '@/server/sms/envoi'

// La batterie du rôle SECRÉTAIRE (20/10/2026) : tout ce que la secrétaire de Marie-Galante fait dans sa
// journée, et tout ce qui lui reste fermé, éprouvé d'un seul point de vue — le sien — contre la base de test.
// Les règles elles-mêmes ont leurs suites (service-agenda, agenda, presences…) ; celle-ci répond à une autre
// question : « avec CE compte, qu'est-ce qui marche, et qu'est-ce qui est refusé, tracé, sans rien écrire ? »
//
// La journée se joue en juin 2027, sur des fauteuils et des praticiens propres à ce fichier : elle ne croise
// aucune autre suite.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }
const h = (jour: string, heure: string) => new Date(`2027-06-${jour}T${heure}:00Z`)

let siteMG: string
let siteGP: string
let ctxSecretaire: AuthContext
let ctxAssistante: AuthContext
let ctxPraticien: AuthContext
let ctxAdmin: AuthContext

let praticienMG: string
let praticienGP: string
// Un praticien sans rendez-vous ni présence posée à la main : sa semaine type est la seule source de ses
// présences, comme dans le vrai cabinet — le recalcul refuserait sinon d'effacer les plages des fixtures.
let praticienPresences: string
let fauteuilMG: string
let fauteuilGP: string
let motifId: string
let patientId: string
let rdvGP: string

const cree = {
  users: [] as string[],
  rdv: [] as string[],
  plages: [] as string[],
  praticiens: [] as string[],
  patients: [] as string[],
  fauteuils: [] as string[],
  motifs: [] as string[],
  notes: [] as string[],
  inscriptions: [] as string[],
  indispos: [] as string[],
}

let smsEnvoyes: Message[] = []
definirTransporteur({
  nom: 'essai',
  async envoyer(m: Message) {
    smsEnvoyes.push(m)
    return { ok: true as const, reference: 'essai' }
  },
})

async function compte(role: RoleName, cle: string, sites: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `role-sec-${cle}-${SUFFIXE}@test.local`,
      nom: 'Test',
      prenom: cle,
      passwordHash: 'x',
      roles: { create: { roleId: r.id } },
      sites: { create: sites.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  })
  cree.users.push(u.id)
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error(`Contexte introuvable : ${cle}`)
  return ctx
}

/** Un rendez-vous posé sans la DAL : les fixtures ne dépendent pas du code qu'elles éprouvent. */
async function rdvDirect(siteId: string, praticienId: string, fauteuilId: string, debut: Date, patient = patientId) {
  const rdv = await prisma.rendezVous.create({
    data: {
      patientId: patient,
      praticienId,
      siteId,
      fauteuilId,
      motifId,
      debut,
      fin: new Date(debut.getTime() + 30 * 60_000),
    },
    select: { id: true },
  })
  cree.rdv.push(rdv.id)
  return rdv.id
}

/** Le dernier refus tracé pour la secrétaire, sur ce motif. */
async function refusTrace(raison: string, depuis: Date) {
  return prisma.auditLog.findFirst({
    where: {
      actorId: ctxSecretaire.userId,
      action: 'PERMISSION_DENIED',
      deniedReason: raison,
      succeeded: false,
      occurredAt: { gte: depuis },
    },
    orderBy: { id: 'desc' },
  })
}

const rdvSecretaire = (jour: string, heure: string, extra: Record<string, unknown> = {}) => ({
  patientId,
  praticienId: praticienMG,
  motifId,
  siteId: siteMG,
  debut: h(jour, heure),
  surbooking: false,
  horsHoraire: false,
  ...extra,
})

beforeAll(async () => {
  siteMG = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.MARIE_GALANTE } })).id
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id

  ctxSecretaire = await compte(RoleName.SECRETAIRE, 'secretaire', [siteMG])
  ctxAssistante = await compte(RoleName.ASSISTANTE, 'assistante', [siteMG])
  ctxPraticien = await compte(RoleName.PRATICIEN, 'praticien', [siteMG])
  ctxAdmin = await compte(RoleName.ADMIN, 'admin', [siteMG])

  const m = await prisma.motifConsultation.create({
    data: { libelle: `Détartrage ${SUFFIXE}`, dureeIndicative: 30, couleur: '#0078cc', ordre: 9100 },
    select: { id: true },
  })
  motifId = m.id
  cree.motifs.push(m.id)

  const pMG = await prisma.praticien.create({
    data: { nom: 'Martin', prenom: `MG${SUFFIXE}`, couleur: '#0078cc', userId: ctxPraticien.userId },
    select: { id: true },
  })
  const pGP = await prisma.praticien.create({
    data: { nom: 'Bernard', prenom: `GP${SUFFIXE}`, couleur: '#7c5cd6' },
    select: { id: true },
  })
  const pPresences = await prisma.praticien.create({
    data: { nom: 'Petit', prenom: `Pres${SUFFIXE}`, couleur: '#16a34a' },
    select: { id: true },
  })
  praticienPresences = pPresences.id
  cree.praticiens.push(pPresences.id)
  praticienMG = pMG.id
  praticienGP = pGP.id
  cree.praticiens.push(pMG.id, pGP.id)
  for (const p of [praticienMG, praticienGP]) {
    await prisma.praticienMotif.create({ data: { praticienId: p, motifId, dureeMinutes: 30 } })
  }

  const fMG = await prisma.fauteuil.create({ data: { siteId: siteMG, nom: `Fauteuil sec ${SUFFIXE}` } })
  const fGP = await prisma.fauteuil.create({ data: { siteId: siteGP, nom: `Fauteuil sec ${SUFFIXE}` } })
  fauteuilMG = fMG.id
  fauteuilGP = fGP.id
  cree.fauteuils.push(fMG.id, fGP.id)

  // Le praticien de Marie-Galante est là du 07 au 12 juin, de 8h à 17h heure locale ; celui de la
  // Guadeloupe le vendredi 11.
  for (const jour of ['07', '08', '09', '10', '11', '12', '14']) {
    const plage = await prisma.plageDePresence.create({
      data: {
        praticienId: praticienMG,
        siteId: siteMG,
        fauteuilId: fauteuilMG,
        debut: h(jour, '12:00'),
        fin: h(jour, '21:00'),
      },
      select: { id: true },
    })
    cree.plages.push(plage.id)
  }
  const plageGP = await prisma.plageDePresence.create({
    data: {
      praticienId: praticienGP,
      siteId: siteGP,
      fauteuilId: fauteuilGP,
      debut: h('11', '12:00'),
      fin: h('11', '21:00'),
    },
    select: { id: true },
  })
  cree.plages.push(plageGP.id)

  // Madame Dupont consulte dans les deux cabinets : un rendez-vous en Guadeloupe, posé par un autre.
  const patient = await prisma.patient.create({
    data: { nom: `Dupont${SUFFIXE}`, prenom: 'Marie', telephone: '+590690778899' },
    select: { id: true },
  })
  patientId = patient.id
  cree.patients.push(patient.id)
  rdvGP = await rdvDirect(siteGP, praticienGP, fauteuilGP, h('11', '14:00'))
})

beforeEach(() => {
  smsEnvoyes = []
})

afterAll(async () => {
  await prisma.envoiListeAttente.deleteMany({ where: { inscriptionId: { in: cree.inscriptions } } })
  await prisma.inscriptionListeAttente.deleteMany({ where: { id: { in: cree.inscriptions } } })
  await prisma.notification.deleteMany({ where: { rendezVous: { praticienId: { in: cree.praticiens } } } })
  await prisma.rendezVous.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.indisponibilite.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.indisponibilite.deleteMany({ where: { id: { in: cree.indispos } } })
  await prisma.exceptionPresence.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.presenceHebdomadaire.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.plageDePresence.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.fauteuil.deleteMany({ where: { id: { in: cree.fauteuils } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId: { in: cree.praticiens } } })
  await prisma.praticien.deleteMany({ where: { id: { in: cree.praticiens } } })
  await prisma.noteJour.deleteMany({ where: { auteurId: { in: cree.users } } })
  await prisma.patient.deleteMany({ where: { id: { in: cree.patients } } })
  await prisma.motifConsultation.deleteMany({ where: { id: { in: cree.motifs } } })
  // Les comptes restent : le journal d'audit les référence et ne se modifie pas.
})

// ─── 1. Ce que porte le rôle ────────────────────────────────────────────────

describe('1. Le rôle secrétaire porte exactement ses droits, ni plus ni moins', () => {
  const ATTENDUS = [
    'agenda:create',
    'agenda:delete',
    'agenda:read',
    'agenda:update',
    'motif:read',
    'note:create',
    'note:delete',
    'note:read',
    'note:update',
    'patient:create',
    'patient:read',
    'patient:update',
    'praticien:read',
    'presence:create',
    'presence:delete',
    'presence:read',
    'presence:update',
    'site:read',
  ]

  it('la matrice de la base donne à la secrétaire ces 18 droits-là, et aucun autre', () => {
    expect([...ctxSecretaire.permissions].sort()).toEqual(ATTENDUS)
  })

  it('l’assistante porte strictement les mêmes droits (règle du cabinet)', () => {
    expect([...ctxAssistante.permissions].sort()).toEqual([...ctxSecretaire.permissions].sort())
  })

  it('ni lecture des comptes, ni journal, ni postes, ni validation, ni déblocage, ni configuration', () => {
    for (const interdit of [
      'utilisateur:read',
      'utilisateur:create',
      'utilisateur:update',
      'audit:read',
      'session:read',
      'session:delete',
      'workstation:read',
      'workstation:create',
      'workstation:update',
      'workstation:delete',
      'agenda:valider',
      'patient:debloquer',
      'motif:create',
      'motif:update',
      'notifications:modeles',
      'praticien:create',
      'praticien:update',
      'site:update',
    ]) {
      expect(ctxSecretaire.permissions.has(interdit as ReturnType<typeof permissionKey>), interdit).toBe(false)
    }
  })

  it('elle ne voit que son cabinet : pas de portée globale', () => {
    expect(ctxSecretaire.porteeGlobale).toBe(false)
    expect([...ctxSecretaire.sitesAutorises]).toEqual([siteMG])
    expect(ctxSecretaire.roles).toEqual([RoleName.SECRETAIRE])
  })
})

// ─── 2. Le fichier patients ─────────────────────────────────────────────────

describe('2. Au téléphone : elle crée, retrouve et complète la fiche d’un patient', () => {
  let nouveau: string

  it('crée une fiche avec un nom et un numéro tapé à la française ; la fiche reste « à compléter »', async () => {
    const p = await creerPatient(ctxSecretaire, {
      nom: `Lacroix${SUFFIXE}`,
      prenom: 'Paul',
      telephone: '+590690112244',
    })
    nouveau = p.id
    cree.patients.push(p.id)
    expect(p.profilComplet).toBe(false)

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxSecretaire.userId, action: 'CREATE', entityType: 'patient', entityId: p.id },
    })
    // Ni nom ni téléphone dans le journal.
    expect(JSON.stringify(trace.metadata)).not.toContain('Lacroix')
    expect(JSON.stringify(trace.metadata)).not.toContain('690112244')
  })

  it('la retrouve par « nom prénom » dans le désordre, et par la fin du numéro', async () => {
    const parNom = await rechercherPatients(ctxSecretaire, `paul lacroix${SUFFIXE}`)
    expect(parNom.map((p) => p.id)).toEqual([nouveau])
    const parNumero = await rechercherPatients(ctxSecretaire, '690112244')
    expect(parNumero.map((p) => p.id)).toContain(nouveau)
  })

  it('une seule lettre ne déverse pas le fichier', async () => {
    expect(await rechercherPatients(ctxSecretaire, 'l')).toEqual([])
  })

  it('complète la fiche (date de naissance) : elle passe « complète », le journal ne cite que les champs', async () => {
    await modifierPatient(ctxSecretaire, {
      id: nouveau,
      nom: `Lacroix${SUFFIXE}`,
      prenom: 'Paul',
      telephone: '+590690112244',
      dateNaissance: '1980-02-14',
      email: 'paul.lacroix@exemple.fr',
      representantLegal: null,
      telephoneRepresentant: null,
    } as never)
    const p = await prisma.patient.findUniqueOrThrow({ where: { id: nouveau } })
    expect(p.profilComplet).toBe(true)
    expect(p.email).toBe('paul.lacroix@exemple.fr')

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxSecretaire.userId, action: 'UPDATE', entityType: 'patient', entityId: nouveau },
      orderBy: { id: 'desc' },
    })
    expect(trace.metadata).toMatchObject({ champs: expect.arrayContaining(['dateNaissance', 'email']) })
    expect(JSON.stringify(trace.metadata)).not.toContain('1980')
  })

  it('chaque recherche est tracée, même celle qui ne trouve rien', async () => {
    const avant = new Date()
    await rechercherPatients(ctxSecretaire, `introuvable${SUFFIXE}`)
    const trace = await prisma.auditLog.findFirst({
      where: { actorId: ctxSecretaire.userId, action: 'READ', entityType: 'patient', occurredAt: { gte: avant } },
    })
    expect(trace?.itemCount).toBe(0)
  })
})

describe('2 bis. Madame Dupont consulte dans les deux cabinets : la secrétaire de Marie-Galante voit la patiente, pas ce qui se passe en Guadeloupe', () => {
  let rdvMG: string

  beforeAll(async () => {
    rdvMG = await rdvDirect(siteMG, praticienMG, fauteuilMG, h('08', '13:00'))
  })

  it('la fiche s’ouvre (le patient n’appartient à aucun cabinet), avec les seuls rendez-vous de Marie-Galante', async () => {
    const fiche = await lireFichePatient(ctxSecretaire, patientId)
    expect(fiche?.patient.id).toBe(patientId)
    const ids = fiche!.rendezVous.map((r) => r.id)
    expect(ids).toContain(rdvMG)
    expect(ids).not.toContain(rdvGP)
  })

  it('la recherche rapide (⌘K) ne propose pas comme « prochain rendez-vous » celui de la Guadeloupe', async () => {
    // Le rendez-vous de Guadeloupe est le 11 juin, celui de Marie-Galante le 8 : on retire celui de
    // Marie-Galante de l'avenir pour que seul celui de Guadeloupe puisse être « le prochain ».
    await prisma.rendezVous.update({ where: { id: rdvMG }, data: { statut: StatutRendezVous.ANNULE } })
    try {
      const [trouve] = await rechercheRapide(ctxSecretaire, `Dupont${SUFFIXE}`)
      expect(trouve?.id).toBe(patientId)
      expect(trouve?.prochain).toBeNull()
    } finally {
      await prisma.rendezVous.update({ where: { id: rdvMG }, data: { statut: StatutRendezVous.A_CONFIRMER } })
    }
  })

  it('l’adresse de la fiche d’un rendez-vous de Guadeloupe ne rend rien, pas même son existence', async () => {
    expect(await lireFicheRendezVous(ctxSecretaire, rdvGP)).toBeNull()
    expect(await lireRendezVous(ctxSecretaire, rdvGP)).toBeNull()
  })

  it('une fiche désactivée ou inconnue ne s’ouvre pas', async () => {
    expect(await lireFichePatient(ctxSecretaire, '00000000-0000-4000-8000-000000000000')).toBeNull()
  })
})

// ─── 3. Rendez-vous ─────────────────────────────────────────────────────────

describe('3. Elle donne, recopie et déplace des rendez-vous à Marie-Galante', () => {
  it('l’aperçu annonce la durée et le fauteuil avant d’enregistrer', async () => {
    const apercu = await apercuCreneau(ctxSecretaire, rdvSecretaire('07', '13:00'))
    expect(apercu).toMatchObject({ ok: true, duree: 30 })
  })

  it('crée le rendez-vous : « à confirmer », tracé sans nom de patient ni motif', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, rdvSecretaire('07', '13:00', { note: 'Appelle la veille' }))
    cree.rdv.push(rdv.id)
    expect(rdv.statut).toBe(StatutRendezVous.A_CONFIRMER)
    const enBase = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id } })
    expect(enBase.fauteuilId).toBe(fauteuilMG)
    expect(enBase.note).toBe('Appelle la veille')

    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxSecretaire.userId, action: 'CREATE', entityType: 'agenda', entityId: rdv.id },
    })
    expect(trace.metadata).toMatchObject({ siteId: siteMG, surbooking: false, horsHoraire: false })
    expect(JSON.stringify(trace.metadata)).not.toContain('Dupont')
    expect(JSON.stringify(trace.metadata)).not.toContain('Appelle')
  })

  it('refuse un créneau déjà pris, avec un motif lisible, sans rien écrire', async () => {
    const avant = await prisma.rendezVous.count({ where: { praticienId: praticienMG } })
    await expect(creerRendezVous(ctxSecretaire, rdvSecretaire('07', '13:15'))).rejects.toBeInstanceOf(
      CreneauRefuseError,
    )
    expect(await prisma.rendezVous.count({ where: { praticienId: praticienMG } })).toBe(avant)
  })

  it('refuse un jour où le praticien n’est pas là (dimanche 13)', async () => {
    await expect(creerRendezVous(ctxSecretaire, rdvSecretaire('13', '13:00'))).rejects.toBeInstanceOf(
      CreneauRefuseError,
    )
  })

  it('l’urgence sur planning plein reste au praticien : refusée, rien n’est écrit', async () => {
    const avant = await prisma.rendezVous.count({ where: { praticienId: praticienMG } })
    await expect(
      creerRendezVous(ctxSecretaire, rdvSecretaire('07', '13:00', { surbooking: true })),
    ).rejects.toBeInstanceOf(ReserveAuPraticienError)
    const apercu = await apercuCreneau(ctxSecretaire, rdvSecretaire('07', '13:00', { surbooking: true }))
    expect(apercu.ok).toBe(false)
    expect(await prisma.rendezVous.count({ where: { praticienId: praticienMG } })).toBe(avant)
  })

  it('le rendez-vous hors des horaires d’ouverture reste au praticien', async () => {
    await expect(
      creerRendezVous(ctxSecretaire, rdvSecretaire('07', '22:00', { horsHoraire: true })),
    ).rejects.toBeInstanceOf(ReserveAuPraticienError)
  })

  it('recopie un rendez-vous à une autre date : nouveau rendez-vous « à confirmer », la note n’est pas reprise', async () => {
    const source = await creerRendezVous(ctxSecretaire, rdvSecretaire('08', '15:00', { note: 'En retard' }))
    cree.rdv.push(source.id)
    const copie = await dupliquerRendezVous(ctxSecretaire, { id: source.id, debut: h('09', '15:00') })
    cree.rdv.push(copie.id)
    const enBase = await prisma.rendezVous.findUniqueOrThrow({ where: { id: copie.id } })
    expect(enBase).toMatchObject({ patientId, praticienId: praticienMG, siteId: siteMG, note: null })
    expect(enBase.statut).toBe(StatutRendezVous.A_CONFIRMER)
    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxSecretaire.userId, action: 'CREATE', entityId: copie.id },
    })
    expect(trace.metadata).toMatchObject({ dupliqueDe: source.id })
  })

  it('déplace un rendez-vous : le journal garde l’heure d’avant et celle d’après', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, rdvSecretaire('09', '17:00'))
    cree.rdv.push(rdv.id)
    await deplacerRendezVous(ctxSecretaire, { id: rdv.id, debut: h('10', '17:00') })
    const enBase = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id } })
    expect(enBase.debut.toISOString()).toBe(h('10', '17:00').toISOString())
    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxSecretaire.userId, action: 'UPDATE', entityType: 'agenda', entityId: rdv.id },
      orderBy: { id: 'desc' },
    })
    expect(trace.metadata).toMatchObject({
      avant: { debut: h('09', '17:00').toISOString() },
      apres: { debut: h('10', '17:00').toISOString() },
    })
  })

  it('allonge un rendez-vous de 30 à 45 minutes', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, rdvSecretaire('10', '13:00'))
    cree.rdv.push(rdv.id)
    const r = await deplacerRendezVous(ctxSecretaire, { id: rdv.id, debut: h('10', '13:00'), dureeMinutes: 45 })
    expect((r.fin.getTime() - r.debut.getTime()) / 60_000).toBe(45)
  })

  it('refuse un déplacement vers un jour sans le praticien, et le rendez-vous ne bouge pas', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, rdvSecretaire('10', '15:00'))
    cree.rdv.push(rdv.id)
    await expect(deplacerRendezVous(ctxSecretaire, { id: rdv.id, debut: h('13', '15:00') })).rejects.toBeInstanceOf(
      CreneauRefuseError,
    )
    const enBase = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv.id } })
    expect(enBase.debut.toISOString()).toBe(h('10', '15:00').toISOString())
  })
})

describe('4. Elle suit le patient du comptoir à la caisse', () => {
  it('à confirmer → confirmé → salle d’attente → au fauteuil → terminé → en caisse, chaque pas tracé', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, rdvSecretaire('12', '13:00'))
    cree.rdv.push(rdv.id)
    const parcours = [
      StatutRendezVous.CONFIRME,
      StatutRendezVous.SALLE_ATTENTE,
      StatutRendezVous.AU_FAUTEUIL,
      StatutRendezVous.TERMINE,
      StatutRendezVous.EN_CAISSE,
    ]
    for (const statut of parcours) {
      const r = await changerStatut(ctxSecretaire, { id: rdv.id, statut })
      expect(r.statut).toBe(statut)
    }
    const traces = await prisma.auditLog.findMany({
      where: { actorId: ctxSecretaire.userId, action: 'UPDATE', entityType: 'agenda', entityId: rdv.id },
      orderBy: { id: 'asc' },
    })
    expect(traces.map((t) => (t.metadata as { statutApres: string }).statutApres)).toEqual(parcours)
    // Aucun SMS au patient pour un changement de statut.
    expect(smsEnvoyes).toEqual([])
  })

  it('« absent » coûte un point au patient ; corriger la ligne le lui rend', async () => {
    const p = await prisma.patient.create({
      data: { nom: `Absent${SUFFIXE}`, prenom: 'Léa', telephone: '+590690334455' },
      select: { id: true },
    })
    cree.patients.push(p.id)
    const rdv = await creerRendezVous(ctxSecretaire, { ...rdvSecretaire('12', '14:00'), patientId: p.id })
    cree.rdv.push(rdv.id)

    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ABSENT })
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: p.id } })).manquements).toBe(1)
    // Recliquer « absent » ne compte pas deux fois.
    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ABSENT })
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: p.id } })).manquements).toBe(1)

    await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.SALLE_ATTENTE })
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: p.id } })).manquements).toBe(0)
  })

  it('le troisième « absent » ferme la réservation en ligne ; elle voit la liste des patients bloqués', async () => {
    const p = await prisma.patient.create({
      data: { nom: `Bloque${SUFFIXE}`, prenom: 'Hugo', telephone: '+590690556677' },
      select: { id: true },
    })
    cree.patients.push(p.id)
    for (const heure of ['15:00', '15:30', '16:00']) {
      const rdv = await creerRendezVous(ctxSecretaire, { ...rdvSecretaire('12', heure), patientId: p.id })
      cree.rdv.push(rdv.id)
      await changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ABSENT })
    }
    const patient = await prisma.patient.findUniqueOrThrow({ where: { id: p.id } })
    expect(patient).toMatchObject({ manquements: 3, reservationBloquee: true })

    const bloques = await patientsBloques(ctxSecretaire)
    expect(bloques.find((b) => b.id === p.id)).toMatchObject({ absences: 3 })
  })

  it('« demande d’annulation » ne se choisit pas dans le menu des statuts', async () => {
    const rdv = await creerRendezVous(ctxSecretaire, rdvSecretaire('12', '17:00'))
    cree.rdv.push(rdv.id)
    await expect(
      changerStatut(ctxSecretaire, { id: rdv.id, statut: StatutRendezVous.ANNULATION_DEMANDEE }),
    ).rejects.toThrow(/ne se choisit pas/)
  })
})

describe('5. Annulation : la secrétaire demande, le praticien tranche', () => {
  let rdv: string

  beforeAll(async () => {
    const r = await creerRendezVous(ctxSecretaire, rdvSecretaire('14', '13:00'))
    cree.rdv.push(r.id)
    rdv = r.id
    await changerStatut(ctxSecretaire, { id: rdv, statut: StatutRendezVous.CONFIRME })
  })

  it('« Annuler » devient une demande : aucun SMS, aucun point retiré, le statut d’avant est gardé', async () => {
    const r = await annulerRendezVous(ctxSecretaire, { id: rdv, raison: 'Patient malade' })
    expect(r.statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
    const enBase = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv } })
    expect(enBase).toMatchObject({
      statutAvantAnnulation: StatutRendezVous.CONFIRME,
      annulationDemandeeParId: ctxSecretaire.userId,
      manquementCompte: false,
    })
    expect(smsEnvoyes).toEqual([])
    const trace = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: ctxSecretaire.userId, action: 'ANNULATION_DEMANDEE', entityId: rdv },
    })
    expect(JSON.stringify(trace.metadata)).not.toContain('malade')
  })

  it('tant que la demande attend, le créneau reste occupé : personne ne peut le reprendre', async () => {
    await expect(creerRendezVous(ctxSecretaire, rdvSecretaire('14', '13:00'))).rejects.toBeInstanceOf(
      CreneauRefuseError,
    )
  })

  it('elle ne peut ni redemander, ni faire avancer le rendez-vous pendant l’attente', async () => {
    await expect(annulerRendezVous(ctxSecretaire, { id: rdv })).rejects.toBeInstanceOf(AnnulationDejaDemandeeError)
    await expect(
      changerStatut(ctxSecretaire, { id: rdv, statut: StatutRendezVous.SALLE_ATTENTE }),
    ).rejects.toBeInstanceOf(AnnulationDejaDemandeeError)
  })

  it('elle ne peut ni valider ni refuser sa propre demande — refus tracés, rendez-vous intact', async () => {
    const depuis = new Date()
    await expect(validerAnnulation(ctxSecretaire, { id: rdv })).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(refuserAnnulation(ctxSecretaire, { id: rdv })).rejects.toBeInstanceOf(PermissionDeniedError)
    await expect(lireDemandesAnnulationEnAttente(ctxSecretaire)).rejects.toBeInstanceOf(PermissionDeniedError)
    expect(await refusTrace('agenda:valider', depuis)).not.toBeNull()
    const enBase = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdv } })
    expect(enBase.statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
    expect(smsEnvoyes).toEqual([])
  })

  it('« Annulé » choisi dans le menu des statuts ne fait, lui aussi, qu’une demande', async () => {
    const r = await creerRendezVous(ctxSecretaire, rdvSecretaire('14', '15:00'))
    cree.rdv.push(r.id)
    const resultat = await changerStatut(ctxSecretaire, { id: r.id, statut: StatutRendezVous.ANNULE })
    expect(resultat.statut).toBe(StatutRendezVous.ANNULATION_DEMANDEE)
  })

  it('le praticien du rendez-vous valide : annulé, et le patient est prévenu', async () => {
    const r = await validerAnnulation(ctxPraticien, { id: rdv })
    expect(r.statut).toBe(StatutRendezVous.ANNULE)
  })
})

// ─── 6. La journée du cabinet ───────────────────────────────────────────────

describe('6. Elle tient la journée : notes du jour, présences, absences, liste d’attente, accueil', () => {
  it('écrit, corrige et efface la note du jour de Marie-Galante', async () => {
    const note = await creerNoteJour(ctxSecretaire, { siteId: siteMG, jour: '2027-06-07', texte: 'Livraison à 10h' })
    cree.notes.push(note.id)
    await modifierNoteJour(ctxSecretaire, { id: note.id, texte: 'Livraison à 11h' })
    const lues = await listerNotesJour(ctxSecretaire, { premierJour: '2027-06-07', dernierJour: '2027-06-07' })
    expect(lues.find((n) => n.id === note.id)?.texte).toBe('Livraison à 11h')
    await supprimerNoteJour(ctxSecretaire, { id: note.id })
    expect(await prisma.noteJour.findUnique({ where: { id: note.id } })).toBeNull()
  })

  it('ne lit, n’écrit ni n’efface aucune note de la Guadeloupe', async () => {
    const noteGP = await prisma.noteJour.create({
      data: {
        siteId: siteGP,
        jour: new Date('2027-06-11T00:00:00Z'),
        texte: 'Bateau de 7h',
        auteurId: ctxAdmin.userId,
      },
    })
    try {
      const lues = await listerNotesJour(ctxSecretaire, { premierJour: '2027-06-11', dernierJour: '2027-06-11' })
      expect(lues.map((n) => n.id)).not.toContain(noteGP.id)
      await expect(
        listerNotesJour(ctxSecretaire, { premierJour: '2027-06-11', dernierJour: '2027-06-11' }, { siteId: siteGP }),
      ).rejects.toBeInstanceOf(PorteeSiteError)
      await expect(
        creerNoteJour(ctxSecretaire, { siteId: siteGP, jour: '2027-06-11', texte: 'x' }),
      ).rejects.toBeInstanceOf(PorteeSiteError)
      await expect(modifierNoteJour(ctxSecretaire, { id: noteGP.id, texte: 'x' })).rejects.toBeInstanceOf(
        PorteeSiteError,
      )
      await expect(supprimerNoteJour(ctxSecretaire, { id: noteGP.id })).rejects.toBeInstanceOf(PorteeSiteError)
      expect((await prisma.noteJour.findUniqueOrThrow({ where: { id: noteGP.id } })).texte).toBe('Bateau de 7h')
    } finally {
      await prisma.noteJour.delete({ where: { id: noteGP.id } })
    }
  })

  it('pose une journée dans la semaine type du praticien de Marie-Galante, puis la retire', async () => {
    const pose = await enregistrerJourSemaineType(ctxSecretaire, {
      praticienId: praticienPresences,
      jourSemaine: 3,
      actif: true,
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      heureDebut: '08:00',
      heureFin: '12:00',
    })
    expect(pose.creees).toBeGreaterThan(0)
    const retrait = await enregistrerJourSemaineType(ctxSecretaire, {
      praticienId: praticienPresences,
      jourSemaine: 3,
      actif: false,
    })
    expect(retrait.supprimees).toBe(pose.creees)
    expect(await prisma.presenceHebdomadaire.count({ where: { praticienId: praticienPresences } })).toBe(0)
  })

  it('ne pose aucune présence en Guadeloupe', async () => {
    await expect(
      enregistrerJourSemaineType(ctxSecretaire, {
        praticienId: praticienGP,
        jourSemaine: 5,
        actif: true,
        siteId: siteGP,
        fauteuilId: fauteuilGP,
        heureDebut: '08:00',
        heureFin: '12:00',
      }),
    ).rejects.toBeInstanceOf(PorteeSiteError)
    await expect(
      enregistrerException(ctxSecretaire, {
        praticienId: praticienGP,
        date: '2027-06-18',
        type: 'AJOUT_OU_MODIFICATION',
        siteId: siteGP,
        fauteuilId: fauteuilGP,
        heureDebut: '08:00',
        heureFin: '12:00',
      }),
    ).rejects.toBeInstanceOf(PorteeSiteError)
  })

  it('ajoute une journée exceptionnelle à Marie-Galante, puis la supprime', async () => {
    await enregistrerException(ctxSecretaire, {
      praticienId: praticienPresences,
      date: '2027-06-19',
      type: 'AJOUT_OU_MODIFICATION',
      siteId: siteMG,
      fauteuilId: fauteuilMG,
      heureDebut: '08:00',
      heureFin: '12:00',
    })
    const exception = await prisma.exceptionPresence.findFirstOrThrow({ where: { praticienId: praticienPresences } })
    await supprimerException(ctxSecretaire, { id: exception.id })
    expect(await prisma.exceptionPresence.count({ where: { praticienId: praticienPresences } })).toBe(0)
  })

  it('pose un congé au praticien de Marie-Galante, puis le retire', async () => {
    const conge = await creerIndisponibilite(ctxSecretaire, {
      type: 'CONGE',
      praticienId: praticienMG,
      joursEntiers: true,
      dateDebut: '2027-06-21',
      dateFin: '2027-06-25',
    })
    cree.indispos.push(conge.id)
    await supprimerIndisponibilite(ctxSecretaire, { id: conge.id })
    expect(await prisma.indisponibilite.findUnique({ where: { id: conge.id } })).toBeNull()
  })

  it('un congé qui tomberait sur des rendez-vous déjà pris est refusé, avec leur liste', async () => {
    await expect(
      creerIndisponibilite(ctxSecretaire, {
        type: 'CONGE',
        praticienId: praticienMG,
        joursEntiers: true,
        dateDebut: '2027-06-12',
        dateFin: '2027-06-12',
      }),
    ).rejects.toBeInstanceOf(IndisponibiliteBloqueeError)
  })

  it('ne ferme pas le cabinet de la Guadeloupe et ne pose pas de congé à son praticien', async () => {
    await expect(
      creerIndisponibilite(ctxSecretaire, {
        type: 'FERMETURE',
        siteId: siteGP,
        joursEntiers: true,
        dateDebut: '2027-06-25',
        dateFin: '2027-06-25',
      }),
    ).rejects.toBeInstanceOf(PorteeSiteError)
    await expect(
      creerIndisponibilite(ctxSecretaire, {
        type: 'CONGE',
        praticienId: praticienGP,
        joursEntiers: true,
        dateDebut: '2027-06-11',
        dateFin: '2027-06-11',
      }),
    ).rejects.toBeInstanceOf(PorteeSiteError)
  })

  it('voit la liste d’attente de Marie-Galante, pas celle de la Guadeloupe', async () => {
    const expiresAt = new Date(Date.now() + 30 * 86_400_000)
    const mg = await prisma.inscriptionListeAttente.create({
      data: { telephone: '+590690778899', motifId, siteId: siteMG, expiresAt },
    })
    const gp = await prisma.inscriptionListeAttente.create({
      data: { telephone: '+590690778899', motifId, siteId: siteGP, expiresAt },
    })
    cree.inscriptions.push(mg.id, gp.id)
    const liste = await lireListeAttente(ctxSecretaire)
    const ids = liste.map((i) => i.id)
    expect(ids).toContain(mg.id)
    expect(ids).not.toContain(gp.id)
    // Le nom se retrouve par le numéro.
    expect(JSON.stringify(liste.find((i) => i.id === mg.id))).toContain(`Dupont${SUFFIXE}`)
  })

  it('ouvre l’accueil de Marie-Galante ; celui de la Guadeloupe lui est refusé et tracé', async () => {
    const mg = { id: siteMG, code: SiteCode.MARIE_GALANTE, nom: 'Cabinet de Marie-Galante' }
    const gp = { id: siteGP, code: SiteCode.GUADELOUPE, nom: 'Cabinet de Guadeloupe' }
    const accueil = await lireAccueil(ctxSecretaire, mg, [mg], { maintenant: h('12', '12:30') })
    expect(accueil.jour).toBe('2027-06-12')
    expect(accueil.rendezVousDuJour).toBeGreaterThan(0)

    const depuis = new Date()
    await expect(lireAccueil(ctxSecretaire, gp, [gp], { maintenant: h('11', '12:30') })).rejects.toBeInstanceOf(
      PorteeSiteError,
    )
    expect(await refusTrace('portee:site', depuis)).not.toBeNull()
  })

  it('lit les praticiens, les motifs et les deux cabinets, mais seulement les fauteuils de Marie-Galante', async () => {
    expect((await listerPraticiens(ctxSecretaire)).map((p) => p.id)).toEqual(
      expect.arrayContaining([praticienMG, praticienGP]),
    )
    expect((await listerMotifs(ctxSecretaire)).map((m) => m.id)).toContain(motifId)
    await expect(listerMotifsPatientAdmin(ctxSecretaire)).resolves.toBeDefined()
    expect(await listerSites(ctxSecretaire)).toHaveLength(2)
    const fauteuils = await listerFauteuils(ctxSecretaire)
    expect(fauteuils.map((f) => f.id)).toContain(fauteuilMG)
    expect(fauteuils.map((f) => f.id)).not.toContain(fauteuilGP)
  })
})

// ─── 7. Le cloisonnement ────────────────────────────────────────────────────

describe('7. Rien de l’agenda de la Guadeloupe ne lui parvient, par aucun chemin', () => {
  const SEMAINE = { debut: h('07', '04:00'), fin: h('14', '04:00') }

  it('l’agenda de la semaine ne contient pas le rendez-vous de Guadeloupe ; le demander nommément est refusé', async () => {
    const rdvs = await listerRendezVous(ctxSecretaire, SEMAINE)
    expect(rdvs.length).toBeGreaterThan(0)
    expect(rdvs.every((r) => r.site.id === siteMG)).toBe(true)
    await expect(listerRendezVous(ctxSecretaire, SEMAINE, { siteId: siteGP })).rejects.toBeInstanceOf(PorteeSiteError)
  })

  it('les compteurs de la vue mois et les présences ignorent la Guadeloupe', async () => {
    const parJour = await compterRendezVousParJour(ctxSecretaire, SEMAINE)
    // Le 11 juin n'a qu'un rendez-vous : celui de Guadeloupe.
    expect(parJour.get('2027-06-08')).toBeGreaterThan(0)
    expect(parJour.get('2027-06-11') ?? 0).toBe(0)
    const presences = await listerPresences(ctxSecretaire, SEMAINE)
    expect(presences.every((p) => p.site.id === siteMG)).toBe(true)
    await expect(compterRendezVousParJour(ctxSecretaire, SEMAINE, { siteId: siteGP })).rejects.toBeInstanceOf(
      PorteeSiteError,
    )
  })

  it('la vue consolidée des deux cabinets lui est refusée', async () => {
    await expect(listerRendezVousConsolide(ctxSecretaire, SEMAINE)).rejects.toBeInstanceOf(PorteeConsolideeError)
  })

  it('aucun geste ne touche le rendez-vous de Guadeloupe : il reste tel quel', async () => {
    const avant = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdvGP } })
    await expect(changerStatut(ctxSecretaire, { id: rdvGP, statut: StatutRendezVous.CONFIRME })).rejects.toThrow(
      'introuvable',
    )
    await expect(deplacerRendezVous(ctxSecretaire, { id: rdvGP, debut: h('11', '15:00') })).rejects.toThrow(
      'introuvable',
    )
    await expect(annulerRendezVous(ctxSecretaire, { id: rdvGP })).rejects.toThrow('introuvable')
    await expect(dupliquerRendezVous(ctxSecretaire, { id: rdvGP, debut: h('11', '16:00') })).rejects.toThrow(
      'introuvable',
    )
    const apres = await prisma.rendezVous.findUniqueOrThrow({ where: { id: rdvGP } })
    expect(apres).toEqual(avant)
  })

  it('créer ou prévisualiser un rendez-vous en Guadeloupe est refusé et tracé', async () => {
    const depuis = new Date()
    const enGP = { ...rdvSecretaire('11', '15:00'), praticienId: praticienGP, siteId: siteGP }
    await expect(creerRendezVous(ctxSecretaire, enGP)).rejects.toBeInstanceOf(PorteeSiteError)
    await expect(apercuCreneau(ctxSecretaire, enGP)).rejects.toBeInstanceOf(PorteeSiteError)
    expect(await prisma.rendezVous.count({ where: { praticienId: praticienGP } })).toBe(1)
    const trace = await refusTrace('portee:site', depuis)
    expect(trace?.entityId).toBe(siteGP)
  })

  it('une secrétaire rattachée à aucun cabinet ne voit rien et ne crée rien', async () => {
    const orpheline = await compte(RoleName.SECRETAIRE, 'orpheline', [])
    expect(await listerRendezVous(orpheline, SEMAINE)).toEqual([])
    await expect(creerRendezVous(orpheline, rdvSecretaire('07', '18:00'))).rejects.toBeInstanceOf(PorteeSiteError)
  })
})

// ─── 8. Ce qui reste à l'administration ─────────────────────────────────────

describe('8. Ce qui reste à l’administrateur : chaque essai est refusé, tracé, et n’écrit rien', () => {
  const INCONNU = '00000000-0000-4000-8000-000000000000'
  let cible: string
  let bloque: string

  beforeAll(async () => {
    const u = await compte(RoleName.ASSISTANTE, 'cible', [siteMG])
    cible = u.userId
    const p = await prisma.patient.create({
      data: {
        nom: `Sanction${SUFFIXE}`,
        prenom: 'Zoé',
        telephone: '+590690998877',
        manquements: 3,
        reservationBloquee: true,
      },
      select: { id: true },
    })
    bloque = p.id
    cree.patients.push(p.id)
  })

  const essais: [string, string, () => Promise<unknown>][] = [
    ['lire la liste du personnel', 'utilisateur:read', () => listerUtilisateurs(ctxSecretaire)],
    ['lire le compte d’une collègue', 'utilisateur:read', () => lireUtilisateur(ctxSecretaire, cible)],
    ['lire les indicateurs de sécurité', 'utilisateur:read', () => lireIndicateurs(ctxSecretaire)],
    [
      'créer un compte',
      'utilisateur:create',
      () =>
        creerUtilisateur(ctxSecretaire, {
          email: `intrus-${SUFFIXE}@test.local`,
          nom: 'Intrus',
          prenom: 'X',
          motDePasse: 'motdepasse-tres-long-1',
          roles: [RoleName.ADMIN],
          siteIds: [],
        } as never),
    ],
    [
      'se donner le rôle administrateur',
      'utilisateur:update',
      () => modifierUtilisateur(ctxSecretaire, ctxSecretaire.userId, { roles: [RoleName.ADMIN] }),
    ],
    ['désactiver une collègue', 'utilisateur:update', () => desactiverUtilisateur(ctxSecretaire, cible)],
    ['réactiver un compte', 'utilisateur:update', () => reactiverUtilisateur(ctxSecretaire, cible)],
    ['réinitialiser un second facteur', 'utilisateur:update', () => reinitialiserMfa(ctxSecretaire, cible)],
    ['lire le journal', 'audit:read', () => lireActiviteRecente(ctxSecretaire, 60)],
    ['lister les postes', 'workstation:read', () => listerPostes(ctxSecretaire)],
    ['renommer un poste', 'workstation:update', () => nommerPoste(ctxSecretaire, INCONNU, { nom: 'x', siteId: null })],
    ['désactiver un poste', 'workstation:delete', () => desactiverPoste(ctxSecretaire, INCONNU)],
    ['lire les modèles de messages', 'notifications:modeles', () => listerModelesMessages(ctxSecretaire)],
    [
      'modifier un modèle de message',
      'notifications:modeles',
      () =>
        enregistrerModeleMessage(ctxSecretaire, {
          type: TypeNotification.RAPPEL_J2,
          canal: CanalNotification.SMS,
          corps: 'Piraté',
        } as never),
    ],
    [
      'remettre un modèle par défaut',
      'notifications:modeles',
      () => reinitialiserModeleMessage(ctxSecretaire, TypeNotification.RAPPEL_J2, CanalNotification.SMS),
    ],
    ['ajouter un motif au menu patient', 'motif:create', () => creerMotifPatient(ctxSecretaire, {} as never)],
    [
      'modifier un motif du menu patient',
      'motif:update',
      () => modifierMotifPatient(ctxSecretaire, { id: INCONNU } as never),
    ],
    ['supprimer un motif du menu patient', 'motif:update', () => supprimerMotifPatient(ctxSecretaire, INCONNU)],
    ['débloquer un patient sanctionné', 'patient:debloquer', () => debloquerPatient(ctxSecretaire, { id: bloque })],
  ]

  it.each(essais)('%s', async (_libelle, raison, essai) => {
    const depuis = new Date()
    await expect(essai()).rejects.toBeInstanceOf(PermissionDeniedError)
    const trace = await refusTrace(raison, depuis)
    expect(trace, `refus « ${raison} » non tracé`).not.toBeNull()
    expect(trace?.actorRoles).toEqual([RoleName.SECRETAIRE])
  })

  it('après tous ces essais, rien n’a bougé : ni son rôle, ni la collègue, ni le patient bloqué', async () => {
    const elle = await loadAuthContext(ctxSecretaire.userId, ORIGINE)
    expect(elle?.roles).toEqual([RoleName.SECRETAIRE])
    expect((await prisma.user.findUniqueOrThrow({ where: { id: cible } })).actif).toBe(true)
    expect(await prisma.user.count({ where: { email: `intrus-${SUFFIXE}@test.local` } })).toBe(0)
    expect(await prisma.patient.findUniqueOrThrow({ where: { id: bloque } })).toMatchObject({
      reservationBloquee: true,
      manquements: 3,
    })
    expect(
      await prisma.modeleMessage.count({
        where: { type: TypeNotification.RAPPEL_J2, canal: CanalNotification.SMS, corps: 'Piraté' },
      }),
    ).toBe(0)
  })

  it('la base elle-même lui refuserait d’écrire au journal à la place de l’application (rôle cabinet_app)', async () => {
    // Le journal ne se modifie pas, quel que soit le compte : c'est la base qui le garantit (D9).
    await expect(prisma.auditLog.deleteMany({ where: { actorId: ctxSecretaire.userId } })).rejects.toThrow()
  })
})

describe('9. Une concurrence au comptoir : deux secrétaires prennent le même créneau à la même seconde', () => {
  it('l’une l’obtient, l’autre reçoit un refus clair — jamais deux patients sur le même fauteuil', async () => {
    const collegue = await compte(RoleName.SECRETAIRE, 'collegue', [siteMG])
    const autre = await prisma.patient.create({
      data: { nom: `Concurrent${SUFFIXE}`, prenom: 'Max', telephone: '+590690121212' },
      select: { id: true },
    })
    cree.patients.push(autre.id)
    const resultats = await Promise.allSettled([
      creerRendezVous(ctxSecretaire, rdvSecretaire('09', '19:00')),
      creerRendezVous(collegue, { ...rdvSecretaire('09', '19:00'), patientId: autre.id }),
    ])
    const ok = resultats.filter((r) => r.status === 'fulfilled')
    for (const r of ok) cree.rdv.push((r as PromiseFulfilledResult<{ id: string }>).value.id)
    expect(ok).toHaveLength(1)
    const refus = resultats.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(refus.reason instanceof CreneauPrisEntretempsError || refus.reason instanceof CreneauRefuseError).toBe(true)
  })
})
