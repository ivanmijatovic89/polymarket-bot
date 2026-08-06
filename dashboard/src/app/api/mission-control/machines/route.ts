import { NextResponse } from 'next/server'
import { getCachedMachineHealth } from '@/lib/server/missionControlCache'

export const dynamic = 'force-dynamic'

// Health sweep over every catalog machine with a runtimeUrl (issue #213).
export async function GET() {
  const read = await getCachedMachineHealth()
  return NextResponse.json(
    { machines: read.value },
    { headers: { 'cache-control': 'no-store' } },
  )
}
