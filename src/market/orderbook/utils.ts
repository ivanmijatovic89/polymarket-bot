import type { OrderLevel, PriceChange, SideBook } from './types.js'

export const DEFAULT_DEPTH_LEVELS = 10

export function parseNum(label: string, raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error(`[orderbook] invalid ${label}: ${JSON.stringify(raw)}`)
  }
  return n
}

export function parseTsMs(raw: string): number {
  // Polymarket uses unix ms encoded as strings.
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`[orderbook] invalid timestamp: ${JSON.stringify(raw)}`)
  return Math.trunc(n)
}

export function toSortedLevelsFromBookSide(
  side: 'bids' | 'asks',
  levels: { price: string; size: string }[],
): OrderLevel[] {
  const out: OrderLevel[] = []
  for (const lvl of levels) {
    const price = parseNum(`${side}.price`, lvl.price)
    const size = parseNum(`${side}.size`, lvl.size)
    if (size <= 0) continue
    out.push({ price, size })
  }
  if (side === 'bids') out.sort((a, b) => b.price - a.price)
  else out.sort((a, b) => a.price - b.price)
  return out
}

export function rebuildMapSorted(levels: OrderLevel[]): SideBook {
  const m: SideBook = new Map()
  for (const lvl of levels) m.set(lvl.price, lvl)
  return m
}

export function bestFromSortedMap(map: SideBook): number | null {
  for (const p of map.keys()) return p
  return null
}

export function getMid(bestBid: number | null, bestAsk: number | null): number | null {
  if (bestBid === null || bestAsk === null) return null
  return (bestBid + bestAsk) / 2
}

export function getSpread(bestBid: number | null, bestAsk: number | null): number | null {
  if (bestBid === null || bestAsk === null) return null
  return bestAsk - bestBid
}

export function groupPriceChangesByAsset(changes: PriceChange[]): Map<string, PriceChange[]> {
  const out = new Map<string, PriceChange[]>()
  for (const ch of changes) {
    const arr = out.get(ch.asset_id) ?? []
    arr.push(ch)
    out.set(ch.asset_id, arr)
  }
  return out
}

/**
 * Compute cumulative depth for the first N levels.
 * Array index 0 corresponds to level 1.
 */
export function cumulativeDepthByLevel(
  levels: readonly OrderLevel[],
  depthLevels: number = DEFAULT_DEPTH_LEVELS,
): number[] {
  const n = Math.max(0, Math.floor(depthLevels))
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < n && i < levels.length; i++) {
    sum += levels[i]!.size
    out.push(sum)
  }
  return out
}
