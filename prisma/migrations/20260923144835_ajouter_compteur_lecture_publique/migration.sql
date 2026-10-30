-- CreateTable
CREATE TABLE "compteur_lecture_publique" (
    "id" UUID NOT NULL,
    "ip_address" TEXT NOT NULL,
    "fenetre" TIMESTAMP(3) NOT NULL,
    "nombre" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "compteur_lecture_publique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compteur_lecture_publique_ip_address_fenetre_key" ON "compteur_lecture_publique"("ip_address", "fenetre");
