import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import type { AsOfSeries } from './binanceAggTradesSource.js'
import type { TwoClockAsOfSeries } from './chainlinkCryptoPricesSource.js'

export type BacktestExternalFeedsProvider = {
  /** Snapshot of the feeds as they would have looked at replay time `tickTsMs`. */
  snapshotAt: (tickTsMs: number) => ExternalFeedsSnapshot
}

/**
 * Point-in-time assembly of the live `ExternalFeedsSnapshot` shape from
 * historical series.
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
 * - `polymarketPriceToBeat` is absent until `availableAtMs` (live: the client
 *   starts polling at window rotation, 1s cadence, so the strike appears
 *   shortly AFTER window start — never before; the previous window's value is
 *   cleared at rotation, matching per-market provider lifetime here).
 * - `rtdsPolymarketCryptoPrices.chainlink` uses the TWO-CLOCK series:
 *   visibility keys on the Polymarket BROADCAST time (`visibleAtMs`) plus the
 *   modeled broadcast→bot latency, while the emitted point carries the
 *   chainlink ROUND time as `tsMs` (live parity — `payload.timestamp`).
 *   `rtdsPolymarketCryptoPrices.binance` has no backtest source (the channel
 *   carries only the chainlink stream) and stays absent, same as a live run
 *   without that subscription.
 */
export function createBacktestExternalFeedsProvider(args: {
  binanceWsSpotPrice?: {
    symbol: string
    series: AsOfSeries
    latencyOffsetMs: number
  }
  rtdsChainlink?: {
    /** The RTDS chainlink feed symbol, e.g. "btc/usd" — live parity. */
    symbol: string
    series: TwoClockAsOfSeries
    /** Modeled broadcast→bot leg ONLY (the ~1s round→broadcast lag is data). */
    latencyOffsetMs: number
  }
  polymarketPriceToBeat?: {
    /** Uppercase trading symbol, e.g. "BTC" — live passes `symbolUpper`. */
    symbol: string
    eventStartTimeIso: string
    endDateIso: string
    openPrice: number
    /** Modeled first-successful-poll time (window start + poll latency). */
    availableAtMs: number
  }
}): BacktestExternalFeedsProvider {
  const binance = args.binanceWsSpotPrice
  // Monotonic cursor: index of the latest visible trade (-1 = none yet).
  // Replay timestamps are non-decreasing in practice; a backwards tick falls
  // back to binary search instead of trusting the cursor.
  let cursor = -1
  // Live feed visibility is bounded by the bot's wall clock, which is
  // monotone. Replay tick clocks may not be (`--order exchange_time` reorders
  // rows whose local receive times interleave), so clamp to the high-water
  // mark — the feed value must never move backward between consecutive ticks,
  // because live it can't.
  let clockHighWaterMs = Number.NEGATIVE_INFINITY

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

  // Chainlink cursor — independent twin of the binance cursor above (kept
  // separate so the binance code path stays byte-identical). Visibility keys
  // on the BROADCAST clock (`visibleAtMs`), which the loader sorted by.
  const chainlink = args.rtdsChainlink
  let clCursor = -1

  const clVisibleAt = (i: number, tMs: number): boolean => {
    if (!chainlink) return false
    const vis = chainlink.series.visibleAtMs[i]
    return vis !== undefined && vis + chainlink.latencyOffsetMs <= tMs
  }

  const clAdvanceTo = (tMs: number): number => {
    if (!chainlink || chainlink.series.length === 0 || !Number.isFinite(tMs)) return -1
    if (clCursor >= 0 && !clVisibleAt(clCursor, tMs)) {
      // Tick went backwards: binary-search the last visible index.
      let lo = 0
      let hi = clCursor
      let ans = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (clVisibleAt(mid, tMs)) {
          ans = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      clCursor = ans
      return clCursor
    }
    while (clCursor + 1 < chainlink.series.length && clVisibleAt(clCursor + 1, tMs)) clCursor++
    return clCursor
  }

  return {
    snapshotAt: (tickTsMs: number): ExternalFeedsSnapshot => {
      const snap: ExternalFeedsSnapshot = { rtdsPolymarketCryptoPrices: {} }
      // One monotone clock for every feed key (see clockHighWaterMs above).
      const clamped = Number.isFinite(tickTsMs) ? Math.max(tickTsMs, clockHighWaterMs) : tickTsMs
      if (Number.isFinite(clamped)) clockHighWaterMs = clamped
      if (binance) {
        const i = advanceTo(clamped)
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
      if (chainlink) {
        const i = clAdvanceTo(clamped)
        if (i >= 0) {
          snap.rtdsPolymarketCryptoPrices!.chainlink = {
            symbol: chainlink.symbol,
            // Round time, NOT broadcast time — live parity (payload.timestamp).
            tsMs: chainlink.series.tsMs[i]!,
            value: chainlink.series.value[i]!,
            receivedAtMs: chainlink.series.visibleAtMs[i]! + chainlink.latencyOffsetMs,
          }
        }
      }
      const ptb = args.polymarketPriceToBeat
      if (ptb) {
        if (Number.isFinite(clamped) && clamped >= ptb.availableAtMs) {
          snap.polymarketPriceToBeat = {
            symbol: ptb.symbol,
            eventStartTimeIso: ptb.eventStartTimeIso,
            endDateIso: ptb.endDateIso,
            openPrice: ptb.openPrice,
            receivedAtMs: ptb.availableAtMs,
          }
        }
      }
      return snap
    },
  }
}
