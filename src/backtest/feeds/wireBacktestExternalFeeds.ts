import type { MarketTick } from '../../strategy/Strategy.js'
import type { PluginSet } from '../../strategy/plugins/PluginSet.js'
import {
  isExternalFeedsRequestPlugin,
  type ExternalFeedsRequestPlugin,
} from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { defaultBinanceFeedSymbol, pairFromFeedSymbol } from '../../binance/paths.js'
import { symbolFromSlug, windowFromSlug } from '../../polymarket/upDownSlugWindow.js'
import { loadBinanceAggTradesSeries } from './binanceAggTradesSource.js'
import { createBacktestExternalFeedsProvider } from './backtestExternalFeedsProvider.js'

/** Pre-window margin so an as-of value exists at the first in-window tick. */
const DEFAULT_LOOKBACK_MS = 300_000

/**
 * Modeled live feed latency (exchange trade time → bot receive), applied as
 * the as-of visibility offset. Default is the measured p50 of
 * `received_at_ms − T` from a live recording on the trading machine
 * (2026-07-16, BTCUSDT, 48k trades over ~105min: p50=110ms p90=171 p99=397 —
 * see docs/datasets/polymarket-data/binance-aggtrades-feed.md). Re-measure
 * with `binance:verify-aggtrades` and override with
 * BACKTEST_BINANCE_FEED_LATENCY_MS.
 */
const DEFAULT_LATENCY_MS = 110

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * The replay stand-in for "the bot's wall clock at tick processing time",
 * which is what live feed visibility is checked against (and what the
 * latency offset was measured against: `received_at_ms − T` on the trading
 * machine). The exchange timestamp is stamped BEFORE the Polymarket→bot
 * delivery leg (~50–150 ms), so using it would make Binance prices
 * systematically staler in replay than live.
 *
 * Fallbacks: rows without a local receive timestamp (older recordings) use
 * the exchange timestamp; a local clock BEHIND the exchange clock (recorder
 * skew / sleep-freeze anomalies) is clamped to the exchange timestamp so the
 * feed can never see less than the exchange-time baseline.
 */
function feedClockMs(tick: MarketTick): number {
  const exchangeMs = tick.snapshot.timestamp
  const localMs = tick.source.kind === 'parquet' ? tick.source.tsLocalMs : undefined
  if (localMs === undefined || !Number.isFinite(localMs) || localMs <= 0) return exchangeMs
  return Number.isFinite(exchangeMs) && exchangeMs > localMs ? exchangeMs : localMs
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

  const binanceReq = reqPlugin.config.binanceWsSpotPrice
  if (!binanceReq) {
    console.warn(
      `[backtest:feeds] strategy requests external feeds but not binanceWsSpotPrice — only rtds/priceToBeat requested, which have no backtest source yet; running feed-less (slug=${args.slug})`,
    )
    return
  }

  const slugSymbol = symbolFromSlug(args.slug)
  // No explicit symbol → follow the traded market (live derives it from
  // TRADING_SYMBOL the same way), so one strategy works on BTC/ETH/SOL/XRP
  // without a hardcoded pair.
  const cfgSymbol =
    binanceReq.symbol?.trim().toLowerCase() ||
    (slugSymbol ? defaultBinanceFeedSymbol(slugSymbol) : undefined)
  if (!cfgSymbol) {
    throw new Error(
      `[backtest:feeds] strategy requests the binance feed with no symbol and none is derivable from the slug (${args.slug})`,
    )
  }

  const window = args.strategyWindow ?? windowFromSlug(args.slug)
  if (!window) {
    throw new Error(
      `[backtest:feeds] strategy requests the binance feed but the market window is underivable (unparseable slug: ${args.slug})`,
    )
  }

  // An explicitly configured symbol wins even for a mismatched market — live
  // would feed whatever the strategy configured; parity over correctness, but
  // make it loud.
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
    provider.snapshotAt(tick ? feedClockMs(tick) : Number.NaN),
  )
  console.log(
    `[backtest:feeds] binanceWsSpotPrice fulfilled slug=${args.slug} symbol=${cfgSymbol} trades=${series.length}`,
  )
}
