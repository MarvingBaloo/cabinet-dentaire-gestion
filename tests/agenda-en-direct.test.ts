import { RoleName, SiteCode, StatutRendezVous } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type AuthContext, loadAuthContext } from '@/server/auth/context'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import { type EvenementAgenda, abonnerAgenda, arreterEcouteAgenda, texteBanniere } from '@/server/temps-reel/agenda'

// Agenda en direct (D61). Ce que ces tests éprouvent, et qu'une relecture ne
// montre pas : que le déclencheur part bien de la base pour une écriture faite
// hors des services (portail, worker), que le filtre de site (D5) tient pour ce
// qui est poussé, et que l'auteur d'un geste n'est pas prévenu de son propre geste.

const SUFFIXE = Date.now()
const ORIGINE = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

let siteMG: string
let siteGP: string
let fauteuilMG: string
let praticienId: string
let motifId: string
let patientId: string
let ctxMG: AuthContext
let ctxGP: AuthContext
let ctxAuteur: AuthContext
const cree = { rdv: [] as string[], users: [] as string[] }

async function compte(role: RoleName, sites: string[], prenom: string): Promise<AuthContext> {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  const u = await prisma.user.create({
    data: {
      email: `direct-${prenom.toLowerCase()}-${SUFFIXE}@test.local`,
      nom: `Direct${SUFFIXE}`,
      prenom,
      passwordHash: 'x',
      roles: { create: { roleId: r.id } },
      sites: { create: sites.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  })
  cree.users.push(u.id)
  const ctx = await loadAuthContext(u.id, ORIGINE)
  if (!ctx) throw new Error('contexte introuvable')
  return ctx
}

/** Le prochain événement reçu par cet abonnement, ou `null` au bout d'un délai. */
function prochain(recus: EvenementAgenda[], delaiMs = 3000): Promise<EvenementAgenda | null> {
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
  siteGP = (await prisma.site.findUniqueOrThrow({ where: { code: SiteCode.GUADELOUPE } })).id
  fauteuilMG = (await prisma.fauteuil.findFirstOrThrow({ where: { siteId: siteMG } })).id
  praticienId = (
    await prisma.praticien.create({ data: { nom: `Direct${SUFFIXE}`, prenom: 'Test', couleur: '#0078cc' } })
  ).id
  motifId = (
    await prisma.motifConsultation.create({
      data: { libelle: `Urgence directe ${SUFFIXE}`, dureeIndicative: 30, couleur: '#dc2626', estUrgence: true },
    })
  ).id
  patientId = (
    await prisma.patient.create({
      data: { nom: 'Moutoussamy', prenom: `Nathalie${SUFFIXE}`, telephone: `+33639${String(SUFFIXE).slice(-6)}` },
    })
  ).id
  ctxMG = await compte(RoleName.SECRETAIRE, [siteMG], 'Nadia')
  ctxGP = await compte(RoleName.SECRETAIRE, [siteGP], 'Lea')
  ctxAuteur = await compte(RoleName.SECRETAIRE, [siteMG], 'Sophie')
})

afterAll(async () => {
  await arreterEcouteAgenda()
  await prisma.rendezVous.deleteMany({ where: { id: { in: cree.rdv } } })
  await prisma.praticien.deleteMany({ where: { id: praticienId } })
  await prisma.patient.deleteMany({ where: { id: patientId } })
  await prisma.motifConsultation.deleteMany({ where: { id: motifId } })
  await prisma.$disconnect()
})

describe('texte du bandeau (D61)', () => {
  const rdv = { debut: new Date('2026-10-12T16:15:00.000Z'), patient: 'Nathalie Moutoussamy', urgence: true }

  it('nomme l’auteur, l’urgence, l’heure, puis le jour et le patient', () => {
    expect(
      texteBanniere({ op: 'INSERT', statut: 'CONFIRME', ancienStatut: null, deplace: false }, rdv, 'Dr Aubertin'),
    ).toEqual({
      titre: 'Dr Aubertin a ajouté une urgence à 12:15',
      detail: 'Lundi 12 octobre · Nathalie Moutoussamy',
    })
  })

  it('sans auteur tracé, le geste vient du portail patient', () => {
    expect(
      texteBanniere(
        { op: 'INSERT', statut: 'A_CONFIRMER', ancienStatut: null, deplace: false },
        { ...rdv, urgence: false },
        null,
      )?.titre,
    ).toBe('Réservation en ligne à 12:15')
    expect(
      texteBanniere({ op: 'UPDATE', statut: 'ANNULE', ancienStatut: 'CONFIRME', deplace: false }, rdv, null)?.titre,
    ).toBe('Annulé par le patient : 12:15')
  })

  it('un simple changement de statut rafraîchit sans bandeau', () => {
    expect(
      texteBanniere(
        { op: 'UPDATE', statut: 'SALLE_ATTENTE', ancienStatut: 'CONFIRME', deplace: false },
        rdv,
        'Sophie Bernard',
      ),
    ).toBeNull()
  })
})

describe('écoute de la base et filtre de site (D61, D5)', () => {
  it('prévient Marie-Galante d’une écriture faite hors des services, pas la Guadeloupe', async () => {
    const recusMG: EvenementAgenda[] = []
    const recusGP: EvenementAgenda[] = []
    const fin1 = await abonnerAgenda(ctxMG, (e) => recusMG.push(e))
    const fin2 = await abonnerAgenda(ctxGP, (e) => recusGP.push(e))

    const attenteMG = prochain(recusMG)
    const attenteGP = prochain(recusGP, 1500)
    const rdv = await prisma.rendezVous.create({
      data: {
        patientId,
        praticienId,
        siteId: siteMG,
        fauteuilId: fauteuilMG,
        motifId,
        debut: new Date(Date.UTC(2028, 2, 6, 13, 0)),
        fin: new Date(Date.UTC(2028, 2, 6, 13, 30)),
        statut: StatutRendezVous.A_CONFIRMER,
      },
    })
    cree.rdv.push(rdv.id)

    const evMG = await attenteMG
    expect(evMG?.id).toBe(rdv.id)
    expect(evMG?.banniere?.titre).toBe('Réservation en ligne à 09:00')
    expect(await attenteGP).toBeNull()
    fin1()
    fin2()
  })

  it('l’auteur d’un déplacement n’est pas prévenu, sa collègue l’est avec son nom', async () => {
    const rdv = await prisma.rendezVous.create({
      data: {
        patientId,
        praticienId,
        siteId: siteMG,
        fauteuilId: fauteuilMG,
        motifId,
        debut: new Date(Date.UTC(2028, 2, 7, 13, 0)),
        fin: new Date(Date.UTC(2028, 2, 7, 13, 30)),
        statut: StatutRendezVous.CONFIRME,
      },
    })
    cree.rdv.push(rdv.id)
    await new Promise((r) => setTimeout(r, 300))

    const recusMG: EvenementAgenda[] = []
    const recusAuteur: EvenementAgenda[] = []
    const fin1 = await abonnerAgenda(ctxMG, (e) => recusMG.push(e))
    const fin2 = await abonnerAgenda(ctxAuteur, (e) => recusAuteur.push(e))
    const attenteMG = prochain(recusMG)
    const attenteAuteur = prochain(recusAuteur, 1500)

    await prisma.$transaction(async (tx) => {
      await tx.rendezVous.update({
        where: { id: rdv.id },
        data: { debut: new Date(Date.UTC(2028, 2, 7, 14, 0)), fin: new Date(Date.UTC(2028, 2, 7, 14, 30)) },
      })
      await recordAudit(tx, ctxAuteur, { action: 'UPDATE', entityType: 'agenda', entityId: rdv.id })
    })

    expect((await attenteMG)?.banniere?.titre).toBe(`Sophie Direct${SUFFIXE} a déplacé un rendez-vous à 10:00`)
    expect(await attenteAuteur).toBeNull()
    fin1()
    fin2()
  })
})
