import 'server-only'

import { NiveauUrgence, UsageAssistant, type Prisma } from '@prisma/client'

import { CABINET } from '@/config/cabinet'
import { decalerJour, heureCabinet, jourLocal } from '@/lib/dates'
import { prisma } from '@/server/db/client'
import {
  type DebutReservation,
  type FinReservation,
  confirmerReservation,
  demarrerReservation,
} from '@/server/services/reservation-publique'

import { type CreneauVu, bornerPeriode, chercherCreneaux, consulterAgenda, jourEnClair } from './agenda-assistant'
import { type AppelOutil, type MessageModele, type Modele, type OutilModele, ModeleIndisponibleError } from './modele'

// L'assistant des urgences (D77, D79). Le patient écrit ce qui lui arrive ; l'assistant pose les questions qui
// comptent, classe la demande dans l'un des cinq niveaux, consulte lui-même l'agenda (présences, congés,
// remplissage, créneaux libres — jamais un patient) et ARBITRE : la place la plus proche pour une urgence forte, une
// place ordinaire pour une urgence simple, jamais le créneau d'urgence pour une urgence différable. Il justifie son
// choix. Rien de libre dans le délai : la demande est transmise au praticien, qui peut prendre une urgence
// par-dessus un planning plein (Q19), plutôt que d'envoyer à l'hôpital quelqu'un qui pouvait attendre.
//
// Le code garde la main sur ce qui compte : l'assistant ne propose qu'un créneau qu'il a réellement consulté, jamais
// au-delà du délai de son niveau, jamais pour une urgence vitale ; la réservation suit le chemin du portail (code SMS).

export type MessageConversation = { role: 'patient' | 'assistant'; texte: string; choix?: string[] }

type Proposition = { praticienId: string; siteId: string; debut: string; fin: string; praticien: string; type?: 'urgence' | 'ordinaire' }

/** Ce que le patient voit d'un créneau proposé : jamais s'il est gardé aux urgences (Marving, 26/10). */
export type PropositionVue = { index: number; jour: string; heure: string; praticien: string; duree: number }

export type VueConversation = {
  id: string
  messages: MessageConversation[]
  niveau: NiveauUrgence | null
  propositions: PropositionVue[]
  /** Le rendez-vous posé, une fois le code SMS validé. */
  reserve: { jour: string; heure: string; praticien: string } | null
  /** Rien de libre dans le délai : le patient peut laisser ses coordonnées, le cabinet le rappelle. */
  demande: 'possible' | 'transmise' | null
  /** Urgence vitale : un rendez-vous de suivi au cabinet, après l'hôpital, peut être proposé. */
  suiviPossible: boolean
}

export type ResultatMessage =
  | { etat: 'ok'; vue: VueConversation }
  | { etat: 'trop_de_messages' }
  | { etat: 'trop_de_conversations' }
  | { etat: 'indisponible' }
  | { etat: 'introuvable' }

/** Conversations entamées par une même adresse en une heure : au-delà, un robot, et chaque message coûte un appel. */
const MAX_CONVERSATIONS_PAR_IP_PAR_HEURE = 6
/** Messages du patient dans une conversation : quelques questions suffisent, le reste serait détourné de l'usage. */
const MAX_MESSAGES_PATIENT = 10
/** Appels au modèle d'un même tour : il consulte l'agenda, puis conclut ; au-delà, il tourne en rond. */
const MAX_APPELS_PAR_TOUR = 6
/** Plafond de conversations par jour pour tout le site : la facture de l'API ne peut pas s'emballer. */
const PLAFOND_PAR_JOUR = Number(process.env.ASSISTANT_PLAFOND_JOUR || 200)
export const LONGUEUR_MAX_MESSAGE = 600

/** Délai maximal de chaque niveau, en heures (décidé par Marving le 26/10). */
export const DELAI_HEURES: Partial<Record<NiveauUrgence, number>> = {
  URGENCE_FORTE: 48,
  URGENCE_SIMPLE: 72,
  DIFFERABLE: 7 * 24,
}

/** Deux horaires proposés le même jour : une heure d'écart au moins (même règle que la réservation, D78). */
const ECART_MINUTES = 60

export const ACCUEIL =
  'Bonjour, je suis l’assistant du cabinet. Dites-moi ce qui vous arrive : je vous trouve le bon créneau.'

const maintenantFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'America/Guadeloupe',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function systeme(): string {
  const maintenant = new Date()
  return `Tu es l'assistant d'accueil des urgences de ${CABINET.nomCommercial ?? CABINET.nom}, un cabinet dentaire à Marie-Galante (Guadeloupe). Tu parles à un patient qui écrit depuis le site du cabinet. Nous sommes le ${maintenantFormat.format(maintenant)} (heure de Marie-Galante), soit le ${jourLocal(maintenant)}.

TON TRAVAIL
1. Comprendre ce qui arrive au patient, avec précision, pour ne l'envoyer à l'hôpital que s'il le faut vraiment : envoyer aux urgences de l'hôpital quelqu'un qui pouvait attendre, c'est les engorger pour rien.
2. Classer sa demande dans l'un des cinq niveaux.
3. Consulter l'agenda du cabinet et choisir les créneaux à lui proposer, en arbitrant.
4. Lui dire en une ou deux phrases dans quel délai il doit être vu, et lui proposer les créneaux.

LES QUESTIONS QUI COMPTENT (pose seulement celles dont la réponse te manque, une à la fois, avec des réponses courtes à choisir)
- Fièvre : non ; un peu (moins de 38,5) ; forte (38,5 ou plus).
- Gonflement : aucun ; sur la gencive ; sur la joue ; sous la mâchoire ; qui monte vers l'œil ou descend vers le cou.
- Ouverture de la bouche : normale ; pas plus de deux doigts.
- Avaler, respirer : normal ; difficile.
- Douleur : supportable ; forte (elle réveille la nuit) ; insupportable (rien ne la calme).
- Depuis quand ; un choc (chute, coup) ; un saignement qui ne s'arrête pas.
- Quand le patient peut venir (le matin, l'après-midi, n'importe quand), et s'il vient d'ailleurs en bateau (pas avant 9 h).

LES CINQ NIVEAUX ET LEUR DÉLAI
- VITALE : difficulté à respirer ou à avaler, gonflement qui gagne l'œil ou le cou, saignement qui ne s'arrête pas, choc violent au visage (perte de connaissance, mâchoire qui ne ferme plus), forte fièvre avec gonflement qui s'étend. Le cabinet ne peut pas soigner cela à temps : le patient doit appeler le 15 tout de suite. Ne cherche aucun créneau.
- URGENCE_FORTE (à voir dans les 48 heures) : douleur insupportable, ou fièvre avec joue gonflée, ou ouverture de la bouche limitée, sans signe vital.
- URGENCE_SIMPLE (dans les 72 heures) : douleur réelle mais supportable, dent cassée qui fait mal, gonflement léger de la gencive sans fièvre.
- DIFFERABLE (dans les 7 jours) : couronne ou plombage tombé sans douleur, dent cassée sans douleur, appareil qui blesse, sensibilité modérée.
- NON_URGENT : contrôle, détartrage, blanchiment, devis, question administrative.

L'ARBITRAGE DES CRÉNEAUX (outils consulter_agenda et chercher_creneaux ; tu ne proposes que des créneaux rendus par chercher_creneaux)
- Les créneaux « urgence » (7 h 30 – 9 h) sont gardés pour les cas sérieux ; ce sont des places comme les autres pour une urgence forte, pas une priorité.
- URGENCE_FORTE : la place libre la plus proche dans les 48 heures, « urgence » ou « ordinaire » : ce qui compte, c'est d'être vu le plus tôt. Un créneau « urgence » demain matin ne passe jamais avant une place « ordinaire » libre aujourd'hui.
- URGENCE_SIMPLE : d'abord une place « ordinaire » dans les 72 heures, en gardant les créneaux d'urgence pour plus grave ; un créneau « urgence » seulement s'il n'y a rien d'autre.
- DIFFERABLE : uniquement des places « ordinaires », dans les 7 jours ; jamais un créneau « urgence ».
- Tiens compte du remplissage (consulter_agenda) : à gravité égale, préfère le jour le moins chargé, et dis-le si l'attente sur place risque d'être longue ; tiens compte des disponibilités du patient et du praticien adapté (un problème d'implant : le praticien d'implantologie).
- Propose trois créneaux au plus, jamais à moins d'une heure l'un de l'autre le même jour, le plus adapté d'abord.
- Ne dis jamais au patient qu'un créneau est gardé aux urgences, ni comment tu as arbitré entre les types de places : propose simplement l'horaire. L'arbitrage, tu l'expliques au cabinet seulement (champ raison).
- Rien de libre dans le délai pour une urgence forte ou simple : conclus sans créneau avec transmettre=true ; la demande part au praticien, qui peut prendre une urgence en plus, et le cabinet rappelle le patient dès l'ouverture. Ne l'envoie pas à l'hôpital pour cela, sauf si un signe vital apparaît.
- Rien dans les 7 jours pour une urgence différable : conclus sans créneau, le patient appellera le cabinet.

RÈGLES
- Vouvoiement, phrases courtes, ton calme et chaleureux.
- Jamais de diagnostic, jamais de nom de maladie, jamais de conseil de médicament ni de dose. Un conseil de bon sens en attendant est permis (garder une couronne dans une petite boîte, rincer à l'eau tiède).
- Dès qu'un signe VITALE apparaît, conclus aussitôt.
- Si le patient parle d'autre chose qu'un problème dentaire, ramène-le gentiment ; s'il insiste, conclus NON_URGENT.
- Tu appelles toujours un outil : poser_question pour une question, consulter_agenda ou chercher_creneaux pour regarder l'agenda, conclure pour finir.`
}

