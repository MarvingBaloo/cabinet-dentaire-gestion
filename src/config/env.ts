import 'server-only'

import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { z } from 'zod'

// Validation au démarrage : une variable manquante ou aberrante doit faire échouer
// le lancement, pas produire une panne obscure trois écrans plus loin. Sur des
// données de santé, un réglage de sécurité absent ne doit jamais dégrader
// silencieusement en « pas de sécurité » — d'où l'échec bruyant.
//
// La contrepartie : ce qui est exigé ici doit SERVIR. Une variable réclamée pour
// rien fait fabriquer un secret à celui qui installe, sans qu'il comprenne à
// quoi, et il n'a aucun moyen de savoir qu'elle est morte.
//
// Ce module est `server-only` : il porte des secrets, une importation depuis un
// composant client doit casser la compilation.

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Rôle applicatif cabinet_app. Voir CLAUDE.md : ne jamais y mettre le rôle
  // propriétaire, les REVOKE qui protègent audit_log deviendraient sans effet.
  DATABASE_URL: z.string().startsWith('postgresql://'),

  // Rôle propriétaire, migrations uniquement. Lu par prisma.config.ts, pas par
  // l'application — présent ici pour que son absence se voie au démarrage.
  DIRECT_DATABASE_URL: z.string().startsWith('postgresql://'),

  // Agenda en direct (D61) : LISTEN exige une connexion directe, que le pooler
  // de Neon (mode transaction) ne permet pas. FACULTATIVE : sans elle, l'écoute
  // passe par DATABASE_URL, qui est déjà directe sur le NAS et chez un hébergeur
  // qui ne met pas de pooler devant PostgreSQL. Même rôle cabinet_app.
  REALTIME_DATABASE_URL: z.string().startsWith('postgresql://').optional(),

  // Pas d'AUTH_SECRET ni d'AUTH_URL : c'étaient des variables d'Auth.js, qui
  // n'est pas utilisé (D6). Le jeton de session est opaque et aléatoire, il
  // n'est pas signé — il n'y a donc aucune clé de signature à porter.

  // Pas de MFA_ENCRYPTION_KEY : elle chiffrait le secret TOTP, abandonné au
  // profit du SMS le 2026-09-15 (D7, D15). Le code à usage unique ne se stocke
  // pas en clair mais en condensat, comme le jeton de session (D6ter) — il n'y
  // a plus rien à déchiffrer, donc plus aucune clé à porter.

  // Pas de WORKSTATION_COOKIE_SECRET : le cookie de poste porte un secret
  // opaque dont la base ne garde que le condensat, comme le jeton de session.
  // Aucune clé de signature n'est nécessaire — un secret de 32 octets est déjà
  // inguessable.

  // Fournisseur de SMS. Les deux sont FACULTATIFS : sans eux, le développement
  // affiche les codes dans le terminal et la production refuse d'envoyer plutôt
  // que d'échouer en silence. C'est leur présence qui branche l'opérateur.
  //
  // Il en faut DEUX, et pas seulement la clé : un SMS part toujours d'un
  // expéditeur déclaré, et Brevo refuse l'envoi sans lui. Une clé seule donnerait
  // un opérateur configuré qui n'envoie rien.
  BREVO_API_KEY: z.string().min(1).optional(),
  // Nom d'expéditeur affiché sur le téléphone. Brevo plafonne à 11 caractères.
  BREVO_SMS_EXPEDITEUR: z.string().trim().min(1).max(11).optional(),
  // Adresse d'expéditeur des e-mails (canal e-mail, phase 4 lot 2). Partage
  // BREVO_API_KEY avec le SMS — un seul compte Brevo, deux canaux. FACULTATIVE
  // comme BREVO_SMS_EXPEDITEUR : sans elle, `brevoEmailConfigure()` rend `null`
  // et le canal e-mail se comporte comme le SMS sans opérateur (console hors
  // production, refus en production).
  BREVO_EMAIL_EXPEDITEUR: z.string().email().optional(),

  // Hors production, les SEULS numéros vers lesquels un opérateur configuré
  // envoie réellement ; tous les autres s'écrivent dans la console. Séparés par
  // des virgules, dans n'importe quelle écriture (+590…, 0690…, avec espaces).
  // Absente ou vide : aucun envoi réel hors production — le défaut est sûr.
  // Ignorée en production, où tout part.
  //
  // Existe parce qu'un SMS est parti vers un numéro de test inventé, le
  // 2026-09-19, alors que la règle qui l'interdisait était écrite et lue (D18).
  SMS_NUMEROS_AUTORISES: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    ),

  // Même garde-fou que SMS_NUMEROS_AUTORISES, pour le canal e-mail (phase 4
  // lot 2) : hors production, les SEULES adresses vers lesquelles un opérateur
  // configuré envoie réellement. Absente ou vide : aucun envoi réel hors
  // production — le défaut est sûr. Ignorée en production.
  EMAIL_ADRESSES_AUTORISEES: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    ),

  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().max(120),

  // Marque les cookies `Secure` : le navigateur ne les renvoie alors qu'en HTTPS.
  //
  // Explicite plutôt que déduit de NODE_ENV : la seule raison légitime de le
  // désactiver est une démonstration servie en HTTP simple sur un réseau privé.
  // Le rendre visible oblige à l'écrire, au lieu de le voir basculer tout seul
  // avec un changement d'environnement.
  //
  // ⚠ DOIT valoir true en production. Un cookie de session sans `Secure` peut
  // être capté en clair sur le réseau.
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Borne basse alignée sur purge_audit_log(), qui refuse en dessous de 12 mois.
  AUDIT_RETENTION_MONTHS: z.coerce.number().int().min(12),

  // Base publique du site, pour composer un lien COMPLET dans un SMS (liste
  // d'attente, D29) : un SMS ne peut pas porter un chemin relatif. Optionnelle
  // ICI (le défaut sûr hors production est posé plus bas, pas dans le schéma) :
  // faute de nom de domaine tranché à ce jour (identité visuelle, décision
  // encore ouverte), le repli local ne sert qu'à ce que la forme du message
  // reste éprouvable en développement — un SMS de développement ne part de
  // toute façon jamais réellement (D18).
  //
  // ⚠ En PRODUCTION, aucun défaut : un lien mort part par SMS payant vers un
  // patient si cette variable manque (D33). Même esprit que BREVO_* : mieux
  // vaut refuser bruyamment que dégrader en silence sur un canal qui coûte au
  // cabinet et qui touche un patient.
  APP_URL: z.string().url().optional(),

  // Lot 4 : secret partagé du webhook entrant Brevo (réponse SMS au rappel,
  // `src/app/api/webhooks/brevo/sms/route.ts`). FACULTATIF : son absence
  // désactive la fonctionnalité — la route répond 404, comme si elle
  // n'existait pas — plutôt que de dégrader en silence. Les rappels s'adaptent
  // en conséquence (`planifierRappels`) : sans lui, `attendReponse` vaut
  // `false` et le texte n'invite jamais à répondre, puisque personne ne
  // lirait la réponse.
  //
  // Minimum 32 caractères : un secret plus court se devine par force brute
  // avant que la limite de débit du webhook n'ait le temps d'agir.
  BREVO_WEBHOOK_SECRET: z.string().min(32).optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')} : ${i.message}`)
    .join('\n')
  throw new Error(`Configuration d'environnement invalide :\n${details}`)
}

// Garde hors du schéma Zod : elle croise NODE_ENV avec NEXT_PHASE, que Zod ne
// voit pas puisqu'il ne valide que des variables applicatives (D33).
//
// `next build` force NODE_ENV=production pour compiler comme en production,
// sans être un déploiement réel — Next le trace lui-même dans NEXT_PHASE
// (`phase-production-build` pendant la compilation, absent au démarrage réel
// avec `next start`). Sans cette distinction, `npm run build` échouerait en
// local faute d'APP_URL dans `.env.local` — un fichier hors dépôt qu'aucune
// build ne doit exiger, à la différence d'un vrai déploiement.
const enProductionReelle =
  parsed.data.NODE_ENV === 'production' && process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD

if (enProductionReelle && !parsed.data.APP_URL) {
  throw new Error(
    "Configuration d'environnement invalide :\n" +
      '  - APP_URL : obligatoire en production (D33) — sans elle, le SMS de liste ' +
      "d'attente porterait un lien vers http://localhost:3000, mort pour le patient.",
  )
}

export const env = {
  ...parsed.data,
  APP_URL: parsed.data.APP_URL ?? 'http://localhost:3000',
}
