import 'server-only'

import { CanalNotification, StatutEnvoiListeAttente, StatutRendezVous, TypeNotification } from '@prisma/client'

import { env } from '@/config/env'
import { dansLaFenetreEnvoi, prochainHuitHeures } from '@/lib/dates'
import { type ClientNotification, cleIdempotence, emettre, verificateurs } from '@/server/notifications/file'
import { rendreMessage } from '@/server/notifications/messages'
import { prisma } from '@/server/db/client'

// Liste d'attente (lot D, D29) : quand un créneau se libère, les inscrits qui
// lui correspondent reçoivent un lien vers le parcours de réservation existant.
// Le premier qui réserve l'obtient — l'atomicité vient de `confirmerReservation`
// (D12), rien n'est réinventé ici.
//
// Point d'extension unique. Un créneau se libère de trois façons — une demande
// d'annulation validée (`validerAnnulation`, src/server/services/agenda.ts),
// une annulation par le patient (`annulerParPatient`, D22) et un déplacement,
// pour l'ANCIEN créneau (`deplacerParPatient`, D28) — et les trois appellent
// déjà `creneauLibere` ci-dessous. Aucun des trois n'a eu à changer de forme :
// `maintenant` est un second paramètre optionnel (par défaut `new Date()`),
// ajouté pour que les tests puissent fixer l'heure sans horloge cachée.
//
// ⚠ DEPUIS LA FILE DE NOTIFICATIONS (phase 4, lot 1, D37) : `creneauLibere`
// n'appelle plus jamais `envoyerSms` — aucun SMS ne part plus depuis une
// requête HTTP. Elle ÉMET une ligne dans `notification` (`emettre`), dans la
// MÊME transaction que l'écriture des `EnvoiListeAttente` : c'est le worker
// séparé (`scripts/worker-notifications.ts`) qui l'envoie, à son rythme. Ce
// fichier s'enregistre auprès de la file (`verificateurs[CRENEAU_LIBERE]`,
// tout en bas) pour répondre à la seule question que la file ne sait pas poser
// elle-même : « ce créneau est-il encore libre et à venir ? ».

export type CreneauLibere = {
  siteId: string
  praticienId: string
  motifId: string
  debut: Date
  fin: Date
  /**
   * IP à l'origine de la libération, pour la trace d'audit d'un envoi. Les
   * trois appelants la connaissent déjà (ctx.ipAddress ou le paramètre direct).
   * Facultative : un appel qui ne la fournit pas (test, script) trace `'interne'`.
   */
  ipAddress?: string
}

/** Au plus cinq personnes prévenues par créneau libéré (D29), dans l'ordre
 *  d'inscription. Garanti sous concurrence par le verrou consultatif posé
 *  avant le comptage (D30) : deux libérations « simultanées » du même créneau
 *  se sérialisent, la seconde ne trouve alors plus de place. */
const PLAFOND_PAR_CRENEAU = 5

/**
 * Le lien de réservation, pré-rempli — c'est le parcours public existant
 * (`src/app/rendez-vous/page.tsx`), rien de dédié. Il ne « réserve » rien par
 * lui-même : ouvert, il retombe sur `creneauxDisponibles`, donc reste valable
 * tant, et seulement tant, que le créneau est réellement encore libre (D29).
 */
function lienReservation(params: { siteId: string; motifId: string; praticienId: string; debut: Date }): string {
  const q = new URLSearchParams({
    site: params.siteId,
    motif: params.motifId,
    praticien: params.praticienId,
    creneau: params.debut.toISOString(),
  })
  return `${env.APP_URL}/rendez-vous?${q.toString()}`
}

/** Sans motif ni nom (minimisation RGPD, comme les autres SMS du portail) : la
 *  date et l'heure, et le lien, suffisent à agir. Texte paramétrable depuis
 *  le lot 5a (`rendreMessage`, TypeNotification.CRENEAU_LIBERE) — {lien} est
 *  le seul champ de fusion qui n'existe que pour ce type. */
async function messageListeAttente(
  db: ClientNotification,
  params: { siteId: string; motifId: string; praticienId: string; debut: Date },
): Promise<string> {
  const site = await db.site.findUniqueOrThrow({ where: { id: params.siteId }, select: { nom: true } })
  const { texte } = await rendreMessage(db, TypeNotification.CRENEAU_LIBERE, CanalNotification.SMS, {
    debut: params.debut,
    siteNom: site.nom,
    lien: lienReservation(params),
  })
  return texte
}

