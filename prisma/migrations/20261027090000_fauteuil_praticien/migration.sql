-- Le fauteuil d'un praticien est fixe, un par cabinet (Marving, 27/10). Repris de la semaine type existante : le
-- fauteuil le plus souvent tenu par le praticien dans ce cabinet.
CREATE TABLE "fauteuil_praticien" (
    "praticien_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "fauteuil_id" UUID NOT NULL,

    CONSTRAINT "fauteuil_praticien_pkey" PRIMARY KEY ("praticien_id","site_id")
);

ALTER TABLE "fauteuil_praticien" ADD CONSTRAINT "fauteuil_praticien_praticien_id_fkey" FOREIGN KEY ("praticien_id") REFERENCES "praticien"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fauteuil_praticien" ADD CONSTRAINT "fauteuil_praticien_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fauteuil_praticien" ADD CONSTRAINT "fauteuil_praticien_fauteuil_id_fkey" FOREIGN KEY ("fauteuil_id") REFERENCES "fauteuil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "fauteuil_praticien" ("praticien_id", "site_id", "fauteuil_id")
SELECT DISTINCT ON (praticien_id, site_id) praticien_id, site_id, fauteuil_id
FROM (
  SELECT praticien_id, site_id, fauteuil_id FROM "presence_hebdomadaire"
  UNION ALL
  SELECT praticien_id, site_id, fauteuil_id FROM "plage_presence"
) AS tenus
GROUP BY praticien_id, site_id, fauteuil_id
ORDER BY praticien_id, site_id, count(*) DESC, fauteuil_id;
