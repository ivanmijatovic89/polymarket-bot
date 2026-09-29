import { notFound } from 'next/navigation'
import { MarketSimulatorView } from '@/components/simulator/MarketSimulatorView'
export default async function SimulatorPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>
}) {
  const { id, slug } = await params
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1 || !/^[a-zA-Z0-9_-]{1,255}$/.test(slug))
    notFound()
  return <MarketSimulatorView runId={Number(id)} slug={slug} />
}
