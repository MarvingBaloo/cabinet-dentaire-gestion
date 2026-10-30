import { NiveauUrgence, TypeIndisponibilite } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { decalerJour, jourLocal } from '@/lib/dates'
import { chercherCreneaux } from '@/server/assistant/agenda-assistant'
import { type Modele, remplacerModele } from '@/server/assistant/modele'
import { modeleScripte } from '@/server/assistant/modele-scripte'
import {
  confirmerProposition,
  envoyerMessage,
  proposerSuivi,
  reserverProposition,
  transmettreDemande,
} from '@/server/assistant/urgences'
import { prisma } from '@/server/db/client'
import { definirTransporteur, type Message } from '@/server/sms/envoi'

// L'assistant des urgences (D77, D79), avec le modèle scripté à la place de Claude et la vraie base de test.
// Ce que ces tests prouvent :
//   - l'arbitrage : une urgence forte prend d'abord le créneau gardé aux urgences, une urgence simple une place
//     ordinaire, une urgence différable jamais le créneau d'urgence ; jamais deux horaires à moins d'une heure ;
//   - les garde-fous du code, même si le modèle se trompe : aucun créneau qu'il n'a pas consulté, aucun au-delà du
//     délai de son niveau, aucun pour une urgence vitale ;
//   - rien dans le délai : la demande se transmet au praticien ; vitale : un rendez-vous de suivi se propose ;
//   - le rendez-vous passe par le code SMS du portail et se rattache à la conversation ; les limites tiennent.

const SUFFIXE = Date.now()
const IP = `198.51.100.${SUFFIXE % 200}`
const TELEPHONE = `+3363998${String(9000 + (SUFFIXE % 900)).padStart(4, '0')}`

let praticienId: string
let fauteuilId: string
let motifUrgenceId: string
const plages: string[] = []
let gardeId: string

let dernierCode = ''
const transporteurEssai = {
  nom: 'essai',
  async envoyer(m: Message) {
    dernierCode = /(\d{6})/.exec(m.texte)?.[1] ?? ''
    return { ok: true as const, reference: 'essai' }
  },
}

/** Dans n jours, à l'heure UTC donnée (cabinet : UTC-4). */
const dans = (n: number, heureUtc: string) => {
  const j = new Date(Date.now() + n * 86_400_000)
  return new Date(`${j.toISOString().slice(0, 10)}T${heureUtc}:00.000Z`)
}

const converser = async (textes: string[], ip = IP, modele: Modele = modeleScripte) => {
  let id: string | null = null
  let dernier
  for (const texte of textes) {
    dernier = await envoyerMessage(modele, { conversationId: id, texte, ipAddress: ip })
    if (dernier.etat !== 'ok') throw new Error(dernier.etat)
    id = dernier.vue.id
  }
  return dernier!.etat === 'ok' ? dernier!.vue : (() => { throw new Error('conversation') })()
}

const heure = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/** Le type des créneaux proposés, lu en base : le patient, lui, ne le voit jamais. */
const types = async (conversationId: string) =>
  ((await prisma.conversationAssistant.findUniqueOrThrow({ where: { id: conversationId } })).propositions as { type?: string }[]).map((p) => p.type)

