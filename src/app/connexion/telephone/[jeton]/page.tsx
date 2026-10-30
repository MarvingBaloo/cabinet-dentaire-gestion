import { RepondreTelephone } from '@/components/features/auth/repondre-telephone'
import { Message } from '@/components/ui/message'
import { lireOrigine } from '@/server/auth/session-courante'
import { decrireDemande } from '@/server/auth/telephone'

// Ce que le téléphone ouvre en visant le QR d'un poste (D83). Seul un téléphone de confiance pour la personne qui
// se connecte voit son nom et peut répondre ; un autre n'apprend rien.

export const metadata = { title: 'Connexion depuis votre téléphone' }

export default async function PageTelephone({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params
  const demande = await decrireDemande(jeton, (await lireOrigine()).workstationId ?? null)

  return (
    <>
      <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-bold text-foreground">
        Connexion sur un poste
      </h1>
      {demande.etat === 'perimee' ? (
        <Message ton="alerte">
          Ce QR code n’est plus valable. Sur le poste, affichez-en un nouveau puis visez-le de nouveau.
        </Message>
      ) : demande.etat === 'non_reconnu' ? (
        <Message ton="erreur">
          Ce téléphone n’est pas reconnu pour ce compte. Connectez-vous une première fois au logiciel sur ce téléphone,
          avec le code reçu par SMS ; ensuite il pourra valider vos connexions. En attendant, demandez un code par SMS
          sur le poste.
        </Message>
      ) : (
        <RepondreTelephone
          jeton={jeton}
          personne={`${demande.prenom} ${demande.nom}`}
          poste={demande.site ? `${demande.poste} — ${demande.site}` : demande.poste}
        />
      )}
    </>
  )
}
