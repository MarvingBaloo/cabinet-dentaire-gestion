-- Agenda en direct (D61) : chaque ajout, déplacement, annulation ou changement
-- de statut d'un rendez-vous est signalé sur le canal `agenda`, quelle qu'en soit
-- l'origine — accueil, praticien, portail patient, réponse SMS, worker. Un
-- déclencheur plutôt qu'un appel dans chaque service : un chemin d'écriture
-- oublié laisserait un écran afficher un créneau libre qui ne l'est plus.
--
-- NOTIFY part à la validation de la transaction, jamais avant : un écran n'est
-- prévenu que d'un changement réellement écrit. Le message ne porte que des
-- identifiants ; le détail est relu côté serveur, sous le filtre de site (D5).

CREATE OR REPLACE FUNCTION notifier_agenda() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('agenda', json_build_object(
      'id', OLD.id, 'op', TG_OP, 'site', OLD.site_id, 'ancienSite', OLD.site_id,
      'statut', OLD.statut, 'ancienStatut', OLD.statut, 'deplace', false)::text);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT (
    NEW.debut IS DISTINCT FROM OLD.debut OR NEW.fin IS DISTINCT FROM OLD.fin
    OR NEW.statut IS DISTINCT FROM OLD.statut OR NEW.praticien_id IS DISTINCT FROM OLD.praticien_id
    OR NEW.fauteuil_id IS DISTINCT FROM OLD.fauteuil_id OR NEW.site_id IS DISTINCT FROM OLD.site_id
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_notify('agenda', json_build_object(
    'id', NEW.id,
    'op', TG_OP,
    'site', NEW.site_id,
    'ancienSite', CASE WHEN TG_OP = 'UPDATE' THEN OLD.site_id ELSE NEW.site_id END,
    'statut', NEW.statut,
    'ancienStatut', CASE WHEN TG_OP = 'UPDATE' THEN OLD.statut ELSE NULL END,
    'deplace', TG_OP = 'UPDATE' AND (NEW.debut IS DISTINCT FROM OLD.debut
      OR NEW.praticien_id IS DISTINCT FROM OLD.praticien_id OR NEW.site_id IS DISTINCT FROM OLD.site_id)
  )::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER rendez_vous_notifier_agenda
AFTER INSERT OR UPDATE OR DELETE ON rendez_vous
FOR EACH ROW EXECUTE FUNCTION notifier_agenda();
