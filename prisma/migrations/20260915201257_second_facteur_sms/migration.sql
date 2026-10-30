-- Second facteur par SMS : le code arrive au lieu d'être cherché (D7, révisée).
--
-- ⚠ PERTE DE DONNÉES ASSUMÉE. `mfa_secret` disparaît : les secrets TOTP n'ont
-- plus d'usage une fois le mécanisme remplacé, et les conserver reviendrait à
-- garder en base un secret d'authentification que plus rien ne lit.
--
-- CONSÉQUENCE À CONNAÎTRE : tout compte existant se retrouve sans numéro de
-- mobile, donc sans second facteur possible. Il faudra renseigner un numéro
-- avant que ces comptes puissent se reconnecter. Sans objet ici — aucune
-- installation en service — mais ce serait une coupure en production.

ALTER TABLE "app_user" DROP COLUMN "mfa_secret";
ALTER TABLE "app_user" ADD COLUMN "telephone_mobile" TEXT;

-- Code à usage unique, lié à UNE session de connexion et non au compte : deux
-- connexions entamées en parallèle ne doivent pas s'invalider l'une l'autre.
CREATE TABLE "code_sms" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_sms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "code_sms_session_id_key" ON "code_sms"("session_id");
CREATE INDEX "code_sms_expires_at_idx" ON "code_sms"("expires_at");

-- Cascade : le code n'a aucun sens sans sa session, et une session révoquée ne
-- doit pas laisser derrière elle un code encore valable.
ALTER TABLE "code_sms" ADD CONSTRAINT "code_sms_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
