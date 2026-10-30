// Fabrication du fichier .ics remis au patient après sa réservation.
//
// Module neutre, ni `'use client'` ni `server-only` : le fichier est construit
// dans le navigateur, à partir de ce que le patient a déjà sous les yeux. C'est
// délibéré — une route qui rendrait un .ics à partir d'un identifiant de
// rendez-vous serait une lecture publique d'un rendez-vous, ce que le portail
// s'interdit (D19, et le README de queries/public/).
//
// Aucune horloge lue ici : l'horodatage et l'identifiant arrivent en paramètre,
// ce qui rend la fonction pure et vérifiable au caractère près.

export type EvenementIcs = {
  debut: Date
  fin: Date
  titre: string
  /** `null` tant que le cabinet n'a pas donné l'adresse de ses sites. */
  lieu: string | null
  description?: string
  /** Doit être unique. Ne JAMAIS y mettre l'identifiant du rendez-vous. */
  uid: string
  horodatage: Date
}

/** `20270405T133000Z` — la seule forme qu'acceptent tous les agendas. */
function instantUtc(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

/**
 * Échappement imposé par la RFC 5545 : sans lui, une adresse contenant une
 * virgule casse le fichier et l'agenda refuse l'import sans rien expliquer.
 * L'ordre compte — la barre oblique d'abord, sinon on échappe ses propres ajouts.
 */
function echapper(texte: string): string {
  return texte
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Replie les lignes de plus de 75 octets, continuation préfixée d'une espace.
 * La limite est en OCTETS et non en caractères : « Marie-Galante » compte treize
 * caractères mais un accent en vaut deux, et couper au milieu d'un caractère
 * produit un fichier illisible.
 */
function plier(ligne: string): string {
  // `TextEncoder` et non `Buffer` : ce code tourne dans le navigateur du
  // patient, où `Buffer` n'existe pas — l'erreur ne surviendrait qu'au clic.
  const taille = (s: string) => new TextEncoder().encode(s).length
  if (taille(ligne) <= 75) return ligne

  const morceaux: string[] = []
  let reste = ligne
  let limite = 75

  while (taille(reste) > limite) {
    let coupe = limite
    while (taille(reste.slice(0, coupe)) > limite) coupe -= 1
    morceaux.push(reste.slice(0, coupe))
    reste = reste.slice(coupe)
    limite = 74 // les suivantes portent une espace de continuation
  }
  morceaux.push(reste)

  return morceaux.join('\r\n ')
}

/**
 * Le fichier .ics complet, prêt à être téléchargé.
 *
 * Les séparateurs sont des CRLF et non des sauts de ligne simples : la RFC
 * l'exige, et certains agendas rejettent le fichier sans le dire.
 */
export function construireIcs(e: EvenementIcs): string {
  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cabinet dentaire//Rendez-vous//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${echapper(e.uid)}`,
    `DTSTAMP:${instantUtc(e.horodatage)}`,
    `DTSTART:${instantUtc(e.debut)}`,
    `DTEND:${instantUtc(e.fin)}`,
    `SUMMARY:${echapper(e.titre)}`,
    ...(e.lieu ? [`LOCATION:${echapper(e.lieu)}`] : []),
    ...(e.description ? [`DESCRIPTION:${echapper(e.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lignes.map(plier).join('\r\n') + '\r\n'
}

/** Nom de fichier proposé au téléchargement. Sans accent ni espace. */
export function nomFichierIcs(debut: Date): string {
  const jour = instantUtc(debut).slice(0, 8)
  return `rendez-vous-${jour}.ics`
}

/**
 * Un identifiant unique pour l'événement.
 *
 * ⚠ `crypto.randomUUID` n'existe QUE dans un contexte sécurisé. La démonstration
 * du NAS est servie en `http://` sur une adresse IP : `isSecureContext` y vaut
 * faux, la fonction est absente, et le bouton échouerait sans un mot dans la
 * console — au moment précis où l'on montre l'application.
 *
 * Un UID n'a besoin que d'être unique, pas imprévisible : il ne protège rien.
 */
export function identifiantEvenement(): string {
  const aleatoire =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

  return `${aleatoire}@cabinet-dentaire`
}