const OUTILS: OutilModele[] = [
  {
    nom: 'poser_question',
    description: 'Pose une question au patient, avec des réponses courtes à choisir si possible. Termine ton tour.',
    parametres: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'La question, en une phrase, au vouvoiement.' },
        choix: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Réponses courtes proposées (facultatif).' },
      },
      required: ['question'],
    },
  },
  {
    nom: 'consulter_agenda',
    description:
      'L’agenda du cabinet, jour par jour, sur 14 jours au plus : praticiens présents et horaires, congés et fermetures, jours fériés, remplissage du matin et de l’après-midi (en %), urgences déjà posées, nombre de places libres d’urgence et ordinaires. Aucun patient.',
    parametres: {
      type: 'object',
      properties: {
        du: { type: 'string', description: 'Premier jour, AAAA-MM-JJ (aujourd’hui au plus tôt).' },
        au: { type: 'string', description: 'Dernier jour, AAAA-MM-JJ.' },
      },
      required: ['du', 'au'],
    },
  },
  {
    nom: 'chercher_creneaux',
    description:
      'Les créneaux libres pour une urgence sur 10 jours au plus, les quinze premiers, chacun avec un identifiant, son jour, son heure, son praticien et son type (« urgence » : plage gardée 7 h 30 – 9 h ; « ordinaire »). Tu ne proposes que des identifiants rendus ici.',
    parametres: {
      type: 'object',
      properties: {
        du: { type: 'string', description: 'Premier jour, AAAA-MM-JJ.' },
        au: { type: 'string', description: 'Dernier jour, AAAA-MM-JJ.' },
        type: { type: 'string', enum: ['urgence', 'ordinaire', 'tous'] },
        moment: { type: 'string', enum: ['matin', 'midi', 'apres-midi'], description: 'Facultatif.' },
      },
      required: ['du', 'au', 'type'],
    },
  },
  {
    nom: 'conclure',
    description:
      'Conclut : le niveau, un résumé pour le cabinet, un message au patient qui explique ton choix, et les créneaux choisis (identifiants de chercher_creneaux), ou transmettre=true si rien n’est libre dans le délai.',
    parametres: {
      type: 'object',
      properties: {
        niveau: { type: 'string', enum: ['VITALE', 'URGENCE_FORTE', 'URGENCE_SIMPLE', 'DIFFERABLE', 'NON_URGENT'] },
        resume: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 6,
          description: 'Pour le cabinet : les faits rapportés par le patient (fièvre, gonflement, douleur, depuis quand…), sans diagnostic.',
        },
        message: {
          type: 'string',
          description: 'Pour le patient : une ou deux phrases sur le niveau et le délai, puis les créneaux proposés — sans jamais dire qu’un créneau est gardé aux urgences.',
        },
        creneaux: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'Identifiants choisis, le plus adapté d’abord.' },
        raison: { type: 'string', description: 'Pour le cabinet : pourquoi ces créneaux (gravité, remplissage, disponibilités du patient).' },
        transmettre: { type: 'boolean', description: 'Vrai si rien n’est libre dans le délai : la demande part au praticien.' },
      },
      required: ['niveau', 'resume', 'message'],
    },
  },
]