/** Appelée quand un créneau redevient libre : notifie au plus cinq inscrits
 *  correspondants, dans l'ordre d'inscription, en respectant la fenêtre
 *  21h-8h (D29). `maintenant` est un paramètre — jamais `new Date()` caché —
 *  pour que la fenêtre horaire se teste sans attendre l'horloge réelle. */
export async function creneauLibere(evenement: CreneauLibere, maintenant: Date = new Date()): Promise<void> {
  const immediat = dansLaFenetreEnvoi(maintenant)
  const planifiePour = immediat ? null : prochainHuitHeures(maintenant)
  const cleVerrou = `${evenement.praticienId}|${evenement.debut.toISOString()}|${evenement.fin.toISOString()}`

  await prisma.$transaction(async (tx) => {
    // Verrou consultatif posé AVANT le comptage : deux appels concurrents pour
    // le même créneau se sérialisent ici, le second ne voit le premier qu'une
    // fois sa transaction validée — donc son comptage inclut déjà ses envois.
    // Portée `xact` : relâché automatiquement à la fin de la transaction, quoi
    // qu'il arrive (D30).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cleVerrou}, 0))`

    const dejaEnvoyes = await tx.envoiListeAttente.count({
      where: { praticienId: evenement.praticienId, creneauDebut: evenement.debut, creneauFin: evenement.fin },
    })
    const restant = PLAFOND_PAR_CRENEAU - dejaEnvoyes
    if (restant <= 0) return

    const eligibles = await tx.inscriptionListeAttente.findMany({
      where: {
        motifId: evenement.motifId,
        siteId: evenement.siteId,
        AND: [
          // Praticien précisé à l'inscription (D29) ou « peu importe ».
          { OR: [{ praticienId: null }, { praticienId: evenement.praticienId }] },
          // Date butoir (D29) : sans elle, toujours éligible ; avec elle,
          // seulement si CE créneau libéré commence STRICTEMENT avant — un
          // créneau libéré à la date butoir ou après ne lui apporte rien qu'il
          // n'avait déjà au moment de son inscription.
          { OR: [{ avantLe: null }, { avantLe: { gt: evenement.debut } }] },
        ],
        expiresAt: { gt: maintenant },
        // Défense contre un rejeu accidentel de la même libération : un
        // inscrit déjà notifié pour CE créneau précis ne l'est pas deux fois.
        envois: {
          none: { praticienId: evenement.praticienId, creneauDebut: evenement.debut, creneauFin: evenement.fin },
        },
      },
      // Ordre d'inscription (D29) : premier arrivé sur la liste, premier prévenu.
      orderBy: { createdAt: 'asc' },
      select: { id: true, telephone: true },
    })
    if (eligibles.length === 0) return

    // Patient bloqué (D21) : un lien de réservation qu'il ne pourrait pas
    // utiliser ne lui rend pas service, et ne coûte pas non plus un SMS.
    const telephones = [...new Set(eligibles.map((e) => e.telephone))]
    const bloques = await tx.patient.findMany({
      where: { telephone: { in: telephones }, actif: true, reservationBloquee: true },
      select: { telephone: true },
    })
    const telephonesBloques = new Set(bloques.map((p) => p.telephone))
    const retenus = eligibles.filter((e) => !telephonesBloques.has(e.telephone)).slice(0, restant)

    for (const inscription of retenus) {
      const envoi = await tx.envoiListeAttente.create({
        data: {
          inscriptionId: inscription.id,
          creneauDebut: evenement.debut,
          creneauFin: evenement.fin,
          praticienId: evenement.praticienId,
          siteId: evenement.siteId,
          motifId: evenement.motifId,
          planifiePour,
        },
        select: { id: true },
      })

      // Émise DANS la même transaction que l'écriture de `EnvoiListeAttente` :
      // la ligne de notification apparaît ou disparaît avec le reste (D37).
      // Aucun SMS ne part d'ici — c'est le worker qui le fera, séparément.
      await emettre(tx, {
        type: TypeNotification.CRENEAU_LIBERE,
        canal: CanalNotification.SMS,
        destinataire: inscription.telephone,
        texte: await messageListeAttente(tx, {
          siteId: evenement.siteId,
          motifId: evenement.motifId,
          praticienId: evenement.praticienId,
          debut: evenement.debut,
        }),
        envoiListeAttenteId: envoi.id,
        siteId: evenement.siteId,
        planifiePour: planifiePour ?? maintenant,
        cle: cleIdempotence(['CRENEAU_LIBERE', envoi.id, 'SMS']),
      })
    }
  })
}

