-- CreateTable
CREATE TABLE "trusted_workstation" (
    "userId" UUID NOT NULL,
    "workstationId" UUID NOT NULL,
    "trustedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_workstation_pkey" PRIMARY KEY ("userId","workstationId")
);

-- CreateIndex
CREATE INDEX "trusted_workstation_trustedUntil_idx" ON "trusted_workstation"("trustedUntil");

-- AddForeignKey
ALTER TABLE "trusted_workstation" ADD CONSTRAINT "trusted_workstation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_workstation" ADD CONSTRAINT "trusted_workstation_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
