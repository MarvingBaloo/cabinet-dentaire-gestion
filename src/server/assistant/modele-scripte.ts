import 'server-only'

import { decalerJour, jourLocal } from '@/lib/dates'

import type { AppelOutil, MessageModele, Modele, ReponseModele } from './modele'

// Un modèle sans intelligence, aux réponses écrites d'avance, qui joue le rôle de Claude dans les tests et sur les
// démos tant qu'aucune clé n'est branchée : mêmes outils, mêmes formes de réponse, aucun appel payant. Il imite le
// raisonnement attendu (D79) avec des règles simples : trois questions, le niveau, puis l'agenda consulté dans
// l'ordre de l'arbitrage — la place la plus proche pour une urgence forte, une place ordinaire d'abord pour une
// urgence simple — et un choix justifié. Claude, lui, raisonne vraiment : sur tout ce que le patient écrit, et sur le
// remplissage de l'agenda.

const contient = (texte: string, ...mots: string[]) => mots.some((m) => texte.toLowerCase().includes(m))

const QUESTIONS = [
  { question: 'Avez-vous de la fièvre ?', choix: ['Non', 'Un peu', 'Forte (38,5 ou plus)'] },
  { question: 'Avez-vous du mal à avaler ou à respirer ?', choix: ['Oui', 'Non'] },
  { question: 'Et votre douleur, comment est-elle ?', choix: ['Supportable', 'Forte, elle me réveille', 'Insupportable'] },
]

type Niveau = 'VITALE' | 'URGENCE_FORTE' | 'URGENCE_SIMPLE' | 'DIFFERABLE' | 'NON_URGENT'

/** L'ordre dans lequel l'agenda est consulté pour chaque niveau : le type de place, et le délai en jours. */
const RECHERCHES: Partial<Record<Niveau, { type: 'urgence' | 'ordinaire' | 'tous'; jours: number }[]>> = {
  // Urgence forte : la place la plus proche, quel que soit son type (Marving, 26/10).
  URGENCE_FORTE: [{ type: 'tous', jours: 2 }],
  URGENCE_SIMPLE: [{ type: 'ordinaire', jours: 3 }, { type: 'urgence', jours: 3 }],
  DIFFERABLE: [{ type: 'ordinaire', jours: 7 }],
}

let compteur = 0
const appel = (outil: string, entree: Record<string, unknown>): ReponseModele => ({
  appels: [{ id: `scripte-${++compteur}`, outil, entree } satisfies AppelOutil],
  texte: '',
})

function classer(ecrits: string[]): { niveau: Niveau; resume: string[] } | { question: (typeof QUESTIONS)[number] } {
  const [premier = '', fievre = '', avaler = '', douleur = ''] = ecrits
  if (contient(premier, 'respirer', 'étouffe')) return { niveau: 'VITALE', resume: [premier.slice(0, 140), 'Gêne pour respirer'] }
  if (contient(premier, 'détartrage', 'contrôle', 'devis')) return { niveau: 'NON_URGENT', resume: ['Demande de rendez-vous habituel'] }
  if (contient(premier, 'couronne', 'plombage') && contient(premier, 'pas mal')) {
    return { niveau: 'DIFFERABLE', resume: [premier.slice(0, 140), 'Sans douleur'] }
  }
  const question = QUESTIONS[ecrits.length - 1]
  if (question) return { question }

  const resume = [premier.slice(0, 140), `Fièvre : ${fievre}`, `Gêne pour avaler ou respirer : ${avaler}`, `Douleur : ${douleur}`]
  if (contient(avaler, 'oui')) return { niveau: 'VITALE', resume }
  const gonfle = contient(premier, 'gonfl', 'enfl')
  if (contient(fievre, 'forte') || contient(douleur, 'insupportable') || (gonfle && contient(fievre, 'un peu'))) {
    return { niveau: 'URGENCE_FORTE', resume }
  }
  return { niveau: 'URGENCE_SIMPLE', resume }
}

