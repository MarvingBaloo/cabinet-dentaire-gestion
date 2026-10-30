-- Journal d'audit : append-only garanti par la base.
--
-- POURQUOI PAS SEULEMENT DU CODE : « append-only » assuré par l'absence de
-- `deleteMany` dans le dépôt est une convention, pas une garantie. Elle tombe au
-- premier script de maintenance, à la première correction en urgence, ou devant
-- un juge qui demande ce qui empêchait techniquement l'effacement. Un journal
-- qu'un administrateur peut réécrire n'a aucune valeur probante — or c'est sa
-- seule raison d'être.
--
-- À APPLIQUER APRÈS 01_roles_grants.sql.

-- ─── Retrait des droits de modification ──────────────────────────────────────

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM cabinet_app;

-- ─── Verrou de dernier recours ───────────────────────────────────────────────
--
-- Le REVOKE ci-dessus protège du rôle applicatif. Le déclencheur protège aussi du
-- propriétaire de la table — donc d'une migration mal écrite ou d'une session psql
-- ouverte à la hâte. La purge légitime (rétention) passe par purge_audit_log(),
-- seule voie qui lève le verrou, et seulement pour les lignes échues.

CREATE OR REPLACE FUNCTION audit_log_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log est append-only : modification interdite (id=%)', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.audit_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'audit_log est append-only : suppression hors purge interdite (id=%)', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_protect();

-- ─── Purge de rétention ──────────────────────────────────────────────────────
--
-- Le droit à l'effacement du RGPD ne s'applique pas au journal d'audit : la
-- traçabilité des accès aux données de santé est une obligation légale
-- (art. 17.3.b). Ce qui s'applique, c'est une DURÉE DE CONSERVATION — d'où cette
-- purge plutôt qu'une suppression à la demande.
--
-- ⚠ La durée n'est PAS fixée ici. Elle est passée en paramètre par la tâche
-- planifiée, depuis AUDIT_RETENTION_MONTHS. La valeur de 36 mois retenue par
-- défaut est un PLACEHOLDER, à confirmer par le DPO avant la mise en production.
-- Voir ARCHITECTURE.md (D9).
--
-- SECURITY DEFINER : la fonction s'exécute avec les droits de son propriétaire,
-- ce qui lui permet de supprimer là où l'appelant ne le peut pas. Le search_path
-- est figé — sans ça, un appelant pourrait détourner la résolution des noms et
-- faire exécuter son propre code avec les droits du propriétaire.

CREATE OR REPLACE FUNCTION purge_audit_log(retention_months int) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  deleted bigint;
BEGIN
  -- Garde-fou : un paramètre à 0 viderait le journal en entier. La borne basse
  -- est délibérément grossière — elle arrête l'accident, pas la décision.
  IF retention_months IS NULL OR retention_months < 12 THEN
    RAISE EXCEPTION 'purge_audit_log : rétention de % mois refusée (minimum 12)', retention_months
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.audit_purge', 'on', true);

  WITH echues AS (
    DELETE FROM audit_log
    WHERE occurred_at < now() - make_interval(months => retention_months)
    RETURNING 1
  )
  SELECT count(*) INTO deleted FROM echues;

  RETURN deleted;
END
$$;

-- La purge est une tâche planifiée, pas une action de l'application.
REVOKE EXECUTE ON FUNCTION purge_audit_log(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION purge_audit_log(int) FROM cabinet_app;

-- ─── Vérification ────────────────────────────────────────────────────────────
--
-- Ces deux commandes, lancées avec le rôle cabinet_app, DOIVENT échouer.
-- Un test d'intégration les rejoue : c'est la seule preuve que la protection tient.
--
--   UPDATE audit_log SET action = 'READ' WHERE id = (SELECT min(id) FROM audit_log);
--   DELETE FROM audit_log WHERE id = (SELECT min(id) FROM audit_log);
