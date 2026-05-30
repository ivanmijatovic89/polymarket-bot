import { BatchDetailView } from '@/components/BatchDetailView'

export const dynamic = 'force-dynamic'

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ batchUid: string }>
}) {
  const { batchUid } = await params
  return (
    <div className="max-w-[1600px]">
      <h2 className="text-lg font-semibold mb-3">
        Batch <code className="font-mono">{batchUid}</code>
      </h2>
      <BatchDetailView batchUid={batchUid} />
    </div>
  )
}
