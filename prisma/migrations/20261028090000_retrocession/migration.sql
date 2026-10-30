-- La rétrocession (D81) : prix des soins, part de chaque praticien, montant encaissé au passage en caisse, et
-- versements mensuels marqués par l'administrateur.
-- AlterTable
ALTER TABLE "motif_consultation" ADD COLUMN     "prix_centimes" INTEGER;

-- AlterTable
ALTER TABLE "praticien" ADD COLUMN     "part_retrocession" INTEGER;

-- AlterTable
ALTER TABLE "rendez_vous" ADD COLUMN     "encaisse_le" TIMESTAMPTZ,
ADD COLUMN     "montant_centimes" INTEGER;

-- CreateTable
CREATE TABLE "versement_retrocession" (
    "id" UUID NOT NULL,
    "praticien_id" UUID NOT NULL,
    "mois" TEXT NOT NULL,
    "montant_centimes" INTEGER NOT NULL,
    "verse_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verse_par_id" UUID NOT NULL,

    CONSTRAINT "versement_retrocession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "versement_retrocession_praticien_id_mois_key" ON "versement_retrocession"("praticien_id", "mois");

-- AddForeignKey
ALTER TABLE "versement_retrocession" ADD CONSTRAINT "versement_retrocession_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versement_retrocession" ADD CONSTRAINT "versement_retrocession_verse_par_id_fkey" FOREIGN KEY ("verse_par_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Bornes que Prisma ne sait pas dire : une part entre 0 et 100 %, aucun montant négatif.
ALTER TABLE "praticien" ADD CONSTRAINT "praticien_part_retrocession_bornee" CHECK ("part_retrocession" BETWEEN 0 AND 100);
ALTER TABLE "motif_consultation" ADD CONSTRAINT "motif_prix_positif" CHECK ("prix_centimes" >= 0);
ALTER TABLE "rendez_vous" ADD CONSTRAINT "rdv_montant_positif" CHECK ("montant_centimes" >= 0);
ALTER TABLE "versement_retrocession" ADD CONSTRAINT "versement_montant_positif" CHECK ("montant_centimes" >= 0);
