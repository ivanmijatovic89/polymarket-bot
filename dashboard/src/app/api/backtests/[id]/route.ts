import { NextResponse, type NextRequest } from 'next/server'
import { getBacktestRunById } from '@/lib/queries/batches'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: idRaw } = await context.params
  const id = Number(idRaw)
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  const detail = await getBacktestRunById(id)
  if (!detail) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({ batch: detail })
}
