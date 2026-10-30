import { ModelesMessages } from '@/components/features/notifications/modeles-messages'
import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { AccesReserve } from '@/components/ui/acces-reserve'
import { TYPES_MODELISABLES, modeleParDefaut } from '@/lib/modeles-messages'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { listerModelesMessages } from '@/server/services/modeles-messages'

// Ce que les patients reçoivent par SMS (et, au lot 5b, par e-mail), réglé par
// le cabinet lui-même — sans cet écran, corriger une formulation demanderait
// une intervention sur le code (même raison d'être que `/tableau-de-bord/motifs`,
// D14).
//
// La permission (`notifications:modeles`) est vérifiée DANS la DAL
// (`listerModelesMessages`), pas ici (D4). Son refus — secrétaire ou assistante
// qui tape l'adresse — est traduit en message au lieu d'une page d'erreur.

export const metadata = { title: 'Modèles de messages' }

export default async function PageModelesMessages() {
  const ctx = await exigerContexte()

  let lignes: Awaited<ReturnType<typeof listerModelesMessages>>
  try {
    lignes = await listerModelesMessages(ctx)
  } catch (e) {
    if (e instanceof PermissionDeniedError) return <AccesReserve titre="Modèles de messages" />
    throw e
  }

  // Même règle que la liste des événements : « modifié » se juge sur le texte, pas sur la présence d'une ligne.
  const modifies = new Set(
    lignes
      .filter((l) => {
        const defaut = modeleParDefaut(l.type, l.canal)
        return l.corps.trim() !== defaut.corps || (l.sujet ?? null) !== defaut.sujet
      })
      .map((l) => l.type),
  ).size

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Modèles de messages"
        chiffres={[
          { valeur: TYPES_MODELISABLES.length, libelle: 'modèles', cible: 'modele' },
          { valeur: modifies, libelle: modifies > 1 ? 'modifiés' : 'modifié', cible: 'modifie' },
        ]}
      >
        Les textes envoyés aux patients pour chaque événement (confirmation, rappel, annulation, liste d’attente). Un
        texte non modifié reste le texte d’origine du logiciel ; « Revenir au texte par défaut » l’efface pour y revenir
        à tout moment.
      </BandeauReglages>

      <ModelesMessages
        lignes={lignes.map((l) => ({
          type: l.type,
          canal: l.canal,
          sujet: l.sujet,
          corps: l.corps,
          parDefaut: l.parDefaut,
          modifieLe: l.modifieLe ? l.modifieLe.toISOString() : null,
        }))}
      />
    </div>
  )
}
