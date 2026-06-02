import { NextResponse } from 'next/server'
import { listWorkers } from '@/lib/queries/workers'

export const dynamic = 'force-dynamic'

export async function GET() {
  const machines = await listWorkers()
  return NextResponse.json({
    machines,
    totals: {
      processedTotal: machines.reduce((s, m) => s + m.totals.processedTotal, 0),
      eventsTotal: machines.reduce((s, m) => s + m.totals.eventsTotal, 0),
      alive: machines.reduce((s, m) => s + m.totals.aliveCount, 0),
    },
  })
}
