import { NextResponse, type NextRequest } from 'next/server'
import { getBacktestCoverage } from '@/lib/queries/backtestCoverage'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await context.params
  const id = Number(idRaw)
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  const coverage = await getBacktestCoverage(id)
  if (coverage === null) {
    // 200 with explicit { available: false } is friendlier for the client
    // (TanStack Query doesn't have to special-case 204 / 404).
    return NextResponse.json({ available: false })
  }
  return NextResponse.json({ available: true, ...coverage })
}
