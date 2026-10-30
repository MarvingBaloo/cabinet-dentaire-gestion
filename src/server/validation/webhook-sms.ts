import { z } from 'zod'

// Format supposé du corps POSTé par Brevo pour un événement SMS transactionnel
// (envoyé, délivré, échoué, ET répondu — un seul webhook pour tous, distingués
// par `msg_status`) — d'après https://developers.brevo.com/docs/transactional-webhooks
// (consulté le 2026-09-23). L'événement de réponse porte `msg_status: "replied"`
// et un champ `reply` avec le texte reçu ; `to` porte le numéro du destinataire,
// SANS le `+` (comme en émission, voir `destinataireBrevo()` dans
// `src/server/sms/brevo.ts` — ce schéma en suppose l'inverse exact).
//
// ⚠ NON ÉPROUVÉ SUR UN ENVOI RÉEL. Aucune réponse n'a été reçue à ce jour : il
// faut un numéro virtuel Brevo capable de recevoir des SMS (l'expéditeur
// alphanumérique utilisé aujourd'hui pour le second facteur, D18, ne le peut
// structurellement pas) et un vrai +590 qui y répond, avant mise en service.
// Le parsing Zod est volontairement défensif (`.passthrough()` implicite via
// des champs optionnels) : un corps qui ne colle pas à cette hypothèse est
// rejeté en 400 plutôt que de planter plus loin sur un champ absent.
export const brevoSmsWebhookSchema = z.object({
  msg_status: z.string(),
  to: z.string().trim().min(1),
  reply: z.string().optional(),
  messageId: z.union([z.string(), z.number()]).optional(),
  ts_event: z.union([z.string(), z.number()]).optional(),
})

export type BrevoSmsWebhookBody = z.infer<typeof brevoSmsWebhookSchema>
