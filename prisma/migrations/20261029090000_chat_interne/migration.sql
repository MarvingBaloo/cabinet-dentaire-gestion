-- Le chat interne (D82) : une conversation par paire de membres du personnel, ses messages (qui peuvent citer un
-- patient ou un rendez-vous), et le choix de chacun de couper le son.

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "chat_son_coupe" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "conversation_chat" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "dernier_message_le" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_chat" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "auteur_id" UUID NOT NULL,
    "texte" TEXT NOT NULL,
    "patient_id" UUID,
    "rendez_vous_id" UUID,
    "envoye_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lu_le" TIMESTAMPTZ,

    CONSTRAINT "message_chat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_chat_user_b_id_idx" ON "conversation_chat"("user_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_chat_user_a_id_user_b_id_key" ON "conversation_chat"("user_a_id", "user_b_id");

-- CreateIndex
CREATE INDEX "message_chat_conversation_id_envoye_le_idx" ON "message_chat"("conversation_id", "envoye_le");

-- CreateIndex
CREATE INDEX "message_chat_conversation_id_lu_le_idx" ON "message_chat"("conversation_id", "lu_le");

-- AddForeignKey
ALTER TABLE "conversation_chat" ADD CONSTRAINT "conversation_chat_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_chat" ADD CONSTRAINT "conversation_chat_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_chat" ADD CONSTRAINT "message_chat_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation_chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_chat" ADD CONSTRAINT "message_chat_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_chat" ADD CONSTRAINT "message_chat_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_chat" ADD CONSTRAINT "message_chat_rendez_vous_id_fkey" FOREIGN KEY ("rendez_vous_id") REFERENCES "rendez_vous"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bornes que Prisma ne sait pas dire : une paire rangée (une seule conversation entre deux personnes), et un message
-- qui dit quelque chose sans être un roman.
ALTER TABLE "conversation_chat" ADD CONSTRAINT "conversation_chat_paire_rangee" CHECK ("user_a_id" < "user_b_id");
ALTER TABLE "message_chat" ADD CONSTRAINT "message_chat_texte_borne" CHECK (char_length("texte") BETWEEN 1 AND 2000);

-- Chat en direct, comme l'agenda (D61) : chaque nouveau message, et chaque conversation lue, est signalé sur le canal
-- `chat` à la validation de la transaction. Le signal ne porte que des identifiants : le texte est relu côté serveur,
-- par qui a le droit de le lire. Un « lu » ne porte pas l'id du message : PostgreSQL fusionne les signaux identiques
-- d'une même transaction, et une conversation ouverte n'en envoie qu'un.
CREATE OR REPLACE FUNCTION notifier_chat() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  a UUID;
  b UUID;
BEGIN
  SELECT user_a_id, user_b_id INTO a, b FROM conversation_chat WHERE id = NEW.conversation_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify('chat', json_build_object(
      'op', 'message', 'conversation', NEW.conversation_id, 'auteur', NEW.auteur_id,
      'destinataire', CASE WHEN NEW.auteur_id = a THEN b ELSE a END)::text);
  ELSIF NEW.lu_le IS NOT NULL AND OLD.lu_le IS NULL THEN
    PERFORM pg_notify('chat', json_build_object(
      'op', 'lu', 'conversation', NEW.conversation_id,
      'lecteur', CASE WHEN NEW.auteur_id = a THEN b ELSE a END)::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER message_chat_notifier
AFTER INSERT OR UPDATE OF lu_le ON message_chat
FOR EACH ROW EXECUTE FUNCTION notifier_chat();
