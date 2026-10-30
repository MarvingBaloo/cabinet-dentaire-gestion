-- D83 : la connexion validée depuis le téléphone, par QR code.
ALTER TABLE "workstation" ADD COLUMN "telephone" BOOLEAN NOT NULL DEFAULT false;

-- Les téléphones déjà déclarés se reconnaissent au navigateur de leurs sessions passées.
UPDATE "workstation" w SET "telephone" = true
WHERE EXISTS (
  SELECT 1 FROM "session" s
  WHERE s."workstation_id" = w."id" AND s."user_agent" ~* '(iPhone|iPod|Android.*Mobile)'
);

CREATE TABLE "validation_telephone" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "jeton_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "approuve_le" TIMESTAMP(3),
    "refuse_le" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_telephone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "validation_telephone_session_id_key" ON "validation_telephone"("session_id");
CREATE UNIQUE INDEX "validation_telephone_jeton_hash_key" ON "validation_telephone"("jeton_hash");

ALTER TABLE "validation_telephone" ADD CONSTRAINT "validation_telephone_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
