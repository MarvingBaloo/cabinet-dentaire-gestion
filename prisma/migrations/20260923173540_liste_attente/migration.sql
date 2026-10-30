-- CreateEnum
CREATE TYPE "StatutEnvoiListeAttente" AS ENUM ('EN_ATTENTE', 'ENVOYE', 'ABANDONNE');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'LISTE_ATTENTE_NOTIFIEE';

-- CreateTable
CREATE TABLE "inscription_liste_attente" (
    "id" UUID NOT NULL,
    "telephone" TEXT NOT NULL,
    "motif_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "praticien_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inscription_liste_attente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envoi_liste_attente" (
    "id" UUID NOT NULL,
    "inscription_id" UUID NOT NULL,
    "creneau_debut" TIMESTAMPTZ NOT NULL,
    "creneau_fin" TIMESTAMPTZ NOT NULL,
    "praticien_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "motif_id" UUID NOT NULL,
    "statut" "StatutEnvoiListeAttente" NOT NULL DEFAULT 'EN_ATTENTE',
    "planifie_pour" TIMESTAMPTZ,
    "envoye_le" TIMESTAMPTZ,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "envoi_liste_attente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inscription_liste_attente_motif_id_site_id_praticien_id_idx" ON "inscription_liste_attente"("motif_id", "site_id", "praticien_id");

-- CreateIndex
CREATE INDEX "inscription_liste_attente_telephone_idx" ON "inscription_liste_attente"("telephone");

-- CreateIndex
CREATE INDEX "inscription_liste_attente_expires_at_idx" ON "inscription_liste_attente"("expires_at");

-- CreateIndex
CREATE INDEX "envoi_liste_attente_praticien_id_creneau_debut_creneau_fin_idx" ON "envoi_liste_attente"("praticien_id", "creneau_debut", "creneau_fin");

-- CreateIndex
CREATE INDEX "envoi_liste_attente_statut_planifie_pour_idx" ON "envoi_liste_attente"("statut", "planifie_pour");

-- AddForeignKey
ALTER TABLE "inscription_liste_attente" ADD CONSTRAINT "inscription_liste_attente_motif_id_fkey" FOREIGN KEY ("motif_id") REFERENCES "motif_consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscription_liste_attente" ADD CONSTRAINT "inscription_liste_attente_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscription_liste_attente" ADD CONSTRAINT "inscription_liste_attente_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envoi_liste_attente" ADD CONSTRAINT "envoi_liste_attente_inscription_id_fkey" FOREIGN KEY ("inscription_id") REFERENCES "inscription_liste_attente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