const NIVEAUX = Object.values(NiveauUrgence) as string[]

const lireMessages = (v: Prisma.JsonValue) => (Array.isArray(v) ? (v as unknown as MessageConversation[]) : [])
const lirePropositions = (v: Prisma.JsonValue) => (Array.isArray(v) ? (v as unknown as Proposition[]) : [])
const lireVus = (v: Prisma.JsonValue) => (Array.isArray(v) ? (v as unknown as CreneauVu[]) : [])
const majuscule = (s: string) => s.replace(/^./, (x) => x.toUpperCase())

function vueDe(c: {
  id: string
  messages: Prisma.JsonValue
  niveau: NiveauUrgence | null
  propositions: Prisma.JsonValue
  demandeLe: Date | null
  raison: string | null
  rendezVous: { debut: Date; praticien: { nom: string } } | null
}): VueConversation {
  const propositions = c.rendezVous ? [] : lirePropositions(c.propositions)
  const urgent = c.niveau === NiveauUrgence.URGENCE_FORTE || c.niveau === NiveauUrgence.URGENCE_SIMPLE
  return {
    id: c.id,
    messages: lireMessages(c.messages),
    niveau: c.niveau,
    propositions: propositions.map((p, index) => ({
      index,
      jour: majuscule(jourEnClair(jourLocal(new Date(p.debut)))),
      heure: heureCabinet(new Date(p.debut)),
      praticien: p.praticien,
      duree: Math.round((new Date(p.fin).getTime() - new Date(p.debut).getTime()) / 60_000),
    })),
    reserve: c.rendezVous
      ? {
          jour: majuscule(jourEnClair(jourLocal(c.rendezVous.debut))),
          heure: heureCabinet(c.rendezVous.debut),
          praticien: `Dr ${c.rendezVous.praticien.nom}`,
        }
      : null,
    demande: c.demandeLe ? 'transmise' : urgent && !c.rendezVous && propositions.length === 0 ? 'possible' : null,
    // Une seule demande de suivi : la raison, posée à ce moment-là, dit qu'elle a eu lieu.
    suiviPossible: c.niveau === NiveauUrgence.VITALE && !c.rendezVous && propositions.length === 0 && !c.raison,
  }
}

const SELECTION_VUE = {
  id: true,
  messages: true,
  niveau: true,
  propositions: true,
  demandeLe: true,
  raison: true,
  rendezVous: { select: { debut: true, praticien: { select: { nom: true } } } },
} as const

export async function lireConversation(id: string): Promise<VueConversation | null> {
  const c = await prisma.conversationAssistant.findFirst({ where: { id, usage: UsageAssistant.URGENCES }, select: SELECTION_VUE })
  return c ? vueDe(c) : null
}

/** Ce que le modèle relit du dialogue : les messages, les questions avec leurs choix. */
function pourLeModele(messages: MessageConversation[]): MessageModele[] {
  return messages.map((m) => ({
    role: m.role === 'patient' ? 'user' : 'assistant',
    texte: m.choix?.length ? `${m.texte} (réponses proposées : ${m.choix.join(' / ')})` : m.texte,
  }))
}

/** Les propositions retenues : trois au plus, une heure d'écart le même jour, dans le délai du niveau. */
function retenir(choisis: CreneauVu[], niveau: NiveauUrgence): Proposition[] {
  const delai = DELAI_HEURES[niveau]
  if (!delai) return []
  const limite = Date.now() + delai * 3_600_000
  const retenus: CreneauVu[] = []
  for (const c of choisis) {
    if (retenus.length === 3) break
    if (new Date(c.debut).getTime() > limite) continue
    // Une urgence différable ne prend jamais un créneau gardé aux urgences.
    if (niveau === NiveauUrgence.DIFFERABLE && c.type === 'urgence') continue
    const trop = retenus.some(
      (r) =>
        jourLocal(new Date(r.debut)) === jourLocal(new Date(c.debut)) &&
        Math.abs(new Date(r.debut).getTime() - new Date(c.debut).getTime()) < ECART_MINUTES * 60_000,
    )
    if (!trop && !retenus.some((r) => r.id === c.id)) retenus.push(c)
  }
  return retenus.map(({ praticienId, siteId, debut, fin, praticien, type }) => ({ praticienId, siteId, debut, fin, praticien, type }))
}

