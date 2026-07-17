import type { MarketTick } from '../../strategy/Strategy.js'
import type { PluginSet } from '../../strategy/plugins/PluginSet.js'
import {
  isExternalFeedsRequestPlugin,
  type ExternalFeedsRequestPlugin,
} from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { pairFromFeedSymbol } from '../../binance/paths.js'
import { symbolFromSlug, windowFromSlug } from '../../polymarket/upDownSlugWindow.js'
import { loadBinanceAggTradesSeries } from './binanceAggTradesSource.js'
import { createBacktestExternalFeedsProvider } from './backtestExternalFeedsProvider.js'

/** Pre-window margin so an as-of value exists at the first in-window tick. */
const DEFAULT_LOOKBACK_MS = 300_000

/**
 * Modeled live feed latency (exchange trade time → bot receive), applied as
 * the as-of visibility offset. Default is the measured p50 of
 * `received_at_ms − T` from a live recording on the trading machine
 * (2026-07-16, BTCUSDT, p50=85ms p90=334 p99=519 — see
 * docs/datasets/polymarket-data/binance-aggtrades-feed.md). Re-measure with
 * `binance:verify-aggtrades` and override with BACKTEST_BINANCE_FEED_LATENCY_MS.
 */
const DEFAULT_LATENCY_MS = 85

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Effective pre-window lookback. Shared with the producer preflight so both agree on needed day files. */
export function binanceFeedLookbackMs(): number {
  return envInt('BACKTEST_BINANCE_FEED_LOOKBACK_MS', DEFAULT_LOOKBACK_MS)
}

/**
 * Backtest-side counterpart of the feed wiring in `trading-bot.ts`, and
 * strategy-driven exactly like live: a strategy that registers
 * `ExternalFeedsRequestPlugin` with a `binanceWsSpotPrice` request gets the
 * feed fulfilled from historical data — no CLI flag, declaring the plugin IS
 * the opt-in. Strategies without the plugin (or without a binance request)
 * replay exactly as before.
 *
 * Only the `binanceWsSpotPrice` sub-feed is currently available
 * (rtds/priceToBeat need the Chainlink series — the Telonex `crypto_prices`
 * follow-up); requested-but-unavailable sub-feeds stay absent from the
 * snapshot, same as a live run where those clients aren't running.
 *
 * Missing historical data is a HARD error (fails the market job with the
 * exact download command) — a feed-declaring strategy silently replaying
 * feed-less would diverge from live, which is the one thing this module
 * exists to prevent.
 */
export async function wireBacktestBinanceFeed(args: {
  pluginSet: PluginSet | undefined
  slug: string
  strategyWindow?: { startMs: number; endMs: number } | null
}): Promise<void> {
  const reqPlugin: ExternalFeedsRequestPlugin | undefined = args.pluginSet
    ?.list()
    .find(isExternalFeedsRequestPlugin)
  // No request plugin → strategy didn't opt in; stay silent (this runs for
  // every market of every feed-less backtest).
  if (!reqPlugin) return

  const cfgSymbol = reqPlugin.config.binanceWsSpotPrice?.symbol?.trim().toLowerCase()
  if (!cfgSymbol) {
    console.warn(
      `[backtest:feeds] strategy requests external feeds but no binanceWsSpotPrice symbol — only rtds/priceToBeat requested, which have no backtest source yet; running feed-less (slug=${args.slug})`,
    )
    return
  }

  const window = args.strategyWindow ?? windowFromSlug(args.slug)
  if (!window) {
    throw new Error(
      `[backtest:feeds] strategy requests the binance feed but the market window is underivable (unparseable slug: ${args.slug})`,
    )
  }

  // Live would feed whatever symbol the strategy configured, even for a
  // mismatched market — parity over correctness, but make it loud.
  const slugSymbol = symbolFromSlug(args.slug)
  if (slugSymbol && !cfgSymbol.startsWith(slugSymbol)) {
    console.warn(
      `[backtest:feeds] strategy requests binance symbol=${cfgSymbol} but market slug is ${args.slug} — feeding ${cfgSymbol} (same as live)`,
    )
  }

  const series = await loadBinanceAggTradesSeries({
    pair: pairFromFeedSymbol(cfgSymbol),
    startMs: window.startMs,
    endMs: window.endMs,
    lookbackMs: binanceFeedLookbackMs(),
  })
  const provider = createBacktestExternalFeedsProvider({
    binanceWsSpotPrice: {
      symbol: cfgSymbol,
      series,
      latencyOffsetMs: envInt('BACKTEST_BINANCE_FEED_LATENCY_MS', DEFAULT_LATENCY_MS),
    },
  })
  reqPlugin.fulfill((tick?: MarketTick) =>
    provider.snapshotAt(tick ? tick.snapshot.timestamp : Number.NaN),
  )
  console.log(
    `[backtest:feeds] binanceWsSpotPrice fulfilled slug=${args.slug} symbol=${cfgSymbol} trades=${series.length}`,
  )
}
