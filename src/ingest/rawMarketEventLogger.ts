import type { MarketEvent } from './marketEventSource.js'
import { parseEventIndexFields } from '../polymarket/marketEventIndex.js'

export type RawMarketEventLogger = {
  onEvent: (ev: MarketEvent) => void
  snapshot: () => {
    total: number
    droppedNoMarket: number
    droppedBadJson: number
    droppedUnknownType: number
    byType: Record<string, number>
  }
}

export function createRawMarketEventLogger(): RawMarketEventLogger {
  let total = 0
  let droppedNoMarket = 0
  let droppedBadJson = 0
  let droppedUnknownType = 0
  const byType = new Map<string, number>()

  const bump = (k: string): void => {
    byType.set(k, (byType.get(k) ?? 0) + 1)
  }

  return {
    onEvent: (ev) => {
      total += 1
      const idx = parseEventIndexFields(ev.raw)
      if (!idx.market) {
        droppedNoMarket += 1
        return
      }
      if (idx.event_type === 'invalid_json') {
        droppedBadJson += 1
        return
      }
      if (idx.event_type === 'unknown') {
        droppedUnknownType += 1
        return
      }
      bump(idx.event_type)
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

