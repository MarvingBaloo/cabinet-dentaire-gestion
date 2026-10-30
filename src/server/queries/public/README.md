# Lectures publiques

Tout ce qui est ici est lisible **par n'importe qui, sans être connecté** : le
portail de réservation s'adresse à des patients qui n'ont pas de compte.

C'est l'unique exception à D4, qui veut que toute lecture passe par un contrôle
de droits. Elle est rangée à part précisément pour qu'elle se voie : une fonction
qui lirait un patient, un rendez-vous ou un compte n'aurait rien à faire dans ce
dossier, et ça saute aux yeux à la relecture.

## Ce qui peut être lu ici

Les cabinets (et leurs horaires d'ouverture, *déduits* des plages de présence
— jamais une valeur écrite en dur, voir D34), les praticiens, les motifs
proposés aux patients, et les créneaux libres. Rien d'autre.

## Ce qui ne doit JAMAIS y entrer

- un patient, ou quoi que ce soit qui permette de le reconnaître
- un rendez-vous existant — *qui* vient à 9h, et pour quoi
- un compte, un poste, le journal d'audit
- un numéro de téléphone, une adresse électronique

Un créneau **occupé** ne se distingue ici d'un créneau **fermé** que par son
absence : dans les deux cas il n'est pas proposé, et rien ne dit pourquoi.

## Limitation de débit

Ces fonctions ne se protègent pas elles-mêmes. C'est à leurs appelants — les
Server Actions du portail, ou la page elle-même pour une simple lecture — de
porter la limitation par adresse IP, sans quoi un robot peut balayer deux mois
de créneaux ou faire payer des SMS au cabinet.

`creneauxDisponibles` est protégée ainsi par `src/app/rendez-vous/page.tsx`, qui
appelle `tropDeLecturesPubliques` (`src/server/services/lecture-publique.ts`,
D25) avant de l'invoquer.
