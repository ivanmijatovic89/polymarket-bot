import { NextResponse, type NextRequest } from 'next/server'
import { listHistoricalBatches, type HistoricalBatchFilters } from '@/lib/queries/batches'

export const dynamic = 'force-dynamic'

function parseStatus(value: string | null): HistoricalBatchFilters['status'] | undefined {
  if (value === 'completed' || value === 'partial' || value === 'failed') return value
  return undefined
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const raw = sp.get('limit')
  const limit = Math.max(1, Math.min(500, Number(raw ?? 50) || 50))
  const filters: HistoricalBatchFilters = {}
  const strategy = sp.get('strategy')
  const symbol = sp.get('symbol')
  const status = parseStatus(sp.get('status'))
  if (strategy) filters.strategy = strategy
  if (symbol) filters.symbol = symbol
  if (status) filters.status = status
  const batches = await listHistoricalBatches(limit, filters)
  return NextResponse.json({ batches })
}
