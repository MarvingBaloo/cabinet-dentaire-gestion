import { notFound } from 'next/navigation'

import { EcranChat } from '@/components/features/chat/ecran-chat'

export const metadata = { title: 'Chat' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export default async function PageConversation({ params }: { params: Promise<{ collegueId: string }> }) {
  const { collegueId } = await params
  if (!UUID.test(collegueId)) notFound()
  return <EcranChat collegueId={collegueId} />
}