/** Purge les inscriptions périmées (horizon de deux mois, D29). Appelée par la
 *  tâche de maintenance, comme `purgerAccesExpires` et `purgerCodesExpires`. */
export async function purgerInscriptionsExpirees(maintenant: Date): Promise<number> {
  const { count } = await prisma.inscriptionListeAttente.deleteMany({
    where: { expiresAt: { lt: maintenant } },
  })
  return count
}

/**
 * Rattrapage (phase 4, lot 1) : un `EnvoiListeAttente` créé avant la file de
 * notifications n'a pas de ligne `Notification` associée — `creneauLibere`
 * appelait alors le fournisseur SMS directement, ou laissait la ligne
 * `EN_ATTENTE` pour l'ancien script planifié (supprimé au même lot). Le worker
 * appelle cette fonction à chaque passage : de quoi les émettre dans la file
 * sans migration de données fragile sur le texte du message (reconstruit ici,
 * comme `creneauLibere` le fait).
 */
export async function rattraperEnvoisOrphelins(maintenant: Date): Promise<number> {
  const orphelins = await prisma.envoiListeAttente.findMany({
    where: { statut: StatutEnvoiListeAttente.EN_ATTENTE, notification: { is: null } },
    include: { inscription: { select: { telephone: true } } },
  })

  let rattrapes = 0
  for (const envoi of orphelins) {
    const cree = await emettre(prisma, {
      type: TypeNotification.CRENEAU_LIBERE,
      canal: CanalNotification.SMS,
      destinataire: envoi.inscription.telephone,
      texte: await messageListeAttente(prisma, {
        siteId: envoi.siteId,
        motifId: envoi.motifId,
        praticienId: envoi.praticienId,
        debut: envoi.creneauDebut,
      }),
      envoiListeAttenteId: envoi.id,
      siteId: envoi.siteId,
      planifiePour: envoi.planifiePour ?? maintenant,
      cle: cleIdempotence(['CRENEAU_LIBERE', envoi.id, 'SMS']),
    })
    if (cree) rattrapes += 1
  }
  return rattrapes
}

/**
 * Le créneau visé par cet envoi est-il encore libre, et encore à venir ?
 * Même question qu'à la libération, posée une seconde fois au moment où le
 * worker s'apprête réellement à envoyer — un créneau libéré à 22h peut avoir
 * été repris entre son émission et 8h le lendemain.
 */
async function creneauEncoreLibreEtAVenir(
  envoi: { praticienId: string; creneauDebut: Date; creneauFin: Date },
  maintenant: Date,
): Promise<boolean> {
  if (envoi.creneauDebut <= maintenant) return false

  const occupe = await prisma.rendezVous.findFirst({
    where: {
      praticienId: envoi.praticienId,
      debut: envoi.creneauDebut,
      fin: envoi.creneauFin,
      statut: { notIn: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT] },
      surbooking: false,
    },
    select: { id: true },
  })
  return occupe === null
}

// Enregistrement auprès de la file de notifications (D37/D38) : un effet de
// bord au chargement de ce module, pas un appel explicite — `traiterLot`
// (src/server/notifications/file.ts) lit `verificateurs` par type au moment de
// traiter chaque ligne, quel que soit l'ordre dans lequel les modules ont été
// importés. Écrit ICI et pas dans `file.ts` à dessein : c'est la liste
// d'attente qui dépend de la file générique, jamais l'inverse — `file.ts` ne
// doit rien savoir des créneaux, des inscriptions ni d'aucune autre notion
// métier.
verificateurs[TypeNotification.CRENEAU_LIBERE] = async (notification, maintenant) => {
  if (!notification.envoiListeAttenteId) return { abandon: 'sans_envoi_liste_attente' }

  const envoi = await prisma.envoiListeAttente.findUnique({
    where: { id: notification.envoiListeAttenteId },
    select: { praticienId: true, creneauDebut: true, creneauFin: true },
  })
  if (!envoi) return { abandon: 'envoi_introuvable' }

  const encoreLibre = await creneauEncoreLibreEtAVenir(envoi, maintenant)
  if (encoreLibre) return 'envoyer'
  return { abandon: envoi.creneauDebut <= maintenant ? 'creneau_passe' : 'creneau_repris' }
}
