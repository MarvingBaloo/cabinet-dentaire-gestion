#!/usr/bin/env bash
# Prépare les bases de DÉVELOPPEMENT (NAS) : privilèges, verrou d'audit,
# contraintes d'agenda, mot de passe du rôle applicatif.
#
# Idempotent — relançable après chaque migration, et c'est même obligatoire :
# Prisma ne connaît ni les GRANT ni les triggers. `GRANT ON ALL TABLES` est de
# surcroît un instantané : il ne couvre pas les tables créées après lui.
#
# LES TROIS BASES SONT TRAITÉES : travail, test et démo — les deux dernières
# quand leur variable est définie. `cabinet_test` était auparavant laissée de
# côté, et l'oubli ne se voyait qu'au premier test échouant sur un « permission
# denied » pour une table toute neuve. `cabinet_demo` a été oubliée de la même
# façon. Un script qui traite une base sur deux finit toujours par en oublier
# une.
#
# ⚠ En production HDS, le mot de passe de cabinet_app vient du gestionnaire de
# secrets de l'hébergeur. L'ALTER ROLE ci-dessous est une commodité de
# développement, pas un modèle à reproduire.

set -euo pipefail
cd "$(dirname "$0")/.."

# .env.local en développement ; en intégration continue, les variables sont déjà
# dans l'environnement et le fichier n'existe pas.
if [ -f ./.env.local ]; then
  set -a; . ./.env.local; set +a
fi

: "${DIRECT_DATABASE_URL:?absent de .env.local}"
: "${CABINET_APP_PASSWORD:?absent de .env.local}"

appliquer() {
  local url="$1" etiquette="$2"
  echo "→ $etiquette : privilèges, verrou d'audit, contraintes d'agenda"
  psql "$url" -v ON_ERROR_STOP=1 -q \
    -f prisma/sql/01_roles_grants.sql \
    -f prisma/sql/02_audit_append_only.sql \
    -f prisma/sql/03_agenda_contraintes.sql
}

appliquer "$DIRECT_DATABASE_URL" "base de travail"

# La base de test suit le même traitement. Absente en intégration continue si la
# variable n'est pas définie : on ne s'arrête pas pour autant.
if [ -n "${TEST_DIRECT_DATABASE_URL:-}" ]; then
  appliquer "$TEST_DIRECT_DATABASE_URL" "base de test"
else
  echo "→ base de test : TEST_DIRECT_DATABASE_URL absente, ignorée"
fi

# cabinet_demo est peuplée par `npm run seed-demo` et servie par la démo du
# NAS : sans ce traitement une table neuve y reste inaccessible au rôle
# applicatif.
if [ -n "${DEMO_DIRECT_DATABASE_URL:-}" ]; then
  appliquer "$DEMO_DIRECT_DATABASE_URL" "base de démonstration"
else
  echo "→ base de démonstration : DEMO_DIRECT_DATABASE_URL absente, ignorée"
fi

echo "→ mot de passe du rôle applicatif"
# Par l'entrée standard et non -c : psql n'interpole pas les variables dans -c.
# :'pw' fait quoter le littéral par psql — le mot de passe n'est jamais
# concaténé dans la requête, donc pas d'injection possible.
psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -v pw="$CABINET_APP_PASSWORD" <<< "ALTER ROLE cabinet_app PASSWORD :'pw';"

echo "✓ bases prêtes"
