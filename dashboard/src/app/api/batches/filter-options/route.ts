import { NextResponse, type NextRequest } from 'next/server'
import { listBacktestFilterOptions } from '@/lib/queries/batches'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const options = await listBacktestFilterOptions({
    protocol: req.nextUrl.searchParams.get('protocol') || undefined,
    model: req.nextUrl.searchParams.get('model') || undefined,
  })
  return NextResponse.json(options)
}
