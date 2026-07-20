import type { MarketTick } from '../../strategy/Strategy.js'
import type { PluginSet } from '../../strategy/plugins/PluginSet.js'
import {
  isExternalFeedsRequestPlugin,
  type ExternalFeedsRequestPlugin,
} from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { defaultBinanceFeedSymbol, pairFromFeedSymbol } from '../../binance/paths.js'
import { symbolFromSlug, windowFromSlug } from '../../polymarket/upDownSlugWindow.js'
import { GAMMA_PRICE_TO_BEAT_FROM_MS } from '../../polymarket/gammaEventMetadata.js'
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
 * Modeled delay between window start and the first successful priceToBeat
 * poll. Live, `createPolymarketPriceToBeatClient` starts polling at market
 * rotation with a 1s cadence, so the strike appears shortly AFTER window
 * start — never at the exact first tick. Override with
 * BACKTEST_PRICE_TO_BEAT_LATENCY_MS.
 */
const DEFAULT_PRICE_TO_BEAT_LATENCY_MS = 1_000

/**
 * Backtest-side counterpart of the feed wiring in `trading-bot.ts`, and
 * strategy-driven exactly like live: a strategy that registers
 * `ExternalFeedsRequestPlugin` gets its requested sub-feeds fulfilled from
 * historical data — no CLI flag, declaring the plugin IS the opt-in.
 * Strategies without the plugin replay exactly as before.
 *
 * Available sub-feeds: `binanceWsSpotPrice` (data.binance.vision aggTrades)
 * and `polymarketPriceToBeat` (Gamma eventMetadata via `telonex_markets`,
 * resolved by the producer into `gammaPriceToBeat`). `rtdsCryptoPrices` needs
 * the Telonex `crypto_prices` series — still live-only; requested-but-
 * unavailable sub-feeds stay absent from the snapshot, same as a live run
 * where those clients aren't running.
 *
 * Missing historical data that SHOULD exist is a HARD error (fails the market
 * job naming the exact fix command) — a feed-declaring strategy silently
 * replaying feed-less would diverge from live, which is the one thing this
 * module exists to prevent. Data that CANNOT exist (priceToBeat before Gamma's
 * ~2026-02-19 epoch) leaves the key absent instead: no command can produce it,
 * and strategies must handle an absent key anyway (live it is absent until the
 * first poll succeeds).
 */
export async function wireBacktestExternalFeeds(args: {
  pluginSet: PluginSet | undefined
  slug: string
  strategyWindow?: { startMs: number; endMs: number } | null
  /**
   * Producer-resolved Gamma metadata for this market. `undefined` = producer
   * didn't look it up (fine unless the strategy requests priceToBeat);
   * `null` = slug not in the `telonex_markets` catalog.
   */
  gammaPriceToBeat?: { priceToBeat: number | null; syncedAtMs: number | null } | null
}): Promise<void> {
  const reqPlugin: ExternalFeedsRequestPlugin | undefined = args.pluginSet
    ?.list()
    .find(isExternalFeedsRequestPlugin)
  // No request plugin → strategy didn't opt in; stay silent (this runs for
  // every market of every feed-less backtest).
  if (!reqPlugin) return

  const binanceReq = reqPlugin.config.binanceWsSpotPrice
  const priceToBeatEnabled = reqPlugin.config.polymarketPriceToBeat?.enabled === true
  if (!binanceReq && !priceToBeatEnabled) {
    console.warn(
      `[backtest:feeds] strategy requests external feeds but only rtdsCryptoPrices, which has no backtest source yet (Telonex crypto_prices follow-up); running feed-less (slug=${args.slug})`,
    )
    return
  }

  const window = args.strategyWindow ?? windowFromSlug(args.slug)
  if (!window) {
    throw new Error(
      `[backtest:feeds] strategy requests external feeds but the market window is underivable (unparseable slug: ${args.slug})`,
    )
  }
  const slugSymbol = symbolFromSlug(args.slug)

  const providerArgs: Parameters<typeof createBacktestExternalFeedsProvider>[0] = {}
  const fulfilled: string[] = []

  if (binanceReq) {
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
    // An explicitly configured symbol wins even for a mismatched market — live
    // would feed whatever the strategy configured; parity over correctness,
    // but make it loud.
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
    providerArgs.binanceWsSpotPrice = {
      symbol: cfgSymbol,
      series,
      latencyOffsetMs: envInt('BACKTEST_BINANCE_FEED_LATENCY_MS', DEFAULT_LATENCY_MS),
    }
    fulfilled.push(`binanceWsSpotPrice(symbol=${cfgSymbol} trades=${series.length})`)
  }

  if (priceToBeatEnabled) {
    if (window.startMs < GAMMA_PRICE_TO_BEAT_FROM_MS) {
      // The strike cannot exist for this market (Gamma epoch) — key stays
      // absent, exactly like live before the first successful poll.
      console.log(
        `[backtest:feeds] priceToBeat requested but market predates the Gamma eventMetadata epoch (~2026-02-19) — key stays absent (slug=${args.slug})`,
      )
    } else if (args.gammaPriceToBeat === undefined) {
      throw new Error(
        `[backtest:feeds] internal: strategy requests priceToBeat but the producer did not resolve gamma metadata for slug=${args.slug}`,
      )
    } else if (args.gammaPriceToBeat === null || args.gammaPriceToBeat.syncedAtMs === null) {
      throw new Error(
        `[backtest:feeds] priceToBeat requested but telonex_markets has no backfilled Gamma metadata for slug=${args.slug}. ` +
          `Run: npm run telonex:backfill-markets-pricetobeat-and-final-price` +
          (args.gammaPriceToBeat === null
            ? ' (slug missing from catalog — run telonex:sync first)'
            : ''),
      )
    } else if (args.gammaPriceToBeat.priceToBeat === null) {
      // Synced but Gamma has no data for a post-epoch market — anomalous
      // (boundary-window markets aside); loud, not fatal, key stays absent.
      console.warn(
        `[backtest:feeds] Gamma has no priceToBeat for post-epoch market ${args.slug} — key stays absent`,
      )
    } else {
      providerArgs.polymarketPriceToBeat = {
        symbol: (slugSymbol ?? '').toUpperCase(),
        eventStartTimeIso: new Date(window.startMs).toISOString(),
        endDateIso: new Date(window.endMs).toISOString(),
        openPrice: args.gammaPriceToBeat.priceToBeat,
        availableAtMs:
          window.startMs +
          envInt('BACKTEST_PRICE_TO_BEAT_LATENCY_MS', DEFAULT_PRICE_TO_BEAT_LATENCY_MS),
      }
      fulfilled.push(`polymarketPriceToBeat(openPrice=${args.gammaPriceToBeat.priceToBeat})`)
    }
  }

  const provider = createBacktestExternalFeedsProvider(providerArgs)
  reqPlugin.fulfill((tick?: MarketTick) =>
    provider.snapshotAt(tick ? feedClockMs(tick) : Number.NaN),
  )
  if (fulfilled.length > 0) {
    console.log(`[backtest:feeds] fulfilled slug=${args.slug}: ${fulfilled.join(', ')}`)
  }
}
