# Logiciel de gestion pour cabinet dentaire

Logiciel de gestion d'un cabinet dentaire réparti sur deux sites en Guadeloupe : agenda des praticiens,
prise de rendez-vous en ligne par les patients, dossiers patients, messagerie interne et statistiques.

Conçu et développé par Marving Gustave (BMG Consulting), avec des assistants de code IA.
Les données utilisées en développement et en démonstration sont inventées.

## Ce que fait l'application

- **Prise de rendez-vous en ligne** : le patient choisit un motif et un créneau libre, peut annuler, et rejoindre
  une liste d'attente quand rien n'est disponible.
- **Agenda** des praticiens et des secrétaires, mis à jour en direct, avec indisponibilités, présences et
  gestion des conflits.
- **Dossiers patients**, motifs de consultation, comptes et rôles (administration, praticien, secrétariat).
- **Statistiques** : remplissage de l'agenda, absences, motifs, prise de rendez-vous, rétrocessions.
- **Messagerie interne** entre collègues.
- **Sécurité** : double authentification, validation de la connexion depuis son téléphone par QR code,
  sessions expirées après inactivité, journal d'audit des accès.

## Stack

| | |
|---|---|
| Application | Next.js 16 (App Router, Server Actions), TypeScript strict, Tailwind CSS 4 |
| Données | PostgreSQL, Prisma |
| Validation | Zod aux frontières (formulaires, entrées externes) |
| Tests | Vitest (58 fichiers de tests) et 5 parcours Playwright de bout en bout, un par rôle |
| Qualité | ESLint, Husky, commits conventionnels, intégration continue GitHub Actions |

## Lancer le projet

```bash
cp .env.example .env         # renseigner DATABASE_URL (PostgreSQL)
npm ci
npm run db:migrate
npm run db:seed              # données de démonstration
npm run dev
```

`npm run lint`, `npm run type-check`, `npm test` et `npm run test:e2e`.
