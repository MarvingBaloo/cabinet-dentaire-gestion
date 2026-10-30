# Photographies — provisoires

**Charte du 20/10** : `salle-verte.jpg`, `salle-beige.jpg`, `salle-bleue.jpg` et `sterilisation.jpg`
ont été fournies par le client avec sa charte graphique. Ce sont des images de synthèse (Gemini,
marque recadrée), pas des photos du cabinet réel : même mise en garde que ci-dessous. Elles ont pris la
place de `hero.jpg`, `consultation.jpg`, `accueil-cabinet.jpg` et `salle-de-soins-2.jpg`, supprimées.
Nouveaux noms plutôt que fichiers écrasés : l'optimiseur d'images de Next.js garde en cache une image
sous son adresse, et un fichier remplacé sous le même nom continuait de s'afficher à l'ancienne.

Les autres images de ce dossier viennent d'Unsplash (licence Unsplash : usage
commercial libre, sans attribution obligatoire — voir le commentaire en tête
de `src/config/cabinet.ts`). **Aucune ne représente le cabinet réel, son
équipe ou ses patients** : à remplacer par de vraies photographies avant toute
mise en ligne. Changer de nom de fichier (et l'adresse dans `src/config/cabinet.ts`) : voir plus haut pour le cache.

⚠ Les URL Unsplash d'origine de chaque fichier n'ont pas été conservées par la
passe qui les a téléchargées : impossible de les faire figurer ici sans les
inventer. À reconstituer (recherche inversée d'image, ou nouveau
téléchargement) avant publication, pour respecter la mention de source par
fichier que ce README est censé porter.

| Fichier | Écran(s) | Ne représente pas |
|---|---|---|
| `salle-verte.jpg` | Accueil, galerie (grande photo) et soin « Prothèses dentaires » · carte Guadeloupe de « Nos deux cabinets » | une salle de soins réelle du cabinet |
| `salle-beige.jpg` | Accueil, section « Le cabinet » et galerie · page `/cabinets/marie-galante` | le cabinet de Marie-Galante réel |
| `salle-bleue.jpg` | Page `/cabinets/guadeloupe` · carte Marie-Galante de « Nos deux cabinets » · galerie | le cabinet de Guadeloupe réel |
| `secretariat.jpg` | Accueil, section « L'équipe » (secrétariat médical) · galerie de l'accueil | le secrétariat réel ni le personnel qui y travaille |
| `praticien.jpg` | Accueil, section « L'équipe » | le praticien réel du cabinet |
| `equipe.jpg` | Accueil, section « L'équipe » (assistant·e dentaire) | l'assistant(e) dentaire réel(le) |
| `radiographie.jpg` | Accueil, section « Nos soins » (soins conservateurs) | une radiographie d'un patient réel |
| `chirurgie.jpg` | Accueil, section « Nos soins » (chirurgie orale) | une intervention réelle |
| `chirurgie-2.jpg` | Accueil, section « Nos soins » (implantologie) | une intervention réelle |
| `sterilisation.jpg` | Accueil, galerie « Le cabinet au quotidien » | la salle de stérilisation réelle |
| `prevention.jpg` | Accueil, section « Conseils » (bloc feature) | un contrôle de prévention réel |
| `orthodontie.jpg` | Accueil, section « Nos soins » (orthodontie et esthétique) | un traitement réel |
