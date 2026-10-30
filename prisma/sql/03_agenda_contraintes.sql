-- Règles d'agenda tenues par la base, et pas seulement par le code.
--
-- POURQUOI ICI. Trois chemins écriront des rendez-vous : l'agenda interne, le
-- portail public et la resynchronisation hors ligne (D11). Une règle portée par
-- la couche applicative n'existe que sur celui où on a pensé à l'appeler. La
-- double réservation, elle, ne se manifeste jamais en développement et toujours
-- en production (D12).
--
-- POURQUOI PAS DANS LE SCHÉMA PRISMA. Prisma ne sait exprimer ni une contrainte
-- d'exclusion, ni un index sur une expression. Comme le reste du SQL de sécurité,
-- ces objets vivent donc ici et sont rejoués après CHAQUE migration : une
-- migration seule laisse les tables en place et la protection absente.
--
-- IDEMPOTENT — relançable sans effet de bord.

-- Requis par les contraintes d'exclusion : un index GiST doit pouvoir porter à la
-- fois un uuid (opérateur =) et une plage temporelle (opérateur &&).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Règle 3 — un fauteuil n'accueille pas deux rendez-vous qui se chevauchent ──
--
-- Bornes `[)` : un rendez-vous 9h00-9h30 et un 9h30-10h00 ne se chevauchent pas.
-- Sans ce choix, aucune journée ne pourrait s'enchaîner.
--
-- Les rendez-vous ANNULE et ABSENT sont exclus : un créneau annulé se réutilise.
-- Le surbooking aussi — c'est l'urgence que le praticien glisse par-dessus un
-- planning plein (Q19), la seule exception admise, et elle est tracée.
--
-- ⚠ ANNULATION_DEMANDEE n'est PAS exclu, et c'est voulu (D17, retournée le
-- 2026-09-23) : une demande de l'accueil, en attente du praticien concerné,
-- occupe encore le créneau — elle peut être refusée et rendre le rendez-vous
-- intact. Ne rien ajouter ici pour ce statut sans revérifier `OCCUPE` dans
-- src/server/services/agenda.ts et src/server/queries/public/creneaux.ts, qui
-- portent la même règle côté applicatif.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rdv_fauteuil_sans_chevauchement'
  ) THEN
    ALTER TABLE rendez_vous ADD CONSTRAINT rdv_fauteuil_sans_chevauchement
      EXCLUDE USING gist (
        fauteuil_id WITH =,
        tstzrange(debut, fin, '[)') WITH &&
      ) WHERE (statut NOT IN ('ANNULE', 'ABSENT') AND NOT surbooking);
  END IF;
END
$$;

-- ── Règle 4 — un praticien n'a pas deux rendez-vous qui se chevauchent ────────
--
-- Distincte de la précédente : deux fauteuils du même site pourraient accueillir
-- le même praticien au même instant sans que la contrainte fauteuil ne bronche.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rdv_praticien_sans_chevauchement'
  ) THEN
    ALTER TABLE rendez_vous ADD CONSTRAINT rdv_praticien_sans_chevauchement
      EXCLUDE USING gist (
        praticien_id WITH =,
        tstzrange(debut, fin, '[)') WITH &&
      ) WHERE (statut NOT IN ('ANNULE', 'ABSENT') AND NOT surbooking);
  END IF;
END
$$;

-- ── Un fauteuil n'accueille pas deux praticiens en même temps ────────────────
--
-- Porte sur les plages de présence, pas sur les rendez-vous : c'est l'affectation
-- qui doit être cohérente. Sans elle, deux praticiens pourraient être déclarés au
-- même fauteuil et leurs rendez-vous passeraient les contraintes ci-dessus, chacun
-- étant valide de son côté.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plage_fauteuil_sans_chevauchement'
  ) THEN
    ALTER TABLE plage_presence ADD CONSTRAINT plage_fauteuil_sans_chevauchement
      EXCLUDE USING gist (
        fauteuil_id WITH =,
        tstzrange(debut, fin, '[)') WITH &&
      );
  END IF;
END
$$;

