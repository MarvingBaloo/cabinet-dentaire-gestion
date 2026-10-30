// Worker de la file de notifications (phase 4, lot 1) : prend en charge la
// table `notification` en continu — un passage toutes les quinze secondes —
// et reprend au passage les tâches de fond de la liste d'attente qui
// vivaient avant dans `scripts/envoyer-liste-attente.ts`, supprimé au même
// lot (rattrapage des envois créés avant la file, purge horaire).
//
// Depuis le lot 3 (D4x), chaque passage appelle aussi `planifierRappels`
// AVANT `traiterLot` : les rappels J-2 et H-3 sont générés à partir de
// l'agenda à chaque passage, pas par une tâche posée par rendez-vous — voir
// `src/server/notifications/rappels.ts`, qui enregistre au passage les
// vérificateurs de RAPPEL_J2, RAPPEL_H3, CONFIRMATION_RESERVATION et
// MODIFICATION_RENDEZ_VOUS (raison précise dans ce fichier).
//
// REMPLACE `scripts/envoyer-liste-attente.ts`. Reprend son mécanisme :
// `tsx --conditions react-server` neutralise `server-only` à l'exécution,
// sans rien changer au code applicatif (D32) — le même principe que le stub
// `tests/stubs/server-only.ts` de `vitest.config.mts`, une autre porte
// d'entrée sur le même code. Pas de `--env-file` : les variables sont déjà
// chargées dans le shell (développement : `set -a; source .env.local; set
// +a` ; production : le conteneur les fournit).
//
// ARRÊT PROPRE sur SIGTERM/SIGINT : le lot en cours se termine avant de
// couper la connexion — un signal reçu pendant un `traiterLot` ne l'interrompt
// pas au milieu d'un envoi. C'est justement pour le cas où il n'a pas le temps
// de finir (processus tué, pas seulement arrêté) qu'existe `marquerIncertaines`
// (D39) : le prochain worker qui démarre la retrouvera `INCERTAINE`, jamais
// reprise automatiquement.
//
// AUCUN NUMÉRO NI TEXTE DE MESSAGE DANS LES JOURNAUX (donnée de santé) : une
// ligne par lot NON VIDE, avec uniquement des compteurs.

import { jourLocal } from '../src/lib/dates'
import { prisma } from '../src/server/db/client'
import { traiterLot } from '../src/server/notifications/file'
import { planifierRappels } from '../src/server/notifications/rappels'
import { marquerAbsentsAutomatiques } from '../src/server/services/agenda'
import { purgerInscriptionsExpirees, rattraperEnvoisOrphelins } from '../src/server/services/liste-attente'
import { genererPlagesPourTousLesPraticiens } from '../src/server/services/presences'

const INTERVALLE_MS = 15_000
const PURGE_INTERVALLE_MS = 60 * 60_000

const uneFois = process.argv.includes('--une-fois')

let arret = false
function demanderArret(signal: string): void {
  console.log(`worker-notifications : signal ${signal} reçu, arrêt après le lot en cours`)
  arret = true
}
process.once('SIGTERM', () => demanderArret('SIGTERM'))
process.once('SIGINT', () => demanderArret('SIGINT'))

// `0` : la toute première passe fait aussi la purge, pas la peine d'attendre
// une heure pour la première exécution du worker.
let dernierePurgeMs = 0

// Glissement quotidien des présences (compléments d'agenda, lot 1) : `null`
// jusqu'au premier passage, qui génère donc toujours — pas la peine d'attendre
// un changement de jour pour que la toute première exécution du worker pose
// les plages de présence. Ensuite, un seul passage par jour civil suffit : la
// fenêtre ne bouge qu'une fois par jour (`verifierEtReconcilier`,
// src/server/services/presences.ts), la retraiter toutes les quinze secondes
// n'apporterait rien et solliciterait la base pour rien.
let dernièreGenerationPresencesJour: string | null = null

async function passage(): Promise<void> {
  const maintenant = new Date()

  const jourCourant = jourLocal(maintenant)
  if (jourCourant !== dernièreGenerationPresencesJour) {
    const resultat = await genererPlagesPourTousLesPraticiens(maintenant)
    dernièreGenerationPresencesJour = jourCourant
    if (resultat.praticiens > 0) {
      console.log(
        `worker-notifications : présences — ${resultat.praticiens} praticien(s), ` +
          `${resultat.creees} plage(s) créée(s), ${resultat.supprimees} supprimée(s)` +
          (resultat.conflits > 0 ? `, ${resultat.conflits} conflit(s)` : ''),
      )
    }
  }

  const rattrapes = await rattraperEnvoisOrphelins(maintenant)
  if (rattrapes > 0) {
    console.log(`worker-notifications : ${rattrapes} envoi(s) de liste d'attente rattrapé(s) dans la file`)
  }

  if (maintenant.getTime() - dernierePurgeMs >= PURGE_INTERVALLE_MS) {
    const purgees = await purgerInscriptionsExpirees(maintenant)
    dernierePurgeMs = maintenant.getTime()
    if (purgees > 0) console.log(`worker-notifications : ${purgees} inscription(s) de liste d'attente purgée(s)`)
  }

  const rappels = await planifierRappels(maintenant)
  if (rappels.j2 > 0 || rappels.h3 > 0) {
    console.log(`worker-notifications : ${rappels.j2} rappel(s) J-2 planifié(s), ${rappels.h3} rappel(s) H-3 planifié(s)`)
  }

  // Absence automatique 20 minutes après le début (Q27, lot 3) : jamais posée
  // par un écran, uniquement par ce worker — voir
  // `src/server/services/agenda.ts` pour la garde du hors ligne (site sans
  // poste vivant) et pourquoi aucun SMS ne part ici.
  const absences = await marquerAbsentsAutomatiques(maintenant)
  if (absences.marques > 0) {
    console.log(`worker-notifications : ${absences.marques} rendez-vous marqué(s) absent automatiquement`)
  }

  const resultat = await traiterLot(maintenant)
  const traitees = resultat.envoyees + resultat.abandonnees + resultat.echecs + resultat.reportees + resultat.incertaines
  if (traitees > 0) {
    console.log(
      `worker-notifications : ${resultat.envoyees} envoyée(s), ${resultat.abandonnees} abandonnée(s), ` +
        `${resultat.echecs} échec(s), ${resultat.reportees} reportée(s), ${resultat.incertaines} incertaine(s)`,
    )
  }
}

async function main(): Promise<void> {
  await passage()

  if (!uneFois) {
    while (!arret) {
      await new Promise((resolve) => setTimeout(resolve, INTERVALLE_MS))
      if (arret) break
      await passage()
    }
    console.log('worker-notifications : arrêté proprement')
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