/** Exécute un outil d'agenda pour le modèle ; rend son résultat en texte, et les créneaux vus. */
async function executer(appel: AppelOutil): Promise<{ contenu: string; vus: CreneauVu[] }> {
  if (appel.outil === 'consulter_agenda') {
    const { du, au } = bornerPeriode(appel.entree.du, appel.entree.au, 14)
    return { contenu: JSON.stringify(await consulterAgenda(du, au)), vus: [] }
  }
  if (appel.outil === 'chercher_creneaux') {
    const { du, au } = bornerPeriode(appel.entree.du, appel.entree.au, 10)
    const type = (['urgence', 'ordinaire', 'tous'] as const).find((t) => t === appel.entree.type) ?? 'tous'
    const moment = (['matin', 'midi', 'apres-midi'] as const).find((m) => m === appel.entree.moment)
    const vus = await chercherCreneaux({ du, au, type, moment })
    const contenu = vus.length
      ? JSON.stringify(
          vus.map((c) => ({
            id: c.id,
            jour: jourEnClair(jourLocal(new Date(c.debut))),
            heure: heureCabinet(new Date(c.debut)),
            praticien: c.praticien,
            type: c.type,
          })),
        )
      : `Aucun créneau ${type === 'tous' ? '' : `« ${type} » `}libre du ${du} au ${au}.`
    return { contenu, vus }
  }
  return { contenu: 'Outil inconnu.', vus: [] }
}

/**
 * Un message du patient : la conversation est créée au premier, poursuivie ensuite. Le modèle consulte l'agenda
 * autant qu'il veut (dans la limite d'un tour), puis pose une question ou conclut ; une fois conclue, la
 * conversation ne reçoit plus de message.
 */
