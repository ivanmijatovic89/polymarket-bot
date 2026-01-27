export type BinanceKlineInterval = '1h' | '15m'

export type BinanceCandle = {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
}

export type BinanceKlinesRequest = {
  symbol: string
  interval: BinanceKlineInterval
  endTimeMs: number
  limit?: number
  baseUrl?: string
}

const BINANCE_BASE = 'https://api.binance.com'

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 500
  return Math.max(1, Math.min(1000, Math.floor(limit)))
}

function parseKlineRow(row: unknown): BinanceCandle | null {
  if (!Array.isArray(row)) return null
  if (row.length < 7) return null
  const openTime = Number(row[0])
  const open = Number(row[1])
  const high = Number(row[2])
  const low = Number(row[3])
  const close = Number(row[4])
  const volume = Number(row[5])
  const closeTime = Number(row[6])
  if (!Number.isFinite(openTime) || !Number.isFinite(closeTime)) return null
  if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return null
  if (!Number.isFinite(volume)) return null
  return { openTime, open, high, low, close, volume, closeTime }
}

export async function fetchBinanceKlines(args: BinanceKlinesRequest): Promise<BinanceCandle[]> {
  const symbol = normalizeSymbol(args.symbol)
  const interval = args.interval
  const endTimeMs = Math.trunc(args.endTimeMs)
  const limit = clampLimit(args.limit ?? 500)
  if (!symbol) throw new Error('[binanceKlines] missing symbol')
  if (!Number.isFinite(endTimeMs) || endTimeMs <= 0) {
    throw new Error(`[binanceKlines] invalid endTimeMs=${args.endTimeMs}`)
  }

  const base = (args.baseUrl ?? BINANCE_BASE).replace(/\/+$/, '')
  const url = new URL(`${base}/api/v3/klines`)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('interval', interval)
  url.searchParams.set('endTime', String(endTimeMs))
  url.searchParams.set('limit', String(limit))

  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[binanceKlines] HTTP ${res.status}: ${text}`)
  }

  const raw: unknown = await res.json()
  if (!Array.isArray(raw)) {
    throw new Error('[binanceKlines] unexpected response (not array)')
  }

  const out: BinanceCandle[] = []
  for (const row of raw) {
    const parsed = parseKlineRow(row)
    if (parsed) out.push(parsed)
  }

  const map = new Map<number, BinanceCandle>()
  for (const c of out) map.set(c.openTime, c)
  return Array.from(map.values()).sort((a, b) => a.openTime - b.openTime)
}
