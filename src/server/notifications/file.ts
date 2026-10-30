import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import { CanalNotification, StatutEnvoiListeAttente, StatutNotification, TypeNotification } from '@prisma/client'

import { categorieNotification } from '@/lib/categories-notifications'
import { dansLaFenetreEnvoi } from '@/lib/dates'
import { prisma } from '@/server/db/client'
import { envoyerParCanal } from '@/server/notifications/canaux'

// File de notifications persistante (phase 4, lot 1) : une mutation métier qui
// doit prévenir quelqu'un n'appelle plus jamais `envoyerSms` directement — elle
// ÉMET une ligne (`emettre`), et c'est le worker séparé
// (`scripts/worker-notifications.ts`) qui la traite (`traiterLot`), à son
// rythme. Voir le commentaire du modèle `Notification` dans le schéma (D37).
//
// Trois raisons à cette séparation, plutôt qu'un appel SMS synchrone dans la
// mutation :
//   - un SMS qui échoue ne doit jamais faire échouer l'écriture métier qui l'a
//     déclenché (une réservation ne doit pas se défaire parce que Brevo est en
//     panne) ;
//   - un rappel de rendez-vous (lot 3) n'a de sens qu'émis en avance et envoyé
//     au bon moment, jamais immédiatement ;
//   - un worker qui meurt au milieu d'un envoi ne doit jamais le renvoyer en
//     double (D39) — une file en base, avec un statut qui survit au process,
//     est ce qui rend ça vérifiable après coup.

/** Un client Prisma ordinaire, ou le client d'une transaction en cours :
 *  `emettre` doit pouvoir s'appeler DANS la transaction d'une mutation métier
 *  (voir `creneauLibere`, `src/server/services/liste-attente.ts`), pas
 *  seulement en dehors. */
export type ClientNotification = PrismaClient | Prisma.TransactionClient

const LIMITE_PAR_DEFAUT = 20

/** Au-delà, une ligne prise (`EN_COURS`) sans nouvelle du worker passe
 *  `INCERTAINE` (D39) : un worker tué après l'appel au fournisseur mais avant
 *  l'écriture du statut final ne sait pas si le message est réellement parti.
 *  Renvoyer risquerait le doublon qu'un rappel ne doit jamais produire ; rester
 *  bloquée en `EN_COURS` la rendrait invisible. `INCERTAINE` est le seul choix
 *  qui ne mente pas : au plus une fois, visible pour qu'un humain tranche. */
const SEUIL_INCERTAIN_MS = 10 * 60_000

/** Échec explicite du fournisseur (D40) : replanifie avec un délai croissant,
 *  indexé par `tentatives - 1` (1re replanification après la 1re tentative,
 *  etc.). Au-delà de quatre replanifications — donc à la 5e tentative — la
 *  ligne passe `ECHEC` plutôt que d'être reprogrammée une fois de plus. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000] as const
const TENTATIVES_MAX = 5

/**
 * Jointure stable pour une clé d'idempotence : `type:entité:débutISO:destinataire:canal`
 * par convention, mais `emettre` ne connaît que la chaîne finale — c'est
 * l'appelant qui choisit ce qui compose « le même événement ». Une `Date` est
 * toujours rendue en ISO (stable, non ambigu) ; `null`/`undefined` en chaîne vide.
 */
export function cleIdempotence(parties: (string | Date | null | undefined)[]): string {
  return parties.map((p) => (p instanceof Date ? p.toISOString() : (p ?? ''))).join(':')
}

export type EntreeNotification = {
  type: TypeNotification
  canal: CanalNotification
  /** Téléphone E.164 ou e-mail — jamais les deux, `canal` dit lequel. */
  destinataire: string
  texte: string
  sujet?: string
  rendezVousId?: string
  rendezVousDebut?: Date
  envoiListeAttenteId?: string
  siteId?: string
  /** Par défaut immédiat (`now()` côté base). */
  planifiePour?: Date
  attendReponse?: boolean
  /** Voir `cleIdempotence()`. */
  cle: string
}

/**
 * Émet une notification dans la file. Idempotente : si `cle` existe déjà,
 * n'écrit rien et rend `false` — c'est le SEUL contrat que l'appelant doit
 * connaître, jamais un code d'erreur à interpréter.
 *
 * Accepte un client de transaction : un appelant qui écrit une ligne métier et
 * veut « prévenir quelqu'un » dans la MÊME transaction (`creneauLibere`) n'a
 * rien de spécial à faire — la ligne de notification apparaît ou disparaît
 * avec le reste de l'écriture.
 */
export async function emettre(client: ClientNotification, n: EntreeNotification): Promise<boolean> {
  const { count } = await client.notification.createMany({
    data: [
      {
        type: n.type,
        canal: n.canal,
        cleIdempotence: n.cle,
        destinataire: n.destinataire,
        texte: n.texte,
        sujet: n.sujet ?? null,
        rendezVousId: n.rendezVousId ?? null,
        rendezVousDebut: n.rendezVousDebut ?? null,
        envoiListeAttenteId: n.envoiListeAttenteId ?? null,
        siteId: n.siteId ?? null,
        planifiePour: n.planifiePour ?? new Date(),
        attendReponse: n.attendReponse ?? false,
      },
    ],
    skipDuplicates: true,
  })
  return count === 1
}

