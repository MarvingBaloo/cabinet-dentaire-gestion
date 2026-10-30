'use client'

import { useFormStatus } from 'react-dom'

import { Button } from '@/components/ui/button'

// `disabled` pendant l'envoi : sans lui, un double clic déclenche deux
// tentatives de connexion, donc deux entrées d'audit et deux incréments du
// compteur d'échecs. `aria-busy` porte la même information aux lecteurs d'écran.
export function BoutonEnvoi({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="w-full">
      {pending ? 'Veuillez patienter…' : children}
    </Button>
  )
}
