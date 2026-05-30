import { NextResponse } from 'next/server'
import { getActiveBatchDetail, getBatchDetail } from '@/lib/queries/batches'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ batchUid: string }> }) {
  const { batchUid } = await params
  const active = await getActiveBatchDetail(batchUid)
  if (active) {
    return NextResponse.json({
      batchUid,
      active: true,
      parentState: active.parentState,
      strategy: active.strategy,
      totalMarkets: active.totalMarkets,
      waitingChildren: active.waitingChildren,
      activeChildren: active.activeChildren,
      completedChildren: active.completedChildren,
      failedChildren: active.failedChildren,
    })
  }
  const detail = await getBatchDetail(batchUid)
  if (!detail) {
    return NextResponse.json({ error: 'batch not found' }, { status: 404 })
  }
  return NextResponse.json({ batchUid, active: false, batch: detail })
}