export type LigneNotificationPrise = {
  id: string
  type: TypeNotification
  canal: CanalNotification
  destinataire: string
  texte: string
  sujet: string | null
  rendezVousId: string | null
  rendezVousDebut: Date | null
  envoiListeAttenteId: string | null
  siteId: string | null
  /** Déjà incrémentée par `prendreLot` : vaut 1 à la première prise. */
  tentatives: number
}

/**
 * Prend au plus `limite` lignes dues (`A_ENVOYER`, `planifiePour <= maintenant`),
 * les marque `EN_COURS` et incrémente leur compteur de tentatives — tout en une
 * seule instruction SQL atomique (`UPDATE … RETURNING`, `FOR UPDATE SKIP LOCKED`).
 *
 * `SKIP LOCKED` est ce qui permet à deux workers de tourner en parallèle sans
 * jamais prendre la même ligne : chacun saute ce que l'autre a déjà verrouillé
 * plutôt que d'attendre dessus.
 *
 * Les noms de colonnes SQL sont ceux du schéma (`@map`), pas les noms Prisma.
 */
export async function prendreLot(limite: number, maintenant: Date): Promise<LigneNotificationPrise[]> {
  return prisma.$queryRaw<LigneNotificationPrise[]>`
    UPDATE notification
    SET statut = 'EN_COURS'::"StatutNotification",
        pris_le = ${maintenant},
        tentatives = tentatives + 1,
        updated_at = now()
    WHERE id IN (
      SELECT id FROM notification
      WHERE statut = 'A_ENVOYER'::"StatutNotification" AND planifie_pour <= ${maintenant}
      ORDER BY planifie_pour
      LIMIT ${limite}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      type,
      canal,
      destinataire,
      texte,
      sujet,
      rendez_vous_id          AS "rendezVousId",
      rendez_vous_debut       AS "rendezVousDebut",
      envoi_liste_attente_id  AS "envoiListeAttenteId",
      site_id                 AS "siteId",
      tentatives
  `
}

/**
 * Fait passer `INCERTAINE` toute ligne `EN_COURS` prise il y a plus de dix
 * minutes (D39) — jamais remise `A_ENVOYER`. Rend le nombre de lignes touchées.
 */
export async function marquerIncertaines(maintenant: Date): Promise<number> {
  const seuil = new Date(maintenant.getTime() - SEUIL_INCERTAIN_MS)
  return prisma.$executeRaw`
    UPDATE notification
    SET statut = 'INCERTAINE'::"StatutNotification", updated_at = now()
    WHERE statut = 'EN_COURS'::"StatutNotification" AND pris_le < ${seuil}
  `
}

export type VerdictPertinence = 'envoyer' | { abandon: string }

/**
 * Un type de notification peut poser une DERNIÈRE question avant d'envoyer
 * pour de vrai : « est-ce encore pertinent ? ». Au lot 1, seul `CRENEAU_LIBERE`
 * répond à cette question (voir l'enregistrement dans
 * `src/server/services/liste-attente.ts`) — un objet mutable exporté, pas une
 * constante figée : c'est le domaine métier qui s'enregistre auprès de la
 * file, jamais l'inverse. La file générique ne doit rien savoir de la liste
 * d'attente, des rendez-vous ou de quoi que ce soit de métier.
 *
 * Reçoit `maintenant` en second paramètre : un vérificateur qui lirait
 * l'horloge lui-même rendrait les tests non déterministes, exactement la
 * raison pour laquelle `creneauLibere` reçoit déjà `maintenant` en paramètre.
 */
export type Verificateur = (n: LigneNotificationPrise, maintenant: Date) => Promise<VerdictPertinence>

export const verificateurs: Partial<Record<TypeNotification, Verificateur>> = {}

/**
 * Préférences patient par canal (phase 4, lot 5b, D44) : la dernière question
 * posée avant d'envoyer pour de vrai, après celle de `verificateurs` — « ce
 * patient veut-il encore de CE genre de message, sur CE canal ? ».
 *
 * Appliquée à l'ENVOI, jamais à l'émission (`emettre`) : un rappel émis des
 * jours avant doit respecter une préférence changée entre-temps, et c'est
 * exactement pour ça que ce n'est pas un `Verificateur` de plus enregistré
 * par type — la question se pose pour TOUT type dont la catégorie n'est pas
 * TRANSACTIONNEL, pas seulement pour un type que la liste d'attente connaît.
 *
 * TRANSACTIONNEL ne passe jamais par ici : c'est la réponse directe à un
 * geste du patient ou du cabinet sur son rendez-vous, aucune préférence ne la
 * coupe (voir `src/lib/categories-notifications.ts`).
 *
 * Absence de ligne `PreferenceNotification` = tout autorisé.
 */
