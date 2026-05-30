import { NextResponse } from 'next/server'
import { listWorkers } from '@/lib/queries/workers'

export const dynamic = 'force-dynamic'

export async function GET() {
  const workers = await listWorkers()
  return NextResponse.json({
    workers,
    totals: {
      processedTotal: workers.reduce((s, w) => s + w.processedTotal, 0),
      eventsTotal: workers.reduce((s, w) => s + w.eventsTotal, 0),
      alive: workers.filter((w) => w.alive).length,
    },
  })
}
