-- CreateTable
CREATE TABLE "motif_patient" (
    "id" UUID NOT NULL,
    "libelle" TEXT NOT NULL,
    "aide" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "parent_id" UUID,
    "motif_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "motif_patient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "motif_patient_parent_id_ordre_idx" ON "motif_patient"("parent_id", "ordre");

-- AddForeignKey
ALTER TABLE "motif_patient" ADD CONSTRAINT "motif_patient_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "motif_patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motif_patient" ADD CONSTRAINT "motif_patient_motif_id_fkey" FOREIGN KEY ("motif_id") REFERENCES "motif_consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
