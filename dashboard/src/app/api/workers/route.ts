import { NextResponse } from 'next/server'
import {
  getCachedWorkers,
  liveDashboardCacheHeaders,
} from '@/lib/server/liveDashboardCache'

export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await getCachedWorkers()
  return NextResponse.json(result.value, { headers: liveDashboardCacheHeaders(result) })
}
