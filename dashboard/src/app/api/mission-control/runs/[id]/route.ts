import { NextResponse } from 'next/server'
import { getRuntimeRunDetail } from '@/lib/queries/runtimeRuns'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

// Detail is DB-backed (issue #213) so history stays browsable while the
// owning machine is offline. Live files/steering go through the run proxy.
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  const runId = Number(id)
  if (!Number.isSafeInteger(runId) || runId < 1) {
    return NextResponse.json({ error: 'invalid run id' }, { status: 400 })
  }
  try {
    const detail = await getRuntimeRunDetail(runId)
    if (!detail) return NextResponse.json({ error: `run ${runId} not found` }, { status: 404 })
    return NextResponse.json(detail, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
