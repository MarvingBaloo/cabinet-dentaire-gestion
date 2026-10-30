#!/usr/bin/env bash
# Remet la base de TEST (cabinet_test) à neuf : supprimée, recréée, migrée, protégée (prisma/sql), référentiel
# semé. Pas de jeu de démonstration : les tests créent eux-mêmes ce dont ils ont besoin.
#
# Pourquoi : chaque passe de tests crée des comptes, des postes et des patients que le journal d'audit cite, et le
# journal ne se modifie pas — ils s'accumulent (6 657 comptes au 21/10, la page « Comptes » mettait des minutes à
# s'afficher dans les parcours). Une base neuve repart avec un journal vide sans qu'aucune ligne n'ait été touchée.
#
# Seule cible possible, écrite en dur : la base de travail, la démo, Neon et la prod sont hors d'atteinte.
# Aucune suite de tests ne doit tourner pendant ce temps (refus tant qu'une connexion est ouverte).
#
#   npm run db:remettre-a-neuf-test

set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env.local; set +a
: "${TEST_DIRECT_DATABASE_URL:?absent de .env.local}"

url="${TEST_DIRECT_DATABASE_URL%%\?*}"
if [[ "$url" != */cabinet_test ]]; then
  echo "Refus : TEST_DIRECT_DATABASE_URL ne vise pas cabinet_test (reçu : ${url##*/})." >&2
  exit 1
fi
serveur="${url%/cabinet_test}/postgres"

autres="$(psql "$serveur" -tAc "select count(*) from pg_stat_activity where datname = 'cabinet_test'")"
if [ "$autres" != "0" ]; then
  echo "Refus : $autres connexion(s) ouverte(s) sur cabinet_test. Attendre la fin des tests en cours." >&2
  exit 1
fi

echo "→ suppression et recréation de cabinet_test"
psql "$serveur" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE cabinet_test" -c "CREATE DATABASE cabinet_test"

echo "→ migrations"
DIRECT_DATABASE_URL="$TEST_DIRECT_DATABASE_URL" npx prisma migrate deploy

echo "→ privilèges, verrou d'audit, contraintes d'agenda"
psql "$TEST_DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -f prisma/sql/01_roles_grants.sql \
  -f prisma/sql/02_audit_append_only.sql \
  -f prisma/sql/03_agenda_contraintes.sql

echo "→ référentiel"
DIRECT_DATABASE_URL="$TEST_DIRECT_DATABASE_URL" npm run -s db:seed

echo "✓ cabinet_test remise à neuf"
