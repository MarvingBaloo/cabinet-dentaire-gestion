-- AlterTable
ALTER TABLE "site" ALTER COLUMN "adresse" DROP NOT NULL;

-- Les deux sites ont été semés avec le texte « À renseigner », qui n'était pas
-- un marqueur interne : il s'affichait au patient sur le portail et serait parti
-- dans le fichier .ics de son agenda. On le ramène à NULL, valeur que les écrans
-- savent désormais traiter. Le seed ne le referait pas : il n'écrase jamais une
-- adresse déjà saisie.
UPDATE "site" SET "adresse" = NULL WHERE "adresse" = 'À renseigner';
