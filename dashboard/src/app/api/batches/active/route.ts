import { NextResponse } from 'next/server'
import { listActiveBatches } from '@/lib/queries/batches'

export const dynamic = 'force-dynamic'

export async function GET() {
  const batches = await listActiveBatches()
  return NextResponse.json({ batches })
}
