import Link from 'next/link'

import { EnTetePage } from '@/components/ui/en-tete-page'
import { Message } from '@/components/ui/message'

/**
 * Ce que voit, à la place de l'écran, quelqu'un dont le rôle n'y donne pas
 * accès : le refus reste tracé par la DAL (`requirePermission`), la page ne
 * fait que l'expliquer au lieu de tomber en erreur.
 */
export function AccesReserve({
  titre,
  message = 'Cet écran est réservé à l’administrateur du cabinet.',
}: {
  titre: string
  message?: string
}) {
  return (
    <div className="max-w-2xl space-y-6">
      <EnTetePage titre={titre} />
      <Message ton="info" role="status">
        {message}
      </Message>
      <Link href="/tableau-de-bord" className="text-sm text-primary underline-offset-4 hover:underline">
        ← Retour à l’accueil
      </Link>
    </div>
  )
}