export async function envoyerMessage(
  modele: Modele | null,
  demande: { conversationId: string | null; texte: string; ipAddress: string },
): Promise<ResultatMessage> {
  if (!modele) return { etat: 'indisponible' }
  const texte = demande.texte.trim().slice(0, LONGUEUR_MAX_MESSAGE)

  let conversation = demande.conversationId
    ? await prisma.conversationAssistant.findFirst({
        where: { id: demande.conversationId, usage: UsageAssistant.URGENCES },
        select: { id: true, messages: true, niveau: true, creneauxVus: true },
      })
    : null
  if (demande.conversationId && !conversation) return { etat: 'introuvable' }

  if (!conversation) {
    const depuisUneHeure = new Date(Date.now() - 3_600_000)
    const [parIp, duJour] = await Promise.all([
      prisma.conversationAssistant.count({ where: { ipAddress: demande.ipAddress, createdAt: { gte: depuisUneHeure } } }),
      prisma.conversationAssistant.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ])
    if (parIp >= MAX_CONVERSATIONS_PAR_IP_PAR_HEURE || duJour >= PLAFOND_PAR_JOUR) return { etat: 'trop_de_conversations' }
    conversation = await prisma.conversationAssistant.create({
      data: {
        usage: UsageAssistant.URGENCES,
        ipAddress: demande.ipAddress,
        messages: [{ role: 'assistant', texte: ACCUEIL }] as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, messages: true, niveau: true, creneauxVus: true },
    })
  }
  if (conversation.niveau) return { etat: 'ok', vue: (await lireConversation(conversation.id))! }

  const messages = [...lireMessages(conversation.messages), { role: 'patient' as const, texte }]
  if (messages.filter((m) => m.role === 'patient').length > MAX_MESSAGES_PATIENT) return { etat: 'trop_de_messages' }

  const vus = new Map(lireVus(conversation.creneauxVus).map((c) => [c.id, c]))
  const fil = pourLeModele(messages)
  const donnees: Prisma.ConversationAssistantUpdateInput = {}
  let fini = false

  try {
    for (let tour = 0; tour < MAX_APPELS_PAR_TOUR && !fini; tour++) {
      const reponse = await modele.repondre({ systeme: systeme(), messages: fil, outils: OUTILS, outilObligatoire: true })
      const final = reponse.appels.find((a) => a.outil === 'poser_question' || a.outil === 'conclure')

      if (final?.outil === 'conclure' && NIVEAUX.includes(String(final.entree.niveau))) {
        const niveau = final.entree.niveau as NiveauUrgence
        const ids = Array.isArray(final.entree.creneaux) ? final.entree.creneaux.map(String) : []
        const propositions = retenir(ids.flatMap((id) => (vus.has(id) ? [vus.get(id)!] : [])), niveau)
        let message = String(final.entree.message ?? '')
        if (propositions.length === 0 && niveau === NiveauUrgence.DIFFERABLE) {
          message += ` Aucune place n’est libre en ligne dans les 7 jours : appelez le cabinet${CABINET.telephone ? ` au ${CABINET.telephone}` : ''}.`
        }
        messages.push({ role: 'assistant', texte: message })
        Object.assign(donnees, {
          niveau,
          resume: (Array.isArray(final.entree.resume) ? final.entree.resume : []).map(String).slice(0, 6),
          propositions: propositions as unknown as Prisma.InputJsonValue,
          raison: typeof final.entree.raison === 'string' ? final.entree.raison.slice(0, 600) : null,
        })
        fini = true
      } else if (final?.outil === 'poser_question') {
        const choix = Array.isArray(final.entree.choix) ? final.entree.choix.map(String).slice(0, 4) : undefined
        messages.push({
          role: 'assistant',
          texte: String(final.entree.question ?? '') || 'Pouvez-vous m’en dire un peu plus ?',
          ...(choix?.length ? { choix } : {}),
        })
        fini = true
      } else if (reponse.appels.length) {
        // L'agenda : chaque appel exécuté, son résultat rendu au modèle, et il poursuit.
        const resultats = []
        for (const appel of reponse.appels) {
          const r = await executer(appel)
          for (const c of r.vus) vus.set(c.id, c)
          resultats.push({ id: appel.id, contenu: r.contenu })
        }
        fil.push({ role: 'assistant', appels: reponse.appels }, { role: 'user', resultats })
      } else {
        messages.push({ role: 'assistant', texte: reponse.texte || 'Pouvez-vous m’en dire un peu plus ?' })
        fini = true
      }
    }
  } catch (e) {
    if (e instanceof ModeleIndisponibleError) {
      console.error('[assistant] modèle indisponible', e.cause)
      return { etat: 'indisponible' }
    }
    throw e
  }
  if (!fini) messages.push({ role: 'assistant', texte: 'Pouvez-vous m’en dire un peu plus sur ce que vous ressentez ?' })

  donnees.messages = messages as unknown as Prisma.InputJsonValue
  donnees.creneauxVus = [...vus.values()] as unknown as Prisma.InputJsonValue
  const mise = await prisma.conversationAssistant.update({ where: { id: conversation.id }, data: donnees, select: SELECTION_VUE })
  return { etat: 'ok', vue: vueDe(mise) }
}

/**
 * Urgence vitale : après l'hôpital, un rendez-vous de suivi au cabinet. Trois places ordinaires, sur trois jours,
 * entre trois et douze jours plus tard.
 */
export async function proposerSuivi(conversationId: string): Promise<VueConversation | null> {
  const c = await prisma.conversationAssistant.findFirst({
    where: { id: conversationId, usage: UsageAssistant.URGENCES, niveau: NiveauUrgence.VITALE, rendezVousId: null },
    select: { id: true, messages: true },
  })
  if (!c) return null
  const aujourdHui = jourLocal(new Date())
  const libres = await chercherCreneaux({ du: decalerJour(aujourdHui, 3), au: decalerJour(aujourdHui, 12), type: 'ordinaire' })
  const parJour: CreneauVu[] = []
  for (const l of libres) {
    if (parJour.length < 3 && !parJour.some((p) => jourLocal(new Date(p.debut)) === jourLocal(new Date(l.debut)))) parJour.push(l)
  }
  const propositions = parJour.map(({ praticienId, siteId, debut, fin, praticien, type }) => ({ praticienId, siteId, debut, fin, praticien, type }))
  const messages = [
    ...lireMessages(c.messages),
    {
      role: 'assistant' as const,
      texte: propositions.length
        ? 'Pour le suivi de votre dent après votre passage à l’hôpital, voici trois rendez-vous au cabinet :'
        : `Aucune place n’est libre en ligne pour le suivi : appelez le cabinet${CABINET.telephone ? ` au ${CABINET.telephone}` : ''} après votre passage à l’hôpital.`,
    },
  ]
  const mise = await prisma.conversationAssistant.update({
    where: { id: c.id },
    data: {
      propositions: propositions as unknown as Prisma.InputJsonValue,
      raison: 'Rendez-vous de suivi après une orientation vers le 15.',
      messages: messages as unknown as Prisma.InputJsonValue,
    },
    select: SELECTION_VUE,
  })
  return vueDe(mise)
}

