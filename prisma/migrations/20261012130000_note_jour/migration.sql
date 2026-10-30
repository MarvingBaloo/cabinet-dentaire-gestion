-- CreateTable
CREATE TABLE "note_jour" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "jour" DATE NOT NULL,
    "texte" TEXT NOT NULL,
    "auteur_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_jour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_jour_site_id_jour_idx" ON "note_jour"("site_id", "jour");

-- AddForeignKey
ALTER TABLE "note_jour" ADD CONSTRAINT "note_jour_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_jour" ADD CONSTRAINT "note_jour_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

