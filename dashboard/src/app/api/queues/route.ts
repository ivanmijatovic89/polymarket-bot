import { NextResponse } from 'next/server'
import {
  getCachedQueueCounts,
  liveDashboardCacheHeaders,
} from '@/lib/server/liveDashboardCache'

export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await getCachedQueueCounts()
  return NextResponse.json(result.value, { headers: liveDashboardCacheHeaders(result) })
}
