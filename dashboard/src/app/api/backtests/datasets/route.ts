import { NextResponse, type NextRequest } from 'next/server'
import {
  getBacktestDatasetCoverage,
  type BacktestDatasetParams,
} from '@/lib/queries/backtestDatasets'

export const dynamic = 'force-dynamic'

function parseConverter(value: string | null): BacktestDatasetParams['converter'] {
  return value === 'paired' ? 'paired' : 'delta-typed'
}

function parseReadFrom(value: string | null): BacktestDatasetParams['readFrom'] {
  return value === 'r2' ? 'r2' : 'local'
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const params: BacktestDatasetParams = {
    symbol: (sp.get('symbol') ?? 'btc').toLowerCase(),
    timeframe: sp.get('timeframe') ?? '15m',
    converter: parseConverter(sp.get('converter')),
    readFrom: parseReadFrom(sp.get('readFrom')),
  }
  const coverage = await getBacktestDatasetCoverage(params)
  return NextResponse.json({ coverage })
}
