-- CreateTable
CREATE TABLE "modele_message" (
    "id" UUID NOT NULL,
    "type" "TypeNotification" NOT NULL,
    "canal" "CanalNotification" NOT NULL,
    "sujet" TEXT,
    "corps" TEXT NOT NULL,
    "modifie_par_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modele_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modele_message_type_canal_key" ON "modele_message"("type", "canal");

-- AddForeignKey
ALTER TABLE "modele_message" ADD CONSTRAINT "modele_message_modifie_par_id_fkey" FOREIGN KEY ("modifie_par_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
