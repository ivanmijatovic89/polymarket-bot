export type DeribitCurrency = 'BTC' | 'ETH' | 'USDC' | 'USDT' | 'EURR'
export type DeribitVolatilityResolution = '1' | '60' | '3600' | '43200' | '1D'

export type DeribitVolatilityCandle = {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}

export type DeribitVolatilityIndexRequest = {
  currency: DeribitCurrency
  startTimestampMs: number
  endTimestampMs: number
  resolution: DeribitVolatilityResolution
  baseUrl?: string
}

const DERIBIT_BASE_URL = 'https://www.deribit.com'

function parseCandleRow(row: unknown): DeribitVolatilityCandle | null {
  if (!Array.isArray(row) || row.length < 5) return null
  const timestamp = Number(row[0])
  const open = Number(row[1])
  const high = Number(row[2])
  const low = Number(row[3])
  const close = Number(row[4])
  if (!Number.isFinite(timestamp)) return null
  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  )
    return null
  return { timestamp, open, high, low, close }
}

export async function fetchDeribitVolatilityIndexData(
  args: DeribitVolatilityIndexRequest,
): Promise<DeribitVolatilityCandle[]> {
  const startTimestampMs = Math.trunc(args.startTimestampMs)
  const endTimestampMs = Math.trunc(args.endTimestampMs)
  if (!Number.isFinite(startTimestampMs) || !Number.isFinite(endTimestampMs)) {
    throw new Error('[deribitVolatilityIndex] invalid timestamps')
  }
  if (endTimestampMs < startTimestampMs) {
    throw new Error('[deribitVolatilityIndex] endTimestampMs < startTimestampMs')
  }

  const base = (args.baseUrl ?? DERIBIT_BASE_URL).replace(/\/+$/, '')
  const url = new URL(`${base}/api/v2/public/get_volatility_index_data`)
  url.searchParams.set('currency', args.currency)
  url.searchParams.set('start_timestamp', String(startTimestampMs))
  url.searchParams.set('end_timestamp', String(endTimestampMs))
  url.searchParams.set('resolution', args.resolution)

  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[deribitVolatilityIndex] HTTP ${res.status}: ${text}`)
  }

  const body: unknown = await res.json()
  if (!body || typeof body !== 'object') {
    throw new Error('[deribitVolatilityIndex] unexpected response body')
  }

  const error = (body as { error?: { message?: unknown } }).error
  if (error) {
    const msg = typeof error.message === 'string' ? error.message : 'unknown error'
    throw new Error(`[deribitVolatilityIndex] error: ${msg}`)
  }

  const result = (body as { result?: { data?: unknown } }).result
  const data = result?.data
  if (!Array.isArray(data)) {
    throw new Error('[deribitVolatilityIndex] missing result.data array')
  }

  const out: DeribitVolatilityCandle[] = []
  for (const row of data) {
    const parsed = parseCandleRow(row)
    if (parsed) out.push(parsed)
  }

  return out.sort((a, b) => a.timestamp - b.timestamp)
}
