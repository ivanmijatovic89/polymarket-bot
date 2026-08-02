import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { BatchDetailView } from '@/components/BatchDetailView'

export const dynamic = 'force-dynamic'

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ batchUid: string }>
}) {
  const { batchUid } = await params
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/fleet"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Fleet
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          Batch <code className="font-mono text-base text-muted-foreground">{batchUid}</code>
        </h1>
      </div>
      <BatchDetailView batchUid={batchUid} />
    </div>
  )
}