beforeAll(async () => {
  definirTransporteur(transporteurEssai)
  const site = await prisma.site.findFirstOrThrow({ where: { actif: true }, select: { id: true } })
  motifUrgenceId = (
    await prisma.motifConsultation.findFirstOrThrow({
      where: { estUrgence: true, actif: true },
      orderBy: [{ ordre: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    })
  ).id
  praticienId = (
    await prisma.praticien.create({ data: { nom: `Urgent${SUFFIXE}`, prenom: 'Test', couleur: '#0078cc' }, select: { id: true } })
  ).id
  fauteuilId = (await prisma.fauteuil.create({ data: { siteId: site.id, nom: `Fauteuil urgence ${SUFFIXE}` }, select: { id: true } })).id
  await prisma.praticienMotif.create({ data: { praticienId, motifId: motifUrgenceId, dureeMinutes: 15 } })
  // Demain et après-demain, 7 h 30 – 12 h au cabinet (11:30 – 16:00 UTC).
  for (const n of [1, 2]) {
    plages.push(
      (
        await prisma.plageDePresence.create({
          data: { praticienId, siteId: site.id, fauteuilId, debut: dans(n, '11:30'), fin: dans(n, '16:00') },
          select: { id: true },
        })
      ).id,
    )
  }
  // Demain 7 h 30 – 9 h gardé aux urgences, pour ce praticien seulement : les autres tests n'en voient rien.
  gardeId = (
    await prisma.indisponibilite.create({
      data: { type: TypeIndisponibilite.RESERVE_URGENCE, praticienId, siteId: site.id, debut: dans(1, '11:30'), fin: dans(1, '13:00') },
      select: { id: true },
    })
  ).id
})

afterAll(async () => {
  remplacerModele(null)
  const conversations = await prisma.conversationAssistant.findMany({ where: { ipAddress: { startsWith: IP } }, select: { rendezVousId: true } })
  const rdv = conversations.map((c) => c.rendezVousId).filter((x): x is string => Boolean(x))
  await prisma.conversationAssistant.deleteMany({ where: { ipAddress: { startsWith: IP } } })
  await prisma.reservationPublique.deleteMany({ where: { telephone: TELEPHONE } })
  await prisma.notification.deleteMany({ where: { destinataire: TELEPHONE } })
  await prisma.rendezVous.deleteMany({ where: { OR: [{ id: { in: rdv } }, { praticienId }] } })
  await prisma.patient.deleteMany({ where: { telephone: TELEPHONE } })
  await prisma.indisponibilite.deleteMany({ where: { id: gardeId } })
  await prisma.plageDePresence.deleteMany({ where: { id: { in: plages } } })
  await prisma.praticienMotif.deleteMany({ where: { praticienId } })
  await prisma.praticien.deleteMany({ where: { id: praticienId } })
  await prisma.fauteuil.deleteMany({ where: { id: fauteuilId } })
  await prisma.$disconnect()
})

describe('l’assistant des urgences : triage et arbitrage', () => {
  it('éteint (aucune clé), il le dit sans rien écrire', async () => {
    const r = await envoyerMessage(null, { conversationId: null, texte: 'J’ai mal', ipAddress: `${IP}-eteint` })
    expect(r.etat).toBe('indisponible')
    expect(await prisma.conversationAssistant.count({ where: { ipAddress: `${IP}-eteint` } })).toBe(0)
  })

  it('pose ses trois questions, puis classe une urgence forte et propose la place la plus proche, quel qu’en soit le type', async () => {
    const premier = await converser(['J’ai très mal à une dent et ma joue a gonflé.'], `${IP}-forte`)
    expect(premier.messages.at(-1)).toMatchObject({ role: 'assistant', texte: 'Avez-vous de la fièvre ?' })
    const vue = await converser(['J’ai très mal à une dent et ma joue a gonflé.', 'Un peu', 'Non', 'Forte, elle me réveille'], `${IP}-forte2`)
    expect(vue.niveau).toBe(NiveauUrgence.URGENCE_FORTE)
    expect(vue.propositions.length).toBeGreaterThan(0)
    // La plus proche de toutes les places libres dans les 48 heures, créneau d'urgence ou non.
    const aujourdHui = jourLocal(new Date())
    const libres = await chercherCreneaux({ du: aujourdHui, au: decalerJour(aujourdHui, 2), type: 'tous' })
    const enBaseProps = (await prisma.conversationAssistant.findUniqueOrThrow({ where: { id: vue.id } })).propositions as { debut: string }[]
    expect(enBaseProps[0]!.debut).toBe(libres[0]!.debut)
    // Le patient ne voit pas qu'un créneau est gardé aux urgences.
    expect(JSON.stringify(vue)).not.toMatch(/urgence"/)
    expect(vue.messages.at(-1)!.texte).not.toMatch(/réservé aux urgences|créneau d’urgence/)
    const enBase = await prisma.conversationAssistant.findUniqueOrThrow({ where: { id: vue.id } })
    expect(enBase.raison).toMatch(/plus proche/i)
    expect(enBase.resume.length).toBeGreaterThan(0)
  })

  it('une urgence simple prend une place ordinaire, et garde le créneau d’urgence', async () => {
    const vue = await converser(['Une dent cassée qui fait un peu mal', 'Non', 'Non', 'Supportable'], `${IP}-simple`)
    expect(vue.niveau).toBe(NiveauUrgence.URGENCE_SIMPLE)
    expect(vue.propositions.length).toBeGreaterThan(0)
    expect((await types(vue.id)).every((t) => t === 'ordinaire')).toBe(true)
    // Jamais deux horaires à moins d'une heure le même jour.
    for (const a of vue.propositions)
      for (const b of vue.propositions)
        if (a !== b && a.jour === b.jour) expect(Math.abs(heure(a.heure) - heure(b.heure))).toBeGreaterThanOrEqual(60)
  })

  it('une urgence différable ne prend jamais un créneau gardé aux urgences', async () => {
    const vue = await converser(['Ma couronne est tombée, je n’ai pas mal'], `${IP}-diff`)
    expect(vue.niveau).toBe(NiveauUrgence.DIFFERABLE)
    expect((await types(vue.id)).every((t) => t === 'ordinaire')).toBe(true)
  })

  it('une urgence vitale : aucun créneau ; puis le rendez-vous de suivi, sur des jours différents', async () => {
    let appels = 0
    const compteur: Modele = { repondre: (d) => (appels++, modeleScripte.repondre(d)) }
    const vue = await converser(['J’ai du mal à respirer, ma joue a gonflé'], `${IP}-vitale`, compteur)
    expect(vue.niveau).toBe(NiveauUrgence.VITALE)
    expect(vue.propositions).toEqual([])
    expect(vue.suiviPossible).toBe(true)
    // Une fois classée, la conversation ne rappelle plus le modèle.
    await envoyerMessage(compteur, { conversationId: vue.id, texte: 'Et maintenant ?', ipAddress: `${IP}-vitale` })
    expect(appels).toBe(1)
    const suivi = await proposerSuivi(vue.id)
    expect(suivi).not.toBeNull()
    expect(new Set(suivi!.propositions.map((p) => p.jour)).size).toBe(suivi!.propositions.length)
    // Une seule fois : le bouton disparaît, même sans place libre.
    expect(suivi!.suiviPossible).toBe(false)
  })
})

describe('l’assistant des urgences : les garde-fous du code', () => {
  /** Un modèle qui cherche, puis conclut avec les identifiants qu'on lui dicte (et un inventé). */
  const modeleQuiChoisit = (niveau: string, type: string, choisir: (ids: string[]) => string[]): Modele => {
    let etape = 0
    return {
      async repondre({ messages }) {
        etape++
        if (etape === 1) return { appels: [{ id: 'a', outil: 'chercher_creneaux', entree: { du: '2000-01-01', au: '2999-12-31', type } }], texte: '' }
        const resultat = messages.flatMap((m) => ('resultats' in m ? m.resultats : [])).at(-1)?.contenu ?? '[]'
        const ids = resultat.startsWith('[') ? (JSON.parse(resultat) as { id: string }[]).map((c) => c.id) : []
        return { appels: [{ id: 'b', outil: 'conclure', entree: { niveau, resume: ['essai'], message: 'Voici.', creneaux: choisir(ids) } }], texte: '' }
      },
    }
  }

  it('un créneau que le modèle n’a pas consulté n’est jamais proposé', async () => {
    const vue = await converser(['J’ai mal'], `${IP}-invente`, modeleQuiChoisit('URGENCE_FORTE', 'tous', () => ['2026-12-25-0800-zzzz']))
    expect(vue.propositions).toEqual([])
    expect(vue.demande).toBe('possible')
  })

  it('une urgence vitale ne reçoit aucun créneau, même si le modèle en propose', async () => {
    const vue = await converser(['J’ai mal'], `${IP}-vitale2`, modeleQuiChoisit('VITALE', 'tous', (ids) => ids.slice(0, 2)))
    expect(vue.propositions).toEqual([])
  })

  it('rien de libre dans le délai : la demande se transmet au praticien', async () => {
    const vue = await converser(['J’ai mal'], `${IP}-demande`, modeleQuiChoisit('URGENCE_FORTE', 'tous', () => []))
    expect(vue.demande).toBe('possible')
    const transmise = await transmettreDemande({ conversationId: vue.id, prenom: 'Jean-Marc', nom: `Urgent${SUFFIXE}`, telephone: TELEPHONE })
    expect(transmise?.demande).toBe('transmise')
    const enBase = await prisma.conversationAssistant.findUniqueOrThrow({ where: { id: vue.id } })
    expect(enBase).toMatchObject({ contactPrenom: 'Jean-Marc', contactTelephone: TELEPHONE, demandeTraiteeLe: null })
    expect(enBase.demandeLe).not.toBeNull()
    // Une seule fois.
    expect(await transmettreDemande({ conversationId: vue.id, prenom: 'X', nom: 'Y', telephone: TELEPHONE })).toBeNull()
  })
})

describe('l’assistant des urgences : la réservation', () => {
  it('réserve un créneau proposé par le code SMS, et le rattache à la conversation', async () => {
    const vue = await converser(['Ma joue a gonflé et j’ai très mal', 'Un peu', 'Non', 'Insupportable'], `${IP}-resa`)
    const debut = await reserverProposition({
      conversationId: vue.id,
      index: 0,
      prenom: 'Jean',
      nom: `Urgent${SUFFIXE}`,
      telephone: TELEPHONE,
      ipAddress: `${IP}-resa`,
    })
    if (debut.etat !== 'code_envoye') throw new Error(debut.etat)
    const fin = await confirmerProposition({ conversationId: vue.id, reservationId: debut.id, code: dernierCode, ipAddress: `${IP}-resa` })
    expect(fin.etat).toBe('confirme')
    const conversation = await prisma.conversationAssistant.findUniqueOrThrow({
      where: { id: vue.id },
      select: { rendezVous: { select: { motifId: true, statut: true } } },
    })
    expect(conversation.rendezVous).toMatchObject({ motifId: motifUrgenceId, statut: 'A_CONFIRMER' })
  })

  it('limite les conversations entamées par une même adresse', async () => {
    const ip = `${IP}-robot`
    for (let i = 0; i < 6; i++) {
      const r = await envoyerMessage(modeleScripte, { conversationId: null, texte: 'Un détartrage', ipAddress: ip })
      expect(r.etat).toBe('ok')
    }
    const septieme = await envoyerMessage(modeleScripte, { conversationId: null, texte: 'Un détartrage', ipAddress: ip })
    expect(septieme.etat).toBe('trop_de_conversations')
  })
})
