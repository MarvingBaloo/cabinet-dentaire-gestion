'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import { ChampErreur } from './champ-erreur'
import { Message } from '@/components/ui/message'
import { type EtatFormulaire, attendreTelephoneAction, passerAuSmsAction } from '@/server/actions/auth'
import type { EtatPoste } from '@/server/auth/telephone'

// Le poste attend le « Oui » du téléphone (D83) : il demande toutes les deux secondes où en est la connexion, et
// s'ouvre de lui-même dès que la personne a répondu.

export function ValidationTelephone({ qr, lien }: { qr: string; lien: string }) {
  const router = useRouter()
  const [etat, setEtat] = useState<EtatPoste>('attente')
  const [etatSms, passerAuSms, envoiEnCours] = useActionState<EtatFormulaire, FormData>(passerAuSmsAction, {})

  useEffect(() => {
    if (etat !== 'attente') return
    const minuterie = setInterval(async () => {
      const reponse = await attendreTelephoneAction()
      if (reponse.etat !== 'attente') setEtat(reponse.etat)
    }, 2000)
    return () => clearInterval(minuterie)
  }, [etat])

  if (etat === 'refuse') {
    return (
      <Message ton="erreur" role="alert">
        Connexion refusée depuis votre téléphone.{' '}
        <a href="/connexion" className="font-semibold underline underline-offset-4">
          Reprendre la connexion
        </a>
      </Message>
    )
  }

  return (
    <div className="space-y-5">
      {etat === 'expire' ? (
        <div className="space-y-3">
          <Message ton="alerte" role="status">
            Ce QR code a expiré.
          </Message>
          <button
            type="button"
            onClick={() => {
              setEtat('attente')
              router.refresh()
            }}
            className="lien-action h-10 bouton-principal px-4 text-sm font-semibold"
          >
            Afficher un nouveau QR code
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div
            role="img"
            aria-label="QR code de connexion"
            data-lien={lien}
            className="mx-auto w-56 rounded-2xl border border-border bg-white p-3 [&_svg]:size-full"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <p className="text-center text-sm text-muted-foreground" role="status">
            Votre téléphone vous demande « C’est bien vous ? » : touchez « Oui ». Ce poste s’ouvrira de lui-même.
          </p>
        </div>
      )}

      <form action={passerAuSms} className="space-y-2 border-t border-border pt-4">
        <ChampErreur id="erreur-sms" message={etatSms.erreur} />
        <button
          type="submit"
          disabled={envoiEnCours}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
        >
          {envoiEnCours ? 'Envoi…' : 'Pas de téléphone sous la main ? Recevoir plutôt un code par SMS'}
        </button>
      </form>
    </div>
  )
}
