import { NextResponse, type NextRequest } from 'next/server'
import {
  getBacktestDatasetCoverage,
  type BacktestDatasetParams,
} from '@/lib/queries/backtestDatasets'

import {
  getRecorderV4DatasetCoverage,
  recorderV4DatasetRange,
} from '@/lib/queries/recorderV4Catalog'

export const dynamic = 'force-dynamic'

function parseConverter(value: string | null): BacktestDatasetParams['converter'] {
  return value === 'paired' ? 'paired' : 'delta-typed'
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  if (sp.get('source') === 'recorder-v4') {
    let range: ReturnType<typeof recorderV4DatasetRange>
    try {
      range = recorderV4DatasetRange(sp.get('from') ?? undefined, sp.get('to') ?? undefined)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid range' },
        { status: 400 },
      )
    }
    const coverage = await getRecorderV4DatasetCoverage(
      sp.get('timeframe') === '5m' ? '5m' : '15m',
      range.fromMs,
      range.toMs,
    )
    return NextResponse.json({ coverage })
  }
  const params: BacktestDatasetParams = {
    symbol: (sp.get('symbol') ?? 'btc').toLowerCase(),
    timeframe: sp.get('timeframe') ?? '15m',
    converter: parseConverter(sp.get('converter')),
  }
  const coverage = await getBacktestDatasetCoverage(params)
  return NextResponse.json({ coverage })
}
