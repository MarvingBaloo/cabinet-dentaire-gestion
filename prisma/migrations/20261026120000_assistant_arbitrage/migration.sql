-- Cinq niveaux au lieu de quatre (D79) : l'urgence « du jour » devient l'urgence forte (48 h), et l'urgence simple
-- (72 h) s'ajoute. Renommée plutôt que recréée : les conversations déjà classées gardent leur niveau.
ALTER TYPE "NiveauUrgence" RENAME VALUE 'URGENCE_JOUR' TO 'URGENCE_FORTE';
ALTER TYPE "NiveauUrgence" ADD VALUE 'URGENCE_SIMPLE' AFTER 'URGENCE_FORTE';

ALTER TABLE "conversation_assistant"
  ADD COLUMN "raison" TEXT,
  ADD COLUMN "creneaux_vus" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "contact_prenom" TEXT,
  ADD COLUMN "contact_nom" TEXT,
  ADD COLUMN "contact_telephone" TEXT,
  ADD COLUMN "demande_le" TIMESTAMP(3),
  ADD COLUMN "demande_traitee_le" TIMESTAMP(3);

CREATE INDEX "conversation_assistant_demande_le_demande_traitee_le_idx" ON "conversation_assistant"("demande_le", "demande_traitee_le");
