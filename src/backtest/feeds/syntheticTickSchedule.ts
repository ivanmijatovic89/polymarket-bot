import type { AsOfSeries } from './binanceAggTradesSource.js'
import type { TwoClockAsOfSeries } from './chainlinkCryptoPricesSource.js'
import type { SyntheticFeedEventType } from '../../market/syntheticTick.js'

/**
 * Replay-side schedule for opt-in synthetic feed ticks: the visibility times
 * at which live would have fired one (feed event time + the measured feed
 * latency), pre-computed from the already-loaded historical series.
 * See docs/backtest/adr-binance-driven-ticks.md.
 */
export type SyntheticTickEvent = {
  visibilityMs: number
  eventType: SyntheticFeedEventType
  symbol: string
}

/**
 * Sorted by (visibilityMs, eventType) — 'binance_agg_trade' sorts before
 * 'chainlink_round' at equal times (documented deterministic tie-break).
 * Within one feed, series order is preserved (binance series is sorted by
 * agg_trade_id — the ADR's tie-break — so equal-visibility trades dispatch in
 * exchange order).
 *
 * Window-bounded (inclusive): lookback-tail events are excluded — stats count
 * every dispatched tick pre-gate, and live's pre-window feed events never
 * reach a strategy for this market either.
 */
export function buildSyntheticTickSchedule(args: {
  binance?: { series: AsOfSeries; latencyOffsetMs: number; symbol: string }
  chainlink?: { series: TwoClockAsOfSeries; latencyOffsetMs: number; symbol: string }
  windowStartMs: number
  windowEndMs: number
}): SyntheticTickEvent[] {
  const out: SyntheticTickEvent[] = []
  if (args.binance) {
    const { series, latencyOffsetMs, symbol } = args.binance
    for (let i = 0; i < series.length; i++) {
      const v = series.tsMs[i]! + latencyOffsetMs
      if (v < args.windowStartMs || v > args.windowEndMs) continue
      out.push({ visibilityMs: v, eventType: 'binance_agg_trade', symbol })
    }
  }
  if (args.chainlink) {
    const { series, latencyOffsetMs, symbol } = args.chainlink
    for (let i = 0; i < series.length; i++) {
      const v = series.visibleAtMs[i]! + latencyOffsetMs
      if (v < args.windowStartMs || v > args.windowEndMs) continue
      out.push({ visibilityMs: v, eventType: 'chainlink_round', symbol })
    }
  }
  // Stable merge: both inputs are already time-sorted; sort is stable in JS,
  // so equal-visibility events keep insertion order per feed and the explicit
  // eventType comparison pins the cross-feed tie-break.
  out.sort((a, b) => a.visibilityMs - b.visibilityMs || a.eventType.localeCompare(b.eventType))
  return out
}

/**
 * The interleaving core used by runSingleMarket (extracted for direct unit
 * testing — no parquet needed). Contract:
 *
 * - `flushUpTo(clockMs)` dispatches every scheduled event with
 *   `visibilityMs < clockMs` STRICTLY — so an event with visibility equal to a
 *   real tick's clock dispatches AFTER that real tick ("orderbook first at
 *   equal timestamps": live applies the book event before the feed value is
 *   read).
 * - Events scheduled before the first real snapshot exists are consumed but
 *   never dispatched — live drops feed events until the first book snapshot.
 * - The index only advances: a backwards real clock (exchange_time reorder)
 *   flushes nothing and never re-dispatches.
 * - `flushTail()` dispatches the window-bounded remainder after the stream
 *   ends.
 */
export function createSyntheticFlusher(args: {
  schedule: SyntheticTickEvent[] | null
  hasBaseSnapshot: () => boolean
  dispatch: (ev: SyntheticTickEvent) => Promise<void>
  shouldStop?: () => boolean
}): { flushUpTo: (clockMs: number) => Promise<void>; flushTail: () => Promise<void> } {
  let idx = 0
  const flushUpTo = async (clockMs: number): Promise<void> => {
    const schedule = args.schedule
    if (!schedule) return
    if (!args.hasBaseSnapshot()) {
      while (idx < schedule.length && schedule[idx]!.visibilityMs < clockMs) idx += 1
      return
    }
    while (idx < schedule.length && schedule[idx]!.visibilityMs < clockMs) {
      if (args.shouldStop?.()) return
      const ev = schedule[idx]!
      idx += 1
      await args.dispatch(ev)
    }
  }
  return {
    flushUpTo,
    flushTail: () => flushUpTo(Number.POSITIVE_INFINITY),
  }
}
