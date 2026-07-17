import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import type { AsOfSeries } from './binanceAggTradesSource.js'

export type BacktestExternalFeedsProvider = {
  /** Snapshot of the feeds as they would have looked at replay time `tickTsMs`. */
  snapshotAt: (tickTsMs: number) => ExternalFeedsSnapshot
}

/**
 * Point-in-time assembly of the live `ExternalFeedsSnapshot` shape from
 * historical series. This module is the seam for future feeds: the Telonex
 * `crypto_prices` Chainlink series slots in as another arg and another key
 * (`rtdsPolymarketCryptoPrices.chainlink`) — no re-plumbing.
 *
 * Semantics mirrored from the live store (`createExternalFeedsStore`):
 * - `rtdsPolymarketCryptoPrices: {}` is always present, even when empty.
 * - `binanceWsSpotPrice` is absent before the first visible trade (live: the
 *   key is absent until the first WS message arrives).
 * - a trade at exchange time T becomes visible at `T + latencyOffsetMs`
 *   (live: network delay between exchange and the bot); `receivedAtMs` is the
 *   modeled arrival `T + latencyOffsetMs` (live: wall-clock `Date.now()`).
 * - same-ms trades resolve to the last one in exchange order (agg id) —
 *   live last-write-wins.
 */
export function createBacktestExternalFeedsProvider(args: {
  binanceWsSpotPrice?: {
    symbol: string
    series: AsOfSeries
    latencyOffsetMs: number
  }
}): BacktestExternalFeedsProvider {
  const binance = args.binanceWsSpotPrice
  // Monotonic cursor: index of the latest visible trade (-1 = none yet).
  // Replay timestamps are non-decreasing in practice; a backwards tick falls
  // back to binary search instead of trusting the cursor.
  let cursor = -1

  const visibleAt = (i: number, tMs: number): boolean => {
    if (!binance) return false
    const ts = binance.series.tsMs[i]
    return ts !== undefined && ts + binance.latencyOffsetMs <= tMs
  }

  const advanceTo = (tMs: number): number => {
    if (!binance || binance.series.length === 0 || !Number.isFinite(tMs)) return -1
    if (cursor >= 0 && !visibleAt(cursor, tMs)) {
      // Tick went backwards: binary-search the last visible index.
      let lo = 0
      let hi = cursor
      let ans = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (visibleAt(mid, tMs)) {
          ans = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      cursor = ans
      return cursor
    }
    while (cursor + 1 < binance.series.length && visibleAt(cursor + 1, tMs)) cursor++
    return cursor
  }

  return {
    snapshotAt: (tickTsMs: number): ExternalFeedsSnapshot => {
      const snap: ExternalFeedsSnapshot = { rtdsPolymarketCryptoPrices: {} }
      if (binance) {
        const i = advanceTo(tickTsMs)
        if (i >= 0) {
          const tsMs = binance.series.tsMs[i]!
          snap.binanceWsSpotPrice = {
            symbol: binance.symbol,
            tsMs,
            value: binance.series.value[i]!,
            receivedAtMs: tsMs + binance.latencyOffsetMs,
          }
        }
      }
      return snap
    },
  }
}
