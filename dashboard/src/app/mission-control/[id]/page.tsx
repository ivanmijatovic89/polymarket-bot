import { MissionRunView } from '@/components/MissionRunView'

export default async function MissionRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MissionRunView runId={id} />
}