/** Les créneaux à proposer parmi ceux que l'agenda a rendus : le premier, puis d'autres à une heure au moins le même jour. */
function choisir(resultat: string): { id: string; type: string }[] {
  let liste: { id: string; type: string }[]
  try {
    liste = JSON.parse(resultat) as { id: string; type: string }[]
  } catch {
    return []
  }
  const minutes = (id: string) => {
    const hhmm = /^\d{4}-\d{2}-\d{2}-(\d{4})/.exec(id)?.[1] ?? '0000'
    return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2))
  }
  const choisis: { id: string; type: string }[] = []
  for (const c of liste) {
    if (choisis.length === 3) break
    const memeJour = choisis.filter((x) => x.id.slice(0, 10) === c.id.slice(0, 10))
    if (memeJour.every((x) => Math.abs(minutes(x.id) - minutes(c.id)) >= 60)) choisis.push(c)
  }
  return choisis
}

function message(niveau: Niveau, choisis: { type: string }[]): { message: string; raison: string } {
  if (!choisis.length) {
    return {
      message:
        'Le cabinet est complet dans le délai qu’il vous faut. Laissez vos coordonnées : je transmets votre demande au praticien, et le cabinet vous rappelle dès l’ouverture.',
      raison: 'Aucune place dans le délai : demande transmise au praticien.',
    }
  }
  // Le patient ne sait jamais si un créneau est gardé aux urgences : la phrase dit le délai, la raison (pour le
  // cabinet) dit l'arbitrage.
  const urgence = choisis[0]!.type === 'urgence'
  if (niveau === 'URGENCE_FORTE') {
    return {
      message: 'Avec ces signes, il faut vous voir dans les 48 heures. Voici ce que je vous propose :',
      raison: urgence
        ? 'Urgence forte : la place la plus proche dans les 48 heures, sur un créneau d’urgence.'
        : 'Urgence forte : la place la plus proche dans les 48 heures, une place ordinaire.',
    }
  }
  if (niveau === 'URGENCE_SIMPLE') {
    return {
      message: 'Votre douleur reste supportable : il faut vous voir dans les 3 jours. Voici ce que je vous propose :',
      raison: urgence
        ? 'Urgence simple, aucune place ordinaire dans les 72 heures : créneau d’urgence.'
        : 'Urgence simple : place ordinaire dans les 72 heures, créneaux d’urgence laissés libres.',
    }
  }
  return {
    message: 'Sans douleur, cela peut attendre quelques jours. Gardez la couronne dans une petite boîte. Voici des places dans la semaine :',
    raison: 'Différable : place ordinaire dans les 7 jours, jamais un créneau d’urgence.',
  }
}

export const modeleScripte: Modele = {
  async repondre({ messages }: { messages: MessageModele[] }) {
    const indexDernierEcrit = messages.findLastIndex((m) => 'texte' in m && m.role === 'user')
    const ecrits = messages.flatMap((m) => ('texte' in m && m.role === 'user' ? [m.texte] : []))
    const resultats = messages
      .slice(indexDernierEcrit + 1)
      .flatMap((m) => ('resultats' in m ? m.resultats.map((r) => r.contenu) : []))

    const c = classer(ecrits)
    if ('question' in c) return appel('poser_question', c.question)

    if (c.niveau === 'VITALE') {
      return appel('conclure', {
        niveau: 'VITALE',
        resume: c.resume,
        message: 'Une gêne pour avaler ou respirer doit être vue tout de suite, à l’hôpital. Appelez le 15 maintenant.',
      })
    }
    if (c.niveau === 'NON_URGENT') {
      return appel('conclure', {
        niveau: 'NON_URGENT',
        resume: c.resume,
        message: 'Ce n’est pas une urgence : vous pouvez choisir votre créneau dans la réservation en ligne.',
      })
    }

    const recherches = RECHERCHES[c.niveau] ?? []
    const dernier = resultats.at(-1)
    const trouve = dernier !== undefined && !dernier.startsWith('Aucun')
    if (!trouve && resultats.length < recherches.length) {
      const r = recherches[resultats.length]!
      const aujourdHui = jourLocal(new Date())
      return appel('chercher_creneaux', { du: aujourdHui, au: decalerJour(aujourdHui, r.jours), type: r.type })
    }
    const choisis = trouve ? choisir(dernier) : []
    return appel('conclure', {
      niveau: c.niveau,
      resume: c.resume,
      creneaux: choisis.map((x) => x.id),
      transmettre: choisis.length === 0,
      ...message(c.niveau, choisis),
    })
  },
}
