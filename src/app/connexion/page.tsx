import { Lock } from 'lucide-react'

import { FormulaireConnexion } from '@/components/features/auth/formulaire-connexion'
import { Message } from '@/components/ui/message'

// Les motifs sont volontairement distincts : « expiré » et « déconnecté pour
// inactivité » ne disent pas la même chose à qui revient devant son poste.
const MOTIFS: Record<string, string> = {
  inactivite: 'Vous avez été déconnecté après une période d’inactivité.',
  expiree: 'Votre session a expiré. Reconnectez-vous.',
  revoquee: 'Votre session a été fermée.',
  session_perdue: 'Votre session n’a pas pu être retrouvée. Reprenez la connexion.',
  deconnecte: 'Vous êtes déconnecté.',
}

export default async function PageConnexion({ searchParams }: { searchParams: Promise<{ motif?: string }> }) {
  const { motif } = await searchParams
  const message = motif ? MOTIFS[motif] : undefined

  return (
    <>
      <div className="space-y-1">
        <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-extrabold tracking-tight text-foreground">
          Connexion
        </h1>
        <p className="text-sm text-muted-foreground">Accès réservé au personnel du cabinet.</p>
      </div>

      {message ? (
        <Message ton="info" role="status">
          {message}
        </Message>
      ) : null}

      <FormulaireConnexion />

      <p className="flex items-center gap-2.5 text-[0.8125rem] text-muted-foreground">
        <span className="hexagone grid h-[1.875rem] w-[1.625rem] shrink-0 place-items-center bg-[#e4f1ee] text-[#387a70]">
          <Lock aria-hidden className="size-3.5" strokeWidth={1.8} />
        </span>
        Code par SMS sur tout nouvel appareil.
      </p>
    </>
  )
}
