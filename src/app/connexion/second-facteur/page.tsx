import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import QRCode from 'qrcode'

import { FormulaireSecondFacteur } from '@/components/features/auth/formulaire-second-facteur'
import { ValidationTelephone } from '@/components/features/auth/validation-telephone'
import { lireSession } from '@/server/auth/session-courante'
import { modeSecondFacteur, preparerValidation } from '@/server/auth/telephone'

export default async function PageSecondFacteur() {
  const session = await lireSession()

  // Un accès direct à cette page sans première étape ne doit pas afficher un
  // formulaire qui ne mènerait nulle part.
  if (session.etat === 'valide') redirect('/tableau-de-bord')
  if (session.etat !== 'mfa_requis') redirect('/connexion?motif=session_perdue')

  const parTelephone = (await modeSecondFacteur(session.sessionId)) === 'telephone'
  let qr = ''
  let lien = ''
  if (parTelephone) {
    // L'adresse que le navigateur a demandée : le téléphone rejoint la même démo, le même cabinet.
    const h = await headers()
    const hote = h.get('x-forwarded-host') ?? h.get('host')
    const protocole = h.get('x-forwarded-proto') ?? 'http'
    lien = `${protocole}://${hote}/connexion/telephone/${await preparerValidation(session.sessionId)}`
    qr = await QRCode.toString(lien, { type: 'svg', margin: 1, color: { dark: '#24332f', light: '#ffffff' } })
  }

  return (
    <>
      <div className="space-y-1">
        <Link href="/connexion" className="mb-4 inline-block text-sm text-primary underline-offset-4 hover:underline">
          ← Connexion
        </Link>
        <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-bold text-foreground">
          Vérification en deux étapes
        </h1>
        <p className="text-sm text-muted-foreground">
          {parTelephone
            ? 'Visez ce QR code avec l’appareil photo de votre téléphone.'
            : 'Un code vient de vous être envoyé par SMS.'}
        </p>
      </div>

      {parTelephone ? <ValidationTelephone qr={qr} lien={lien} /> : <FormulaireSecondFacteur />}
    </>
  )
}
