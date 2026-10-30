#!/usr/bin/env bash
# Remet la base de TRAVAIL (cabinet_dentaire) à neuf : la base est supprimée puis
# recréée, migrée, protégée (prisma/sql), et peuplée du même jeu que la démo.
#
# Pourquoi supprimer la base plutôt que ses lignes : le journal d'audit est
# append-only et cite les postes, les comptes et les patients créés par les essais.
# Rien de ce qu'il cite ne peut être effacé sans lever sa protection ; une base
# neuve repart avec un journal vide sans qu'aucune ligne n'ait été touchée.
#
# Serveur de développement arrêté d'abord : la commande refuse tant qu'une autre
# connexion est ouverte sur la base.
#
#   npm run db:remettre-a-neuf

set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env.local; set +a
: "${DIRECT_DATABASE_URL:?absent de .env.local}"
: "${CABINET_APP_PASSWORD:?absent de .env.local}"

url="${DIRECT_DATABASE_URL%%\?*}"
# Seule cible possible. Écrite en dur : la démo, Neon et la prod sont hors d'atteinte.
if [[ "$url" != */cabinet_dentaire ]]; then
  echo "Refus : DIRECT_DATABASE_URL ne vise pas cabinet_dentaire (reçu : ${url##*/})." >&2
  exit 1
fi
serveur="${url%/cabinet_dentaire}/postgres"

autres="$(psql "$serveur" -tAc "select count(*) from pg_stat_activity where datname = 'cabinet_dentaire'")"
if [ "$autres" != "0" ]; then
  echo "Refus : $autres connexion(s) ouverte(s) sur cabinet_dentaire. Arrêter le serveur de développement et le worker." >&2
  exit 1
fi

echo "→ suppression et recréation de cabinet_dentaire"
psql "$serveur" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE cabinet_dentaire" -c "CREATE DATABASE cabinet_dentaire"

echo "→ migrations"
npx prisma migrate deploy

echo "→ privilèges, verrou d'audit, contraintes d'agenda"
psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -f prisma/sql/01_roles_grants.sql \
  -f prisma/sql/02_audit_append_only.sql \
  -f prisma/sql/03_agenda_contraintes.sql
psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -v pw="$CABINET_APP_PASSWORD" <<< "ALTER ROLE cabinet_app PASSWORD :'pw';"

echo "→ référentiel"
npm run -s db:seed

echo "→ jeu de démonstration"
DEMO_DATABASE_URL="$DIRECT_DATABASE_URL" npm run -s seed-demo

echo "✓ cabinet_dentaire remise à neuf"
