import { permanentRedirect } from 'next/navigation'

// Ancienne adresse de l'espace patient (avant le 19/10), gardée pour les liens
// déjà partagés : l'espace sert aussi à déplacer, pas seulement à annuler.
export default function AncienneAdresse() {
  permanentRedirect('/mes-rendez-vous')
}
