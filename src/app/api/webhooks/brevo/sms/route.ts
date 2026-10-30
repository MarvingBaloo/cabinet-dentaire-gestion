import { createHash, timingSafeEqual } from 'node:crypto'

import { env } from '@/config/env'
import { prisma } from '@/server/db/client'
import {
  limiteReponseSmsAtteinte,
  normaliserTelephoneEntrant,
  traiterReponseSms,
} from '@/server/services/reponse-sms'
import { brevoSmsWebhookSchema } from '@/server/validation/webhook-sms'

// Webhook entrant Brevo — réponse OUI/NON par SMS au rappel de rendez-vous
// (phase 4, lot 4, D22/Q26).
//
// EXCEPTION ASSUMÉE À « toute mutation par Server Action, jamais par route
// API » (CLAUDE.md) : Brevo ne peut pas appeler une Server Action, et la
// protection CSRF n'a aucun sens pour un appel serveur-à-serveur sans cookie
// ni origine navigateur. La protection ici est le secret partagé
// (`BREVO_WEBHOOK_SECRET`), transmis en en-tête `Authorization: Bearer
// <secret>` et vérifié en temps constant.
//
// Sur l'authentification Brevo : la documentation (create-webhook, consultée
// le 2026-09-23) décrit un objet `auth` optionnel (`token`, `type`) posé à la
// création du webhook, SANS préciser le schéma HTTP exact qu'il produit
// (Bearer, Basic, autre) — et un paramètre `headers` séparé, lui pleinement
// documenté, pour poser des en-têtes personnalisés clé/valeur. Faute de
// certitude sur `auth`, ce projet s'appuie sur `headers` — documenté et
// contrôlable : configurer côté Brevo un en-tête `Authorization` de valeur
// `Bearer <BREVO_WEBHOOK_SECRET>` sur ce webhook précis. Le format attendu ici
// (`Bearer <secret>`) reste donc conforme à la décision prise en amont ; à
// confirmer à la création réelle du webhook dans la console Brevo.
export async function POST(request: Request): Promise<Response> {
  const secret = env.BREVO_WEBHOOK_SECRET

  // Secret absent : la fonctionnalité n'existe pas. 404, jamais 401 — un 401
  // confirmerait qu'un webhook est attendu à cette adresse.
  if (!secret) {
    return new Response(null, { status: 404 })
  }

  // Lue directement sur `request.headers`, jamais via `headers()` de
  // `next/headers` : ce module suppose le contexte de requête que Next met en
  // place quand IL invoque le gestionnaire — un appel direct de `POST` (comme
  // le font les tests de ce fichier, et comme le ferait un test unitaire de
  // n'importe quel Route Handler) ne le fournit pas. Même en-têtes,
  // même repli, que `adresseIpClient()` (src/server/http/adresse-ip.ts) —
  // dupliqué plutôt que réutilisé : cette fonction-ci est `server-only` pour
  // de bonnes raisons ailleurs, mais dépend d'une API incompatible avec un
  // Route Handler testé en dehors du runtime Next.
  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'inconnue'

  const enTeteAuth = request.headers.get('authorization')
  const fourni = enTeteAuth?.startsWith('Bearer ') ? enTeteAuth.slice('Bearer '.length).trim() : null

  if (!fourni || !secretValide(fourni, secret)) {
    await auditWebhookRefuse(ipAddress, fourni ? 'secret invalide' : 'en-tête Authorization absent')
    // Rien d'autre n'est lu : ni le corps, ni son contenu.
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let corpsBrut: unknown
  try {
    corpsBrut = await request.json()
  } catch {
    await auditWebhookRefuse(ipAddress, 'corps JSON illisible')
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const corps = brevoSmsWebhookSchema.safeParse(corpsBrut)
  if (!corps.success) {
    await auditWebhookRefuse(ipAddress, 'corps non reconnu (schéma Brevo attendu)')
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  // Le même webhook porte tous les événements SMS (envoyé, délivré, échoué,
  // répondu…), distingués par `msg_status` — voir
  // `src/server/validation/webhook-sms.ts`. Seul « replied » avec un texte
  // est une réponse du patient ; le reste n'a rien à faire ici et ne doit pas
  // faire rejouer Brevo : 200.
  if (corps.data.msg_status !== 'replied' || !corps.data.reply) {
    return Response.json({ ok: true, ignore: 'evenement_non_reponse' }, { status: 200 })
  }

  const identifiantMessage =
    corps.data.messageId !== undefined && corps.data.ts_event !== undefined
      ? `${corps.data.messageId}:${corps.data.ts_event}`
      : undefined

  // Idempotence (D-lot4-I) : Brevo peut rejouer un événement déjà livré. Même
  // mécanisme que `Notification.emettre` — `createMany` + `skipDuplicates` —
  // cette fois sur l'entrée plutôt que la sortie. Sans identifiant exploitable
  // (champs absents du corps), rien à dédupliquer : on traite, au pire une
  // fois de trop plutôt que jamais — les effets en aval (annulation,
  // confirmation) sont de toute façon idempotents par construction (statut
  // déjà bloqué par les filtres de `traiterReponseSms`).
  if (identifiantMessage) {
    const { count } = await prisma.webhookSmsEntrant.createMany({
      data: [{ cleIdempotence: identifiantMessage }],
      skipDuplicates: true,
    })
    if (count === 0) {
      return Response.json({ ok: true, ignore: 'deja_traite' }, { status: 200 })
    }
  }

  const telephone = normaliserTelephoneEntrant(corps.data.to)
  const maintenant = new Date()

  if (limiteReponseSmsAtteinte(telephone, maintenant)) {
    return Response.json({ error: 'too_many_requests' }, { status: 429 })
  }

  await traiterReponseSms(telephone, corps.data.reply, identifiantMessage, ipAddress, maintenant)

  // Toujours 200 une fois authentifié et le corps reconnu (D-lot4-E) : « sans
  // rendez-vous associé » n'est pas une erreur pour Brevo, qui rejouerait sinon.
  return Response.json({ ok: true }, { status: 200 })
}

/** Comparaison en temps constant sur des empreintes de même longueur
 *  (`crypto.timingSafeEqual` exige des buffers de taille égale — hasher les
 *  deux côtés y pourvoit, quelle que soit la longueur du secret fourni). */
function secretValide(fourni: string, attendu: string): boolean {
  const empreinteFournie = createHash('sha256').update(fourni).digest()
  const empreinteAttendue = createHash('sha256').update(attendu).digest()
  return timingSafeEqual(empreinteFournie, empreinteAttendue)
}

async function auditWebhookRefuse(ipAddress: string, raison: string): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: 'WEBHOOK_REFUSE',
      entityType: 'webhook_sms_brevo',
      actorRoles: [],
      ipAddress,
      succeeded: false,
      deniedReason: raison,
    },
  })
}
