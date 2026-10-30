-- CreateEnum
CREATE TYPE "CanalNotification" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "TypeNotification" AS ENUM ('CONFIRMATION_RESERVATION', 'MODIFICATION_RENDEZ_VOUS', 'ANNULATION_PATIENT', 'ANNULATION_CABINET', 'RAPPEL_J2', 'RAPPEL_H3', 'CRENEAU_LIBERE', 'REPONSE_SMS');

-- CreateEnum
CREATE TYPE "StatutNotification" AS ENUM ('A_ENVOYER', 'EN_COURS', 'ENVOYEE', 'ECHEC', 'ABANDONNEE', 'INCERTAINE');

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "type" "TypeNotification" NOT NULL,
    "canal" "CanalNotification" NOT NULL,
    "cle_idempotence" TEXT NOT NULL,
    "destinataire" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "sujet" TEXT,
    "rendez_vous_id" UUID,
    "rendez_vous_debut" TIMESTAMPTZ,
    "envoi_liste_attente_id" UUID,
    "site_id" UUID,
    "planifie_pour" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statut" "StatutNotification" NOT NULL DEFAULT 'A_ENVOYER',
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "pris_le" TIMESTAMPTZ,
    "fournisseur" TEXT,
    "reference_fournisseur" TEXT,
    "credits_utilises" DOUBLE PRECISION,
    "derniere_erreur" TEXT,
    "envoyee_le" TIMESTAMPTZ,
    "attend_reponse" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_cle_idempotence_key" ON "notification"("cle_idempotence");

-- CreateIndex
CREATE UNIQUE INDEX "notification_envoi_liste_attente_id_key" ON "notification"("envoi_liste_attente_id");

-- CreateIndex
CREATE INDEX "notification_statut_planifie_pour_idx" ON "notification"("statut", "planifie_pour");

-- CreateIndex
CREATE INDEX "notification_rendez_vous_id_idx" ON "notification"("rendez_vous_id");

-- CreateIndex
CREATE INDEX "notification_reference_fournisseur_idx" ON "notification"("reference_fournisseur");

-- CreateIndex
CREATE INDEX "notification_destinataire_envoyee_le_idx" ON "notification"("destinataire", "envoyee_le");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_rendez_vous_id_fkey" FOREIGN KEY ("rendez_vous_id") REFERENCES "rendez_vous"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_envoi_liste_attente_id_fkey" FOREIGN KEY ("envoi_liste_attente_id") REFERENCES "envoi_liste_attente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
