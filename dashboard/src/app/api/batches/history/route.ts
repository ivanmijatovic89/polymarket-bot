import { NextResponse, type NextRequest } from 'next/server'
import { listHistoricalBatches } from '@/lib/queries/batches'
import { readBacktestBrowseState } from '@/lib/backtestBrowse'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { limit, page, sort, snapshot, status, ...filters } = readBacktestBrowseState(
    req.nextUrl.searchParams,
    50,
  )
  const result = await listHistoricalBatches(
    limit,
    { ...filters, status: status || undefined },
    { page, sort, snapshot },
  )
  return NextResponse.json(result)
}
