-- Séparation des privilèges PostgreSQL.
--
-- Il n'y a plus d'isolation multi-locataires à assurer (décision D3 : mono-cabinet).
-- Ce fichier ne garde que ce qui reste utile sans elle : le principe du moindre
-- privilège pour le rôle applicatif.
--
-- POURQUOI DEUX RÔLES quand même :
--   - une injection SQL réussie ne doit pas pouvoir modifier le schéma ni supprimer
--     une table ;
--   - le journal d'audit ne doit pas être modifiable par l'application, et un REVOKE
--     n'a de sens que si l'application n'est pas propriétaire de la table.
--
-- À APPLIQUER EN FIN DE LA PREMIÈRE MIGRATION PRISMA.
--   - le propriétaire (DIRECT_DATABASE_URL) : migrations uniquement, jamais l'application
--   - le rôle applicatif (DATABASE_URL)     : aucun droit DDL

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cabinet_app') THEN
    CREATE ROLE cabinet_app LOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cabinet_app;

-- Droits accordés en BLOC puis restreints, et non table par table.
--
-- Énumérer les tables paraissait plus explicite, mais toute table ajoutée par une
-- migration était alors oubliée : c'est arrivé avec `trusted_workstation`, dont
-- l'absence de droits n'apparaissait qu'à l'exécution. Le sens de l'oubli compte :
-- oublier d'ACCORDER casse bruyamment, oublier de RESTREINDRE ouvre en silence.
-- On préfère donc l'erreur qui se voit.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cabinet_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cabinet_app;

-- Référentiel de droits : lecture seule. Le rendre modifiable en exécution
-- ouvrirait l'escalade de privilèges — se donner une permission qu'on n'a pas.
REVOKE INSERT, UPDATE, DELETE ON role, permission, role_permission FROM cabinet_app;

-- Historique des migrations : l'application n'a rien à y faire.
REVOKE INSERT, UPDATE, DELETE ON "_prisma_migrations" FROM cabinet_app;

-- Le journal d'audit s'écrit et se lit, ne se modifie jamais.
-- UPDATE/DELETE sont retirés dans 02_audit_append_only.sql.

-- ─── Vérification ────────────────────────────────────────────────────────────
--
-- Doit renvoyer zéro ligne : le rôle applicatif ne doit posséder aucune table.
-- Un `prisma migrate` lancé par erreur avec DATABASE_URL rendrait cabinet_app
-- propriétaire, et tous les REVOKE de 02 deviendraient sans effet.
--
--   SELECT c.relname
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   JOIN pg_roles r ON r.oid = c.relowner
--   WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'cabinet_app';
--
-- Et l'inverse : aucune table ne doit être inaccessible au rôle applicatif.
-- Doit renvoyer zéro ligne, sinon une migration a ajouté une table sans que ce
-- fichier ait été rejoué.
--
--   SELECT c.relname
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--     AND NOT has_table_privilege('cabinet_app', c.oid, 'SELECT');
