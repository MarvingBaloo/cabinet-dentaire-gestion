import 'server-only'

import { prisma } from '@/server/db/client'

// Limite la lecture des créneaux par adresse IP (D19, D25) : sans elle, un
// robot peut relever deux mois d'agenda en boucle, sans jamais s'authentifier
// ni écrire quoi que ce soit — rien d'autre ne l'arrêterait.
//
// POURQUOI PAS LE JOURNAL D'AUDIT, contrairement à `tropDeTentatives` (D7ter).
// Ces lectures n'y sont pas tracées : elles n'ont pas d'acteur, et consigner
// chaque consultation du portail dresserait un profil de navigation sans
// valeur d'investigation — ce que D9 ne demande pas. D'où une table dédiée,
// `CompteurLecturePublique`, faite de lignes jetables plutôt que d'un
// historique.
//
// POURQUOI PAS DE COMPTEUR EN MÉMOIRE NI DE REDIS : un compteur en mémoire
// serait faux dès qu'on fait tourner plus d'une instance, ce que l'hébergement
// conteneurisé permettra ; Redis est une dépendance que ce projet n'a pas
// (D25 écarte les deux, faute de règle du cabinet à trancher autrement).

const FENETRE_MINUTES = 15
const FENETRE_MS = FENETRE_MINUTES * 60_000

// ⚠ Le cabinet entier sort sur UNE seule IP publique (NAT) : ce seuil agrège
// la consultation du portail par tout le monde, patients et accueil confondus.
// Chaque clic « dates suivantes » relit tout le calcul (page.tsx ne fait pas de
// pagination côté client) : un patient qui parcourt les deux mois d'ouverture
// peut cliquer une vingtaine de fois. 300 lectures en un quart d'heure
// couvrent large — une quinzaine de patients bornant leur recherche en même
// temps depuis le même accueil — tout en arrêtant net un robot qui boucle sur
// l'agenda, lequel franchit ce seuil en quelques secondes.
const SEUIL_LECTURES_PAR_IP = 300

/** Le début de la fenêtre de 15 minutes en cours : tronquer l'horodatage donne
 *  une clé stable pour tout appel tombant dans le même quart d'heure, ce qui
 *  rend l'incrément atomique par upsert (clé unique ip × fenêtre) — même
 *  principe que le modèle de compte de manquements, sans avoir à relire
 *  l'historique à chaque appel. */
function debutFenetre(maintenant: Date): Date {
  return new Date(Math.floor(maintenant.getTime() / FENETRE_MS) * FENETRE_MS)
}

/**
 * Incrémente le compteur de la fenêtre en cours pour cette adresse, et dit si
 * elle a dépassé le seuil. Une adresse non résolue (`'inconnue'`) n'est jamais
 * limitée : elle désignerait tout le monde à la fois.
 */
export async function tropDeLecturesPubliques(ipAddress: string): Promise<boolean> {
  if (ipAddress === 'inconnue') return false

  const maintenant = new Date()
  const fenetre = debutFenetre(maintenant)

  const compteur = await prisma.compteurLecturePublique.upsert({
    where: { ipAddress_fenetre: { ipAddress, fenetre } },
    create: { ipAddress, fenetre },
    update: { nombre: { increment: 1 } },
    select: { nombre: true },
  })

  // Nettoyage opportuniste : ces lignes ne servent que pendant leur propre
  // fenêtre, une heure de marge suffit. Rien de plus qu'un tirage au sort pour
  // éviter d'alourdir CHAQUE lecture d'un DELETE — une table de lignes
  // jetables n'a pas besoin d'une tâche planifiée séparée.
  if (Math.random() < 0.02) {
    await prisma.compteurLecturePublique.deleteMany({
      where: { fenetre: { lt: new Date(maintenant.getTime() - 60 * 60_000) } },
    })
  }

  return compteur.nombre > SEUIL_LECTURES_PAR_IP
}
