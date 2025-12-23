/**
 * Deprecated: use `src/engine/marketEventHandler.ts` instead.
 * Kept for compatibility with earlier refactors.
 */
import type { MarketEvent } from './marketEventSource.js'
import {
  createMarketEventHandler,
  type MarketEventHandlerSnapshot,
} from '../engine/marketEventHandler.js'

export type RawMarketEventLogger = {
  onEvent: (ev: MarketEvent) => void
  snapshot: () => MarketEventHandlerSnapshot
}

export function createRawMarketEventLogger(): RawMarketEventLogger {
  const h = createMarketEventHandler()
  return {
    onEvent: h.handle,
    snapshot: h.snapshot,
  }
}
