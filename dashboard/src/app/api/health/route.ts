import { NextResponse } from 'next/server'
import { AGGREGATE_QUEUE, MARKET_QUEUE } from '@/lib/queue'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    queues: { market: MARKET_QUEUE, aggregate: AGGREGATE_QUEUE },
  })
}
