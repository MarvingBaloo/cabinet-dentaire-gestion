-- CreateEnum
CREATE TYPE "UsageAssistant" AS ENUM ('URGENCES', 'ANALYSE');

-- CreateEnum
CREATE TYPE "NiveauUrgence" AS ENUM ('VITALE', 'URGENCE_JOUR', 'DIFFERABLE', 'NON_URGENT');

-- CreateTable
CREATE TABLE "conversation_assistant" (
    "id" UUID NOT NULL,
    "usage" "UsageAssistant" NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "niveau" "NiveauUrgence",
    "resume" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "niveau_cabinet" "NiveauUrgence",
    "propositions" JSONB NOT NULL DEFAULT '[]',
    "rendez_vous_id" UUID,
    "ip_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_assistant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_assistant_rendez_vous_id_key" ON "conversation_assistant"("rendez_vous_id");

-- CreateIndex
CREATE INDEX "conversation_assistant_ip_address_created_at_idx" ON "conversation_assistant"("ip_address", "created_at");

-- CreateIndex
CREATE INDEX "conversation_assistant_created_at_idx" ON "conversation_assistant"("created_at");

-- AddForeignKey
ALTER TABLE "conversation_assistant" ADD CONSTRAINT "conversation_assistant_rendez_vous_id_fkey" FOREIGN KEY ("rendez_vous_id") REFERENCES "rendez_vous"("id") ON DELETE SET NULL ON UPDATE CASCADE;
