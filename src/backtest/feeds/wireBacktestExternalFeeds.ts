import type { MarketTick } from '../../strategy/Strategy.js'
import type { PluginSet } from '../../strategy/plugins/PluginSet.js'
import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { pairFromFeedSymbol } from '../../binance/paths.js'
import { symbolFromSlug, windowFromSlug } from '../../polymarket/upDownSlugWindow.js'
import { loadBinanceAggTradesSeries } from './binanceAggTradesSource.js'
import { createBacktestExternalFeedsProvider } from './backtestExternalFeedsProvider.js'

/** Pre-window margin so an as-of value exists at the first in-window tick. */
const DEFAULT_LOOKBACK_MS = 300_000

/**
 * Modeled live feed latency (exchange trade time → bot receive), applied as
 * the as-of visibility offset. Default comes from the measured live
 * distribution (`binance:verify-aggtrades` latency stats — see
 * docs/datasets/polymarket-data/binance-aggtrades-feed.md); override with
 * BACKTEST_BINANCE_FEED_LATENCY_MS.
 */
const DEFAULT_LATENCY_MS = 0

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
 * Backtest-side counterpart of the feed wiring in `trading-bot.ts`: find the
 * strategy's `ExternalFeedsRequestPlugin` and fulfill it with an as-of
 * provider backed by historical data, so `ctx.plugins.externalFeeds` reads
 * identically live and in replay.
 *
 * Only runs when the backtest was launched with `--feeds binance`; only the
 * `binanceWsSpotPrice` sub-feed is currently available (rtds/priceToBeat need
 * the Chainlink series — the Telonex `crypto_prices` follow-up).
 */
export async function wireBacktestBinanceFeed(args: {
  pluginSet: PluginSet | undefined
  slug: string
  strategyWindow?: { startMs: number; endMs: number } | null
}): Promise<void> {
  const reqPlugin = args.pluginSet
    ?.list()
    .find((p): p is ExternalFeedsRequestPlugin => p instanceof ExternalFeedsRequestPlugin)
  if (!reqPlugin) {
    console.warn(
      `[backtest:feeds] --feeds binance set, but strategy registers no ExternalFeedsRequestPlugin — running feed-less (slug=${args.slug})`,
    )
    return
  }

  const cfgSymbol = reqPlugin.config.binanceWsSpotPrice?.symbol?.trim().toLowerCase()
  if (!cfgSymbol) {
    console.warn(
      `[backtest:feeds] --feeds binance set, but strategy requests no binanceWsSpotPrice feed — running feed-less (slug=${args.slug})`,
    )
    return
  }

  const window = args.strategyWindow ?? windowFromSlug(args.slug)
  if (!window) {
    throw new Error(
      `[backtest:feeds] --feeds binance requires a market window, but slug is unparseable: ${args.slug}`,
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
