import { ListeBloques } from '@/components/features/patients/liste-bloques'
import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { exigerContexte } from '@/server/auth/session-courante'
import { SEUIL_MANQUEMENTS } from '@/server/domaine/agenda'
import { patientsBloques } from '@/server/queries/patients'

// Q27 : trois rendez-vous annulés ou non honorés ferment la réservation en ligne,
// « jusqu'à déblocage par un administrateur ». Sans cet écran, la première partie
// de la règle s'appliquerait sans la seconde — un patient bloqué le resterait.

export const metadata = { title: 'Réservation en ligne bloquée' }

export default async function PagePatientsBloques() {
  const ctx = await exigerContexte()
  const patients = await patientsBloques(ctx)

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Réservation en ligne bloquée"
        chiffres={[
          {
            valeur: patients.length,
            libelle: patients.length > 1 ? 'patients bloqués' : 'patient bloqué',
            alerte: true,
            cible: 'bloque',
          },
          { valeur: SEUIL_MANQUEMENTS, libelle: 'manquements avant blocage' },
        ]}
      >
        Trois rendez-vous annulés ou non honorés ferment la réservation en ligne. Le blocage ne vise que le site : au
        comptoir et au téléphone, le rendez-vous reste possible. Débloquer remet le compteur à zéro.
      </BandeauReglages>

      <ListeBloques patients={patients} peutDebloquer={ctx.permissions.has('patient:debloquer')} />
    </div>
  )
}
