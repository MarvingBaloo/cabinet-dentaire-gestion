-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'REPONSE_SMS_TRAITEE';
ALTER TYPE "AuditAction" ADD VALUE 'WEBHOOK_REFUSE';

-- CreateTable
CREATE TABLE "webhook_sms_entrant" (
    "id" UUID NOT NULL,
    "cle_idempotence" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_sms_entrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_sms_entrant_cle_idempotence_key" ON "webhook_sms_entrant"("cle_idempotence");
