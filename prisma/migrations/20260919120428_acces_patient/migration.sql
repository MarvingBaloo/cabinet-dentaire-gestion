-- CreateTable
CREATE TABLE "acces_patient" (
    "id" UUID NOT NULL,
    "telephone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "envois" INTEGER NOT NULL DEFAULT 1,
    "jeton_hash" TEXT,
    "fenetre_expire" TIMESTAMP(3),
    "ip_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acces_patient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acces_patient_jeton_hash_key" ON "acces_patient"("jeton_hash");

-- CreateIndex
CREATE INDEX "acces_patient_expires_at_idx" ON "acces_patient"("expires_at");

-- CreateIndex
CREATE INDEX "acces_patient_ip_address_created_at_idx" ON "acces_patient"("ip_address", "created_at");

-- CreateIndex
CREATE INDEX "acces_patient_telephone_created_at_idx" ON "acces_patient"("telephone", "created_at");
