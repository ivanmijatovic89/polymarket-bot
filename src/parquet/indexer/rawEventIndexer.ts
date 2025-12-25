import type { MarketEvent } from '../../types/marketEventSource.js'
import { parseEventIndexFields, type PolymarketEventIndex } from '../../market/polymarketEventIndex.js'

export type RawMarketEventDropReason = 'no_market' | 'bad_json' | 'unknown_type'

export type RawMarketEventDecision =
  | { ok: true; idx: PolymarketEventIndex & { market: string } }
  | { ok: false; reason: RawMarketEventDropReason; idx: PolymarketEventIndex }

export type RawEventIndexerSnapshot = {
  total: number
  droppedNoMarket: number
  droppedBadJson: number
  droppedUnknownType: number
  byType: Record<string, number>
}

export type RawEventIndexer = {
  /**
   * Recording-oriented indexer:
   * - parses raw JSON to extract routing fields (market/event_type/ts_exchange_ms)
   * - maintains lightweight counters for visibility
   */
  handle: (ev: MarketEvent) => RawMarketEventDecision
  snapshot: () => RawEventIndexerSnapshot
}

export function createRawEventIndexer(): RawEventIndexer {
  let total = 0
  let droppedNoMarket = 0
  let droppedBadJson = 0
  let droppedUnknownType = 0
  const byType = new Map<string, number>()

  const bump = (k: string): void => {
    byType.set(k, (byType.get(k) ?? 0) + 1)
  }

  return {
    handle: (ev) => {
      total += 1
      const idx = parseEventIndexFields(ev.raw)

      if (!idx.market) {
        droppedNoMarket += 1
        return { ok: false, reason: 'no_market', idx }
      }
      if (idx.event_type === 'invalid_json') {
        droppedBadJson += 1
        return { ok: false, reason: 'bad_json', idx }
      }
      if (idx.event_type === 'unknown') {
        droppedUnknownType += 1
        return { ok: false, reason: 'unknown_type', idx }
      }

      bump(idx.event_type)
      return { ok: true, idx: idx as PolymarketEventIndex & { market: string } }
    },
    snapshot: () => ({
      total,
      droppedNoMarket,
      droppedBadJson,
      droppedUnknownType,
      byType: Object.fromEntries([...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    }),
  }
}


