import type { EngineSource } from './MarketEngine.js'
import type { MarketOrderBooksSnapshot } from './orderbook/index.js'

/**
 * Synthetic feed ticks — opt-in extra strategy ticks fired when an external
 * feed updates (Binance aggTrade / Chainlink round), between real Polymarket
 * orderbook ticks. See docs/backtest/adr-binance-driven-ticks.md.
 *
 * The message type is deliberately NOT part of `AnyMarketMessage`: the
 * orderbook engine's `applyAny` throws on unknown event types, and keeping
 * the unions disjoint makes "a synthetic message reaches the engine" a
 * COMPILE error instead of a runtime assertion. (These event types are also
 * unrelated to `SYNTHETIC_EVENT_TYPES` in marketChannelDecoder.ts — those are
 * recorder markers skipped before the engine; these never enter the decoder
 * path at all.)
 *
 * Deliberately minimal payload: no price. The feed value is read through
 * `ctx.plugins.externalFeeds` exactly like on real ticks — one read path for
 * both runtimes, no second source of truth to drift.
 */
export type SyntheticFeedEventType = 'binance_agg_trade' | 'chainlink_round'

export type SyntheticFeedTickMessage = {
  event_type: SyntheticFeedEventType
  /** MUST equal the real ticks' market key — StrategyRunner's plugin-reset keys on it. */
  market: string
  /** Stamped tick time (ms, stringified — parity with the real messages' shape). */
  timestamp: string
  /** Feed symbol, e.g. 'btcusdt' / 'btc/usd'. */
  symbol: string
}

export function isSyntheticFeedTick(msg: { event_type: string }): msg is SyntheticFeedTickMessage {
  return msg.event_type === 'binance_agg_trade' || msg.event_type === 'chainlink_round'
}

/**
 * THE single constructor for synthetic ticks — used by live (trading-bot) and
 * replay (runSingleMarket's flusher), so stamping semantics are identical by
 * construction.
 *
 * Monotone clamp: `snapshot.timestamp = max(visibilityMs, baseSnapshot.timestamp)`
 * — strategy time never steps backward relative to the last dispatched tick
 * (live feed receive clocks and Polymarket exchange stamps are different
 * clock domains, ~50–150 ms apart). Real ticks are never re-stamped.
 *
 * The book is the base snapshot unchanged (shallow copy; `byAssetId` shared —
 * a synthetic tick by definition carries no book change).
 */
export function buildSyntheticFeedTick(args: {
  eventType: SyntheticFeedEventType
  symbol: string
  visibilityMs: number
  baseSnapshot: MarketOrderBooksSnapshot
  source: EngineSource
}): {
  source: EngineSource
  msg: SyntheticFeedTickMessage
  snapshot: MarketOrderBooksSnapshot
} {
  const ts = Math.max(args.visibilityMs, args.baseSnapshot.timestamp)
  return {
    source: args.source,
    msg: {
      event_type: args.eventType,
      market: args.baseSnapshot.market,
      timestamp: String(ts),
      symbol: args.symbol,
    },
    snapshot: { ...args.baseSnapshot, timestamp: ts },
  }
}