-- ── Règle 1 — un praticien sur un seul site par jour ─────────────────────────
--
-- Les horaires de bateau entre Grand-Bourg et Pointe-à-Pitre l'imposent : 6h et
-- 16h au départ de Marie-Galante, 8h et 17h au départ de la Guadeloupe. Tenir les
-- deux sites dans la même journée est matériellement impossible (Q1).
--
-- La date est calculée en heure de Guadeloupe et non en UTC : les dates sont
-- stockées en UTC (D10), et une plage du 12 à 7h30 locale tombe le 12 à 11h30 UTC.
-- Sans la conversion, une présence tard le soir basculerait au lendemain UTC et la
-- règle laisserait passer deux sites le même jour réel.
--
-- POURQUOI UN TRIGGER ET NON UN INDEX. Un index unique sur (praticien, jour, site)
-- n'interdirait rien : deux sites produisent deux clés distinctes, donc aucune
-- collision. Et l'interdiction ne peut pas porter sur (praticien, jour) seul, car
-- deux plages le même jour sur le MÊME site sont légitimes — matin et après-midi.
-- Ce qu'on veut refuser, c'est la présence d'un second site ; cela demande de
-- regarder les autres lignes, donc un trigger.
CREATE OR REPLACE FUNCTION plage_un_seul_site_par_jour()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  jour_local date := (NEW.debut AT TIME ZONE 'America/Guadeloupe')::date;
  autre_site uuid;
BEGIN
  SELECT p.site_id INTO autre_site
  FROM plage_presence p
  WHERE p.praticien_id = NEW.praticien_id
    AND p.id IS DISTINCT FROM NEW.id
    AND (p.debut AT TIME ZONE 'America/Guadeloupe')::date = jour_local
    AND p.site_id <> NEW.site_id
  LIMIT 1;

  IF autre_site IS NOT NULL THEN
    RAISE EXCEPTION
      'Un praticien ne peut pas être présent sur deux sites le même jour (%).', jour_local
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_plage_un_seul_site_par_jour ON plage_presence;
CREATE TRIGGER trg_plage_un_seul_site_par_jour
  BEFORE INSERT OR UPDATE ON plage_presence
  FOR EACH ROW EXECUTE FUNCTION plage_un_seul_site_par_jour();

-- ── Cohérences élémentaires ──────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rdv_fin_apres_debut') THEN
    ALTER TABLE rendez_vous ADD CONSTRAINT rdv_fin_apres_debut CHECK (fin > debut);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plage_fin_apres_debut') THEN
    ALTER TABLE plage_presence ADD CONSTRAINT plage_fin_apres_debut CHECK (fin > debut);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'indispo_fin_apres_debut') THEN
    ALTER TABLE indisponibilite ADD CONSTRAINT indispo_fin_apres_debut CHECK (fin > debut);
  END IF;
  -- Une indisponibilité vise un praticien OU un site, jamais ni l'un ni l'autre.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'indispo_porte_sur_quelque_chose') THEN
    ALTER TABLE indisponibilite ADD CONSTRAINT indispo_porte_sur_quelque_chose
      CHECK (praticien_id IS NOT NULL OR site_id IS NOT NULL);
  END IF;
  -- La durée d'un acte est strictement positive.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'praticien_motif_duree_positive') THEN
    ALTER TABLE praticien_motif ADD CONSTRAINT praticien_motif_duree_positive
      CHECK (duree_minutes > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'motif_duree_indicative_positive') THEN
    ALTER TABLE motif_consultation ADD CONSTRAINT motif_duree_indicative_positive
      CHECK (duree_indicative > 0);
  END IF;
END
$$;

-- ── Motifs patient : deux niveaux, pas trois ────────────────────────────────
--
-- Une entrée est SOIT un menu qui porte des sous-entrées, SOIT un choix final.
-- Un troisième niveau ferait un portail où le patient clique trois fois avant de
-- voir une date, et le code qui l'affiche suppose deux niveaux.
--
-- POURQUOI UN TRIGGER. La profondeur ne se lit pas sur la ligne insérée mais sur
-- son parent : il faut regarder une autre ligne, ce qu'un CHECK ne peut pas
-- faire. Le `parent_id <> id`, lui, tient dans un CHECK.

ALTER TABLE motif_patient
  DROP CONSTRAINT IF EXISTS motif_patient_pas_son_propre_parent;
ALTER TABLE motif_patient
  ADD CONSTRAINT motif_patient_pas_son_propre_parent
  CHECK (parent_id IS DISTINCT FROM id);

CREATE OR REPLACE FUNCTION motif_patient_deux_niveaux()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grand_parent uuid;
  a_des_enfants boolean;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT m.parent_id INTO grand_parent
    FROM motif_patient m
    WHERE m.id = NEW.parent_id;

    IF grand_parent IS NOT NULL THEN
      RAISE EXCEPTION
        'Les motifs patient ne comptent que deux niveaux : cette entrée en ferait un troisième.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT EXISTS (SELECT 1 FROM motif_patient e WHERE e.parent_id = NEW.id)
      INTO a_des_enfants;

    IF a_des_enfants THEN
      RAISE EXCEPTION
        'Une entrée qui porte des sous-entrées ne peut pas devenir elle-même une sous-entrée.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_motif_patient_deux_niveaux ON motif_patient;