/** Rien de libre dans le délai : les coordonnées du patient, pour que le cabinet le rappelle dès l'ouverture. */
export async function transmettreDemande(demande: {
  conversationId: string
  prenom: string
  nom: string
  telephone: string
}): Promise<VueConversation | null> {
  const c = await prisma.conversationAssistant.findFirst({
    where: {
      id: demande.conversationId,
      usage: UsageAssistant.URGENCES,
      niveau: { in: [NiveauUrgence.URGENCE_FORTE, NiveauUrgence.URGENCE_SIMPLE] },
      rendezVousId: null,
      demandeLe: null,
    },
    select: { id: true, messages: true, propositions: true },
  })
  if (!c || lirePropositions(c.propositions).length) return null
  const messages = [
    ...lireMessages(c.messages),
    {
      role: 'assistant' as const,
      texte:
        'C’est transmis : le praticien a votre demande, et le cabinet vous rappelle dès l’ouverture. Si cela s’aggrave (gonflement vers l’œil ou le cou, difficulté à avaler ou à respirer), appelez le 15 sans attendre.',
    },
  ]
  const mise = await prisma.conversationAssistant.update({
    where: { id: c.id },
    data: {
      contactPrenom: demande.prenom,
      contactNom: demande.nom,
      contactTelephone: demande.telephone,
      demandeLe: new Date(),
      messages: messages as unknown as Prisma.InputJsonValue,
    },
    select: SELECTION_VUE,
  })
  return vueDe(mise)
}

/** Premier temps de la réservation : l'un des créneaux proposés, les coordonnées, le code SMS (portail). */
export async function reserverProposition(demande: {
  conversationId: string
  index: number
  prenom: string
  nom: string
  telephone: string
  ipAddress: string
}): Promise<DebutReservation | { etat: 'introuvable' }> {
  const c = await prisma.conversationAssistant.findFirst({
    where: { id: demande.conversationId, usage: UsageAssistant.URGENCES, rendezVousId: null },
    select: { propositions: true },
  })
  const p = c ? lirePropositions(c.propositions)[demande.index] : undefined
  if (!p) return { etat: 'introuvable' }
  const motif = await prisma.motifConsultation.findFirst({
    where: { estUrgence: true, actif: true },
    orderBy: [{ ordre: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  if (!motif) return { etat: 'introuvable' }
  return demarrerReservation({
    motifId: motif.id,
    praticienId: p.praticienId,
    siteId: p.siteId,
    debut: new Date(p.debut),
    prenom: demande.prenom,
    nom: demande.nom,
    telephone: demande.telephone,
    ipAddress: demande.ipAddress,
  })
}

/** Second temps : le code. Le rendez-vous posé est rattaché à la conversation, que le cabinet lira dans sa fiche. */
export async function confirmerProposition(demande: {
  conversationId: string
  reservationId: string
  code: string
  ipAddress: string
}): Promise<FinReservation | { etat: 'introuvable' }> {
  const c = await prisma.conversationAssistant.findFirst({
    where: { id: demande.conversationId, usage: UsageAssistant.URGENCES, rendezVousId: null },
    select: { id: true, propositions: true },
  })
  const reservation = await prisma.reservationPublique.findUnique({
    where: { id: demande.reservationId },
    select: { praticienId: true, debut: true },
  })
  // La réservation doit porter sur l'un des créneaux de CETTE conversation.
  const correspond =
    c &&
    reservation &&
    lirePropositions(c.propositions).some(
      (p) => p.praticienId === reservation.praticienId && new Date(p.debut).getTime() === reservation.debut.getTime(),
    )
  if (!c || !correspond) return { etat: 'introuvable' }

  const fin = await confirmerReservation(demande.reservationId, demande.code, demande.ipAddress)
  if (fin.etat === 'confirme') {
    await prisma.conversationAssistant.update({ where: { id: c.id }, data: { rendezVousId: fin.rendezVousId } })
  }
  return fin
}
