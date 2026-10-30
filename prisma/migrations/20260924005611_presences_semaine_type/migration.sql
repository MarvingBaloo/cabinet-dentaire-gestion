-- CreateEnum
CREATE TYPE "TypeExceptionPresence" AS ENUM ('RETRAIT', 'AJOUT_OU_MODIFICATION');

-- CreateTable
CREATE TABLE "presence_hebdomadaire" (
    "id" UUID NOT NULL,
    "praticien_id" UUID NOT NULL,
    "jour_semaine" INTEGER NOT NULL,
    "site_id" UUID NOT NULL,
    "fauteuil_id" UUID NOT NULL,
    "heure_debut" INTEGER NOT NULL,
    "heure_fin" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presence_hebdomadaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exception_presence" (
    "id" UUID NOT NULL,
    "praticien_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "TypeExceptionPresence" NOT NULL,
    "site_id" UUID,
    "fauteuil_id" UUID,
    "heure_debut" INTEGER,
    "heure_fin" INTEGER,
    "motif" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exception_presence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "presence_hebdomadaire_praticien_id_jour_semaine_key" ON "presence_hebdomadaire"("praticien_id", "jour_semaine");

-- CreateIndex
CREATE UNIQUE INDEX "exception_presence_praticien_id_date_key" ON "exception_presence"("praticien_id", "date");

-- AddForeignKey
ALTER TABLE "presence_hebdomadaire" ADD CONSTRAINT "presence_hebdomadaire_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence_hebdomadaire" ADD CONSTRAINT "presence_hebdomadaire_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence_hebdomadaire" ADD CONSTRAINT "presence_hebdomadaire_fauteuil_id_fkey" FOREIGN KEY ("fauteuil_id") REFERENCES "fauteuil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_presence" ADD CONSTRAINT "exception_presence_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_presence" ADD CONSTRAINT "exception_presence_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_presence" ADD CONSTRAINT "exception_presence_fauteuil_id_fkey" FOREIGN KEY ("fauteuil_id") REFERENCES "fauteuil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
