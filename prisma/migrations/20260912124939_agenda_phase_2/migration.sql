-- CreateEnum
CREATE TYPE "StatutRendezVous" AS ENUM ('A_CONFIRMER', 'CONFIRME', 'SALLE_ATTENTE', 'AU_FAUTEUIL', 'TERMINE', 'EN_CAISSE', 'ABSENT', 'ANNULE');

-- CreateEnum
CREATE TYPE "TypeIndisponibilite" AS ENUM ('CONGE', 'FERIE', 'PAUSE', 'RESERVE_URGENCE', 'AUTRE');

-- CreateTable
CREATE TABLE "praticien" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "titre" TEXT NOT NULL DEFAULT 'Chirurgien-dentiste',
    "couleur" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "praticien_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fauteuil" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "fauteuil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plage_presence" (
    "id" UUID NOT NULL,
    "praticien_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "fauteuil_id" UUID NOT NULL,
    "debut" TIMESTAMPTZ NOT NULL,
    "fin" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plage_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motif_consultation" (
    "id" UUID NOT NULL,
    "libelle" TEXT NOT NULL,
    "duree_indicative" INTEGER NOT NULL,
    "couleur" TEXT NOT NULL,
    "est_urgence" BOOLEAN NOT NULL DEFAULT false,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "motif_consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "praticien_motif" (
    "praticien_id" UUID NOT NULL,
    "motif_id" UUID NOT NULL,
    "duree_minutes" INTEGER NOT NULL,

    CONSTRAINT "praticien_motif_pkey" PRIMARY KEY ("praticien_id","motif_id")
);

-- CreateTable
CREATE TABLE "patient" (
    "id" UUID NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "date_naissance" DATE,
    "telephone" TEXT NOT NULL,
    "email" TEXT,
    "profil_complet" BOOLEAN NOT NULL DEFAULT false,
    "representant_legal" TEXT,
    "telephone_representant" TEXT,
    "manquements" INTEGER NOT NULL DEFAULT 0,
    "reservation_bloquee" BOOLEAN NOT NULL DEFAULT false,
    "debloque_le" TIMESTAMP(3),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rendez_vous" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "praticien_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "fauteuil_id" UUID NOT NULL,
    "motif_id" UUID NOT NULL,
    "debut" TIMESTAMPTZ NOT NULL,
    "fin" TIMESTAMPTZ NOT NULL,
    "statut" "StatutRendezVous" NOT NULL DEFAULT 'A_CONFIRMER',
    "hors_horaire" BOOLEAN NOT NULL DEFAULT false,
    "surbooking" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rendez_vous_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indisponibilite" (
    "id" UUID NOT NULL,
    "type" "TypeIndisponibilite" NOT NULL,
    "praticien_id" UUID,
    "site_id" UUID,
    "debut" TIMESTAMPTZ NOT NULL,
    "fin" TIMESTAMPTZ NOT NULL,
    "motif" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indisponibilite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "praticien_user_id_key" ON "praticien"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fauteuil_site_id_nom_key" ON "fauteuil"("site_id", "nom");

-- CreateIndex
CREATE INDEX "plage_presence_site_id_debut_idx" ON "plage_presence"("site_id", "debut");

-- CreateIndex
CREATE INDEX "plage_presence_praticien_id_debut_idx" ON "plage_presence"("praticien_id", "debut");

-- CreateIndex
CREATE UNIQUE INDEX "motif_consultation_libelle_key" ON "motif_consultation"("libelle");

-- CreateIndex
CREATE INDEX "patient_nom_prenom_date_naissance_idx" ON "patient"("nom", "prenom", "date_naissance");

-- CreateIndex
CREATE INDEX "rendez_vous_site_id_debut_idx" ON "rendez_vous"("site_id", "debut");

-- CreateIndex
CREATE INDEX "rendez_vous_praticien_id_debut_idx" ON "rendez_vous"("praticien_id", "debut");

-- CreateIndex
CREATE INDEX "rendez_vous_fauteuil_id_debut_idx" ON "rendez_vous"("fauteuil_id", "debut");

-- CreateIndex
CREATE INDEX "rendez_vous_patient_id_idx" ON "rendez_vous"("patient_id");

-- CreateIndex
CREATE INDEX "indisponibilite_site_id_debut_idx" ON "indisponibilite"("site_id", "debut");

-- CreateIndex
CREATE INDEX "indisponibilite_praticien_id_debut_idx" ON "indisponibilite"("praticien_id", "debut");

-- AddForeignKey
ALTER TABLE "praticien" ADD CONSTRAINT "praticien_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fauteuil" ADD CONSTRAINT "fauteuil_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plage_presence" ADD CONSTRAINT "plage_presence_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plage_presence" ADD CONSTRAINT "plage_presence_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plage_presence" ADD CONSTRAINT "plage_presence_fauteuil_id_fkey" FOREIGN KEY ("fauteuil_id") REFERENCES "fauteuil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "praticien_motif" ADD CONSTRAINT "praticien_motif_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "praticien_motif" ADD CONSTRAINT "praticien_motif_motif_id_fkey" FOREIGN KEY ("motif_id") REFERENCES "motif_consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rendez_vous" ADD CONSTRAINT "rendez_vous_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rendez_vous" ADD CONSTRAINT "rendez_vous_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rendez_vous" ADD CONSTRAINT "rendez_vous_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rendez_vous" ADD CONSTRAINT "rendez_vous_fauteuil_id_fkey" FOREIGN KEY ("fauteuil_id") REFERENCES "fauteuil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rendez_vous" ADD CONSTRAINT "rendez_vous_motif_id_fkey" FOREIGN KEY ("motif_id") REFERENCES "motif_consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indisponibilite" ADD CONSTRAINT "indisponibilite_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indisponibilite" ADD CONSTRAINT "indisponibilite_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
