import { NextResponse } from 'next/server'
import { getCachedRuntimeRuns } from '@/lib/server/missionControlCache'

export const dynamic = 'force-dynamic'

// Run list is DB-backed (issue #213): shows runs from EVERY machine, even
// ones whose daemon is offline. Commands go through the machine/run proxies.
export async function GET() {
  try {
    const read = await getCachedRuntimeRuns()
    return NextResponse.json({ runs: read.value }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
