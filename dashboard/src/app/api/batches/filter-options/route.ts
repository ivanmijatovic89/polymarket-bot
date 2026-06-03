import { NextResponse } from 'next/server'
import { listBacktestFilterOptions } from '@/lib/queries/batches'

export const dynamic = 'force-dynamic'

export async function GET() {
  const options = await listBacktestFilterOptions()
  return NextResponse.json(options)
}
