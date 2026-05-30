import { NextResponse, type NextRequest } from 'next/server'
import { listHistoricalBatches } from '@/lib/queries/batches'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('limit')
  const limit = Math.max(1, Math.min(200, Number(raw ?? 50) || 50))
  const batches = await listHistoricalBatches(limit)
  return NextResponse.json({ batches })
}
