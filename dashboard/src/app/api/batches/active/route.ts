import { NextResponse } from 'next/server'
import {
  getCachedActiveBatches,
  liveDashboardCacheHeaders,
} from '@/lib/server/liveDashboardCache'

export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await getCachedActiveBatches()
  return NextResponse.json(result.value, { headers: liveDashboardCacheHeaders(result) })
}
