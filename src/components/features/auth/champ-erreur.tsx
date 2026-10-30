import { Message } from '@/components/ui/message'

// `role="alert"` : le lecteur d'écran annonce le message dès son apparition,
// sans que l'utilisateur ait à repartir en exploration. Sans ça, une personne
// non voyante ne saurait pas pourquoi le formulaire n'a pas abouti (RGAA AA).
export function ChampErreur({ id, message }: { id: string; message?: string | undefined }) {
  if (!message) return null

  return (
    <Message ton="erreur" role="alert" id={id}>
      {message}
    </Message>
  )
}
