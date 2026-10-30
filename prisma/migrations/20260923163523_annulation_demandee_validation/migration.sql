-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ANNULATION_DEMANDEE';
ALTER TYPE "AuditAction" ADD VALUE 'ANNULATION_VALIDEE';
ALTER TYPE "AuditAction" ADD VALUE 'ANNULATION_REFUSEE';

-- AlterEnum
ALTER TYPE "StatutRendezVous" ADD VALUE 'ANNULATION_DEMANDEE';

-- AlterTable
ALTER TABLE "rendez_vous" ADD COLUMN     "annulation_demandee_le" TIMESTAMPTZ,
ADD COLUMN     "annulation_demandee_par_id" UUID,
ADD COLUMN     "statut_avant_annulation" "StatutRendezVous";

-- CreateIndex
CREATE INDEX "rendez_vous_praticien_id_statut_idx" ON "rendez_vous"("praticien_id", "statut");

-- AddForeignKey
ALTER TABLE "rendez_vous" ADD CONSTRAINT "rendez_vous_annulation_demandee_par_id_fkey" FOREIGN KEY ("annulation_demandee_par_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
