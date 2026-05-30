import { NextResponse } from 'next/server'
import { queueCounts } from '@/lib/queries/queues'

export const dynamic = 'force-dynamic'

export async function GET() {
  const counts = await queueCounts()
  return NextResponse.json(counts)
}
