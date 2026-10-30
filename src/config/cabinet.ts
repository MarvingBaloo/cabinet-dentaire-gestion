/**
 * Contenu public du cabinet, affiché sur le site vitrine.
 *
 * Tout ce que le cabinet n'a pas encore fourni vaut `null`, jamais une chaîne
 * inventée : TypeScript force alors chaque écran à traiter le cas, et la page
 * affiche « à renseigner » au lieu d'un faux numéro qu'on croirait vrai.
 * Renseigner un champ ici suffit à l'allumer partout.
 *
 * PHOTOS — voir `public/images/cabinet/README.md` : les salles et la stérilisation
 * viennent de la charte du client (20/10), les autres sont des provisoires
 * d'Unsplash. Aucune ne montre le cabinet réel. À remplacer par les vraies photos
 * avant toute mise en ligne, sous de nouveaux noms (cache des images, voir le README).
 */

export type SiteVitrine = {
  /** Doit rester aligné sur le libellé court du modèle `Site` semé en base. */
  nom: string
  image: string
  telephone: string | null
}

export const CABINET = {
  nom: 'Cabinet dentaire',
  /** Le nom de la charte graphique reçue le 20/10 (logo « MG Cabinet dentaire »). */
  nomCommercial: 'MG Cabinet dentaire' as string | null,
  accroche: 'Votre sourire, entre de bonnes mains.',
  baseline: 'Réservez en ligne, de jour comme de nuit : un code par SMS suffit, sans compte à créer.',
  presentation:
    'Un cabinet, deux lieux de consultation. Notre équipe vous accueille dans un cadre calme et vous accompagne à chaque étape de votre parcours de soin, du contrôle annuel aux traitements les plus techniques.',
  telephone: null as string | null,
  email: null as string | null,
} as const

export const EQUIPE = [
  {
    role: 'Assistant(e) dentaire',
    image: '/images/cabinet/equipe.jpg',
    texte:
      'Présente à chaque soin, elle prépare le fauteuil, assiste le praticien et veille à la stérilisation de l’ensemble des instruments.',
  },
  {
    role: 'Secrétariat médical',
    image: '/images/cabinet/secretariat.jpg',
    texte:
      'Le secrétariat gère vos rendez-vous, votre dossier administratif et vos échanges avec le praticien.',
  },
] as const

/**
 * Marie-Galante d'abord : c'est le site principal (3 fauteuils, six jours sur sept).
 * La Guadeloupe n'ouvre que le vendredi, avec un fauteuil.
 */
export const SITES: SiteVitrine[] = [
  { nom: 'Marie-Galante', image: '/images/cabinet/salle-bleue.jpg', telephone: null },
  { nom: 'Guadeloupe', image: '/images/cabinet/salle-verte.jpg', telephone: null },
]

export const SOINS = [
  {
    titre: 'Soins conservateurs',
    image: '/images/cabinet/radiographie.jpg',
    description: 'Traitement des caries, soins de la dent vivante, dévitalisation et restauration de la dent abîmée.',
  },
  {
    titre: 'Prothèses dentaires',
    image: '/images/cabinet/salle-verte.jpg',
    description: 'Couronnes, bridges et appareils amovibles, conçus pour vous rendre le confort de mastication.',
  },
  {
    titre: 'Chirurgie orale',
    image: '/images/cabinet/chirurgie.jpg',
    description: 'Extractions, dents de sagesse et interventions réalisées au cabinet sous anesthésie locale.',
  },
  {
    titre: 'Implantologie',
    image: '/images/cabinet/chirurgie-2.jpg',
    description:
      'Remplacement d’une ou plusieurs dents absentes par un implant, après examen complet de l’os et des gencives.',
  },
  {
    titre: 'Prévention et hygiène',
    image: '/images/cabinet/prevention.jpg',
    description: 'Détartrage, scellement de sillons et conseils d’hygiène adaptés à chaque âge de la vie.',
  },
  {
    titre: 'Orthodontie et esthétique',
    image: '/images/cabinet/orthodontie.jpg',
    description:
      'Gouttières, alignement et restaurations esthétiques, toujours après contrôle de la santé de vos dents.',
  },
] as const

/** Dans l'ordre de la grille de la maquette : la grande photo, puis les quatre petites. */
export const GALERIE = [
  {
    src: '/images/cabinet/salle-verte.jpg',
    legende: 'Consultation',
    alt: 'Le praticien commentant un examen avec une patiente',
  },
  {
    src: '/images/cabinet/salle-bleue.jpg',
    legende: 'Salle de soins',
    alt: 'Le fauteuil et le plan de travail d’une salle de soins',
  },
  { src: '/images/cabinet/secretariat.jpg', legende: 'Accueil', alt: 'Le secrétariat du cabinet' },
  {
    src: '/images/cabinet/sterilisation.jpg',
    legende: 'Stérilisation',
    alt: 'La salle de stérilisation et ses autoclaves',
  },
  {
    src: '/images/cabinet/salle-beige.jpg',
    legende: 'Marie-Galante',
    alt: 'La salle de soins de Marie-Galante et sa vue extérieure',
  },
] as const

/** Photos provisoires des praticiens, dans l'ordre où le site les affiche. */
export const PHOTOS_PRATICIENS = ['/images/cabinet/praticien.jpg', '/images/cabinet/chirurgie-2.jpg'] as const

export const CONSEILS = [
  {
    titre: 'Après une extraction',
    texte:
      'Mordez la compresse pendant deux heures, évitez de rincer le jour même, et préférez une alimentation tiède et molle pendant quarante-huit heures.',
  },
  {
    titre: 'Avant une intervention',
    texte:
      'Mangez normalement avant votre rendez-vous, sauf indication contraire, et signalez-nous tout traitement en cours, en particulier les anticoagulants.',
  },
  {
    titre: 'Au quotidien',
    texte:
      'Deux brossages de deux minutes par jour, un fil ou une brossette interdentaire chaque soir, et un contrôle au cabinet une fois par an.',
  },
] as const

export const URGENCES = {
  intitule: 'Une urgence dentaire ?',
  texte:
    'Douleur vive, traumatisme, dent cassée ou gonflement : appelez le cabinet aux heures d’ouverture. Des créneaux sont réservés chaque jour aux urgences.',
  horsHoraires:
    'En dehors des heures d’ouverture, composez le 15 (SAMU) ou rendez-vous au service d’urgences le plus proche.',
} as const
