import { NextResponse } from 'next/server'
import { listActiveBatchDetailsForLabel, listBatchRuns } from '@/lib/queries/batches'

export const dynamic = 'force-dynamic'

/**
 * Batch group endpoint. `batch_uid` is a non-unique label grouping related
 * runs (e.g. every cell of one param sweep), so this returns:
 *   - `runs`: all finalized runs with this label (summaries; per-market
 *     detail lives at /api/backtests/[id])
 *   - `active`: all in-flight submissions carrying this label (live BullMQ
 *     progress)
 */
export async function GET(_req: Request, { params }: { params: Promise<{ batchUid: string }> }) {
  const { batchUid } = await params
  const [runs, active] = await Promise.all([
    listBatchRuns(batchUid),
    listActiveBatchDetailsForLabel(batchUid),
  ])
  if (runs.length === 0 && active.length === 0) {
    return NextResponse.json({ error: 'batch not found' }, { status: 404 })
  }
  return NextResponse.json({
    batchUid,
    runs,
    active: active.map((a) => ({
      ...a,
      // Cap to keep response small even for runaway failures.
      failedChildrenValues: Object.fromEntries(
        Object.entries(a.failedChildrenValues).slice(0, 50),
      ),
    })),
  })
}
