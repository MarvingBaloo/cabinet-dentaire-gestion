-- CreateTable
CREATE TABLE "reservation_publique" (
    "id" UUID NOT NULL,
    "motif_id" UUID NOT NULL,
    "praticien_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "debut" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "envois" INTEGER NOT NULL DEFAULT 1,
    "rendez_vous_id" UUID,
    "ip_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_publique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservation_publique_rendez_vous_id_key" ON "reservation_publique"("rendez_vous_id");

-- CreateIndex
CREATE INDEX "reservation_publique_expires_at_idx" ON "reservation_publique"("expires_at");

-- CreateIndex
CREATE INDEX "reservation_publique_ip_address_created_at_idx" ON "reservation_publique"("ip_address", "created_at");

-- AddForeignKey
ALTER TABLE "reservation_publique" ADD CONSTRAINT "reservation_publique_motif_id_fkey" FOREIGN KEY ("motif_id") REFERENCES "motif_consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_publique" ADD CONSTRAINT "reservation_publique_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_publique" ADD CONSTRAINT "reservation_publique_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_publique" ADD CONSTRAINT "reservation_publique_rendez_vous_id_fkey" FOREIGN KEY ("rendez_vous_id") REFERENCES "rendez_vous"("id") ON DELETE SET NULL ON UPDATE CASCADE;
