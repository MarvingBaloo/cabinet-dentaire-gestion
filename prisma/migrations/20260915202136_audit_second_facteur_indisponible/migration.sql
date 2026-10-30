-- Deux corrections révélées par les tests.
--
-- 1. Un échec d'envoi du second facteur n'est PAS un échec d'authentification.
--    Il était journalisé en LOGIN_FAILURE, que la limitation par IP compte. Le
--    cabinet entier sortant sur une seule adresse publique, une panne du
--    fournisseur de SMS y bloquait l'accès de tout le personnel après vingt
--    tentatives — une panne externe convertie en panne totale.
--
-- 2. Le compteur d'envois par session ne comptait pas : un renvoi met la ligne
--    à jour plutôt que d'en créer une, et la limite horaire restait lettre morte.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SECOND_FACTEUR_INDISPONIBLE';

ALTER TABLE "code_sms" ADD COLUMN "envois" INTEGER NOT NULL DEFAULT 1;
