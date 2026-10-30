-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PREFERENCES_NOTIFICATION_MODIFIEES';

-- CreateTable
CREATE TABLE "preference_notification" (
    "id" UUID NOT NULL,
    "canal" "CanalNotification" NOT NULL,
    "destinataire" TEXT NOT NULL,
    "rappels" BOOLEAN NOT NULL DEFAULT true,
    "non_essentiels" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preference_notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "preference_notification_canal_destinataire_key" ON "preference_notification"("canal", "destinataire");