CREATE TRIGGER trg_motif_patient_deux_niveaux
  BEFORE INSERT OR UPDATE ON motif_patient
  FOR EACH ROW EXECUTE FUNCTION motif_patient_deux_niveaux();

-- ── Présences (compléments d'agenda, lot 1) : cohérence des exceptions ───────
--
-- `ExceptionPresence` a deux formes selon son `type` (Prisma ne sait pas
-- exprimer une contrainte conditionnelle entre colonnes) :
--   RETRAIT               → site, fauteuil et heures NULS (rien à préciser :
--                            l'absence de présence ne se décrit pas plus).
--   AJOUT_OU_MODIFICATION → les quatre renseignés, et la fin après le début.
-- Un enregistrement qui ne respecte ni l'un ni l'autre est un bug applicatif,
-- pas une saisie du cabinet à admettre.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exception_presence_coherente') THEN
    ALTER TABLE exception_presence ADD CONSTRAINT exception_presence_coherente
      CHECK (
        (type = 'RETRAIT' AND site_id IS NULL AND fauteuil_id IS NULL AND heure_debut IS NULL AND heure_fin IS NULL)
        OR
        (type = 'AJOUT_OU_MODIFICATION' AND site_id IS NOT NULL AND fauteuil_id IS NOT NULL
          AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL AND heure_fin > heure_debut)
      );
  END IF;
  -- Bornes larges (0-1440) : `heure_fin` peut valoir minuit pile, jamais au-delà.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'presence_hebdo_heures_coherentes') THEN
    ALTER TABLE presence_hebdomadaire ADD CONSTRAINT presence_hebdo_heures_coherentes
      CHECK (heure_debut >= 0 AND heure_fin <= 1440 AND heure_fin > heure_debut);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'presence_hebdo_jour_valide') THEN
    ALTER TABLE presence_hebdomadaire ADD CONSTRAINT presence_hebdo_jour_valide
      CHECK (jour_semaine BETWEEN 1 AND 7);
  END IF;
  -- Pause du midi (18/10) : les deux bornes ensemble, ou aucune ; strictement à
  -- l'intérieur de la journée, sans quoi l'une des deux plages serait vide.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'presence_hebdo_pause_coherente') THEN
    ALTER TABLE presence_hebdomadaire ADD CONSTRAINT presence_hebdo_pause_coherente
      CHECK (
        (pause_debut IS NULL AND pause_fin IS NULL)
        OR (pause_debut IS NOT NULL AND pause_fin IS NOT NULL
            AND heure_debut < pause_debut AND pause_debut < pause_fin AND pause_fin < heure_fin)
      );
  END IF;
END
$$;

-- Une note du jour tient en 1 à 280 caractères, espaces de bord exclus : une note
-- blanche ne doit pas exister, quel que soit l'écran qui l'écrit.
ALTER TABLE note_jour DROP CONSTRAINT IF EXISTS note_jour_texte_longueur;
ALTER TABLE note_jour ADD CONSTRAINT note_jour_texte_longueur
  CHECK (char_length(btrim(texte)) BETWEEN 1 AND 280);

-- ── Requête de contrôle ──────────────────────────────────────────────────────
-- À rejouer après chaque migration. Doit renvoyer 13 lignes : onze contraintes et
-- deux triggers. Un décompte inférieur signifie qu'une migration a recréé une
-- table sans que ce fichier ait été rejoué — le schéma est là, la règle non.
SELECT 'contrainte' AS genre, conname AS nom
FROM pg_constraint
WHERE conname IN (
  'motif_patient_pas_son_propre_parent',
  'rdv_fauteuil_sans_chevauchement',
  'rdv_praticien_sans_chevauchement',
  'plage_fauteuil_sans_chevauchement',
  'rdv_fin_apres_debut',
  'plage_fin_apres_debut',
  'indispo_fin_apres_debut',
  'exception_presence_coherente',
  'presence_hebdo_heures_coherentes',
  'presence_hebdo_jour_valide',
  'presence_hebdo_pause_coherente',
  'note_jour_texte_longueur'
)
UNION ALL
SELECT 'trigger', tgname
FROM pg_trigger
WHERE tgname IN ('trg_plage_un_seul_site_par_jour', 'trg_motif_patient_deux_niveaux')
ORDER BY genre, nom;