async function verdictPreference(ligne: LigneNotificationPrise): Promise<VerdictPertinence> {
  const categorie = categorieNotification(ligne.type)
  if (categorie === 'TRANSACTIONNEL') return 'envoyer'

  const preference = await prisma.preferenceNotification.findUnique({
    where: { canal_destinataire: { canal: ligne.canal, destinataire: ligne.destinataire } },
    select: { rappels: true, nonEssentiels: true },
  })
  if (!preference) return 'envoyer'

  if (categorie === 'INFORMATION_SOIN' && !preference.rappels) {
    return { abandon: 'Désabonné par le patient (préférence)' }
  }
  if (categorie === 'NON_ESSENTIEL' && !preference.nonEssentiels) {
    return { abandon: 'Désabonné par le patient (préférence)' }
  }
  return 'envoyer'
}

export type ResultatTraitement = {
  envoyees: number
  abandonnees: number
  echecs: number
  reportees: number
  incertaines: number
}

/**
 * Traite un lot de la file : marque d'abord les prises orphelines
 * `INCERTAINE` (D39), puis — seulement si on est dans la fenêtre d'envoi
 * (`dansLaFenetreEnvoi`, D29) — prend jusqu'à `limite` lignes dues et les
 * résout une à une : pertinence, puis envoi, puis statut final.
 *
 * Fenêtre de silence : la variante la plus simple qui reste correcte est de ne
 * RIEN prendre du tout hors fenêtre. Une ligne due à 22h reste `A_ENVOYER`
 * avec son `planifiePour` d'origine (déjà dans le passé) ; au prochain passage
 * après 8h, `planifie_pour <= maintenant` est toujours vrai et elle est prise
 * normalement — aucune replanification séparée n'est nécessaire.
 */
export async function traiterLot(maintenant: Date = new Date(), options?: { limite?: number }): Promise<ResultatTraitement> {
  const resultat: ResultatTraitement = { envoyees: 0, abandonnees: 0, echecs: 0, reportees: 0, incertaines: 0 }

  resultat.incertaines = await marquerIncertaines(maintenant)

  if (!dansLaFenetreEnvoi(maintenant)) return resultat

  const lignes = await prendreLot(options?.limite ?? LIMITE_PAR_DEFAUT, maintenant)

  for (const ligne of lignes) {
    const verificateur = verificateurs[ligne.type]
    const verdictPertinence = verificateur ? await verificateur(ligne, maintenant) : 'envoyer'
    // Préférence patient (D44) : posée seulement si la ligne est encore
    // pertinente — inutile d'interroger `PreferenceNotification` pour un
    // créneau déjà repris.
    const verdict = verdictPertinence === 'envoyer' ? await verdictPreference(ligne) : verdictPertinence

    if (verdict !== 'envoyer') {
      await prisma.notification.update({
        where: { id: ligne.id },
        data: { statut: StatutNotification.ABANDONNEE, derniereErreur: verdict.abandon },
      })
      if (ligne.envoiListeAttenteId) {
        // `updateMany`, pas `update` : la ligne a pu disparaître entre-temps
        // (désinscription) — dans ce cas `envoiListeAttenteId` aurait déjà été
        // mis à NULL par le `SetNull` du schéma, mais mieux vaut ne jamais
        // lever sur une course résiduelle plutôt que de le supposer impossible.
        await prisma.envoiListeAttente.updateMany({
          where: { id: ligne.envoiListeAttenteId },
          data: { statut: StatutEnvoiListeAttente.ABANDONNE },
        })
      }
      resultat.abandonnees += 1
      continue
    }

    const envoiResultat = await envoyerParCanal(ligne)

    if (envoiResultat.ok) {
      await prisma.notification.update({
        where: { id: ligne.id },
        data: {
          statut: StatutNotification.ENVOYEE,
          envoyeeLe: maintenant,
          fournisseur: envoiResultat.fournisseur,
          referenceFournisseur: envoiResultat.reference ?? null,
          creditsUtilises: envoiResultat.credits ?? null,
        },
      })
      if (ligne.envoiListeAttenteId) {
        await prisma.envoiListeAttente.updateMany({
          where: { id: ligne.envoiListeAttenteId },
          data: { statut: StatutEnvoiListeAttente.ENVOYE, envoyeLe: maintenant },
        })
      }
      resultat.envoyees += 1
      continue
    }

    if (ligne.tentatives >= TENTATIVES_MAX) {
      await prisma.notification.update({
        where: { id: ligne.id },
        data: { statut: StatutNotification.ECHEC, derniereErreur: envoiResultat.raison },
      })
      resultat.echecs += 1
      continue
    }

    // `tentatives` vaut ici 1 à 4 (`TENTATIVES_MAX` exclu ci-dessus) : l'index
    // tombe toujours dans `BACKOFF_MS`, mais `noUncheckedIndexedAccess` ne le
    // sait pas.
    const delai = BACKOFF_MS[ligne.tentatives - 1]!
    await prisma.notification.update({
      where: { id: ligne.id },
      data: {
        statut: StatutNotification.A_ENVOYER,
        planifiePour: new Date(maintenant.getTime() + delai),
        derniereErreur: envoiResultat.raison,
      },
    })
    resultat.reportees += 1
  }

  return resultat
}
