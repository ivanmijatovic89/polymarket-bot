import type { MarketTick } from '../../strategy/Strategy.js'
import type { PluginSet } from '../../strategy/plugins/PluginSet.js'
import {
  isExternalFeedsRequestPlugin,
  type ExternalFeedsRequestPlugin,
} from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { defaultBinanceFeedSymbol, pairFromFeedSymbol } from '../../binance/paths.js'
import {
  symbolFromSlug,
  timeframeFromSlug,
  windowFromSlug,
} from '../../polymarket/upDownSlugWindow.js'
import { gammaPriceToBeatEpochMs } from '../../polymarket/gammaEventMetadata.js'
import {
  assetIdForSymbol,
  assetIdFromChainlinkFeedSymbol,
  chainlinkFeedSymbolForMarketSymbol,
} from '../../telonex/cryptoPrices/paths.js'
import { loadBinanceAggTradesSeries } from './binanceAggTradesSource.js'
import { loadChainlinkCryptoPricesSeries } from './chainlinkCryptoPricesSource.js'
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
 * Modeled RTDS broadcast→bot latency for the chainlink feed. This is ONLY the
 * network leg between Polymarket broadcasting a round and the bot receiving
 * it — the ~1s round→broadcast lag is carried by the series' `visibleAtMs`
 * data and must never be double-counted here. Default is the measured p50 of
 * `received_at_ms − server_ts_ms` from a live RTDS recording on the trading
 * machine (`telonex:crypto-prices:verify` prints it; see
 * docs/datasets/polymarket-data/chainlink-crypto-prices-feed.md). Override
 * with BACKTEST_RTDS_CHAINLINK_LATENCY_MS.
 */
const DEFAULT_RTDS_CHAINLINK_LATENCY_MS = 100

/** Effective chainlink pre-window lookback. Shared with the producer preflight. */
export function rtdsChainlinkLookbackMs(): number {
  return envInt('BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS', DEFAULT_LOOKBACK_MS)
}

/**
 * Modeled delay between window start and the first successful priceToBeat
 * poll. Live, `createPolymarketPriceToBeatClient` polls from market rotation
 * at 1s cadence, but the endpoint itself publishes the open price LATE —
 * observed ~10–60s after window start (owner-reported). Until the live logs
 * pin the distribution (the client now logs "openPrice available Xs after
 * window start" on every resolve), default to a mid-range 30s so backtests
 * don't grant strategies the strike earlier than live plausibly could.
 * Override with BACKTEST_PRICE_TO_BEAT_LATENCY_MS.
 */
const DEFAULT_PRICE_TO_BEAT_LATENCY_MS = 30_000

/**
 * Markets settled more recently than this replay with the priceToBeat key
 * absent (warning, not error) when no strike is backfilled yet: the Telonex
 * catalog publishes daily (~24h lag) and the backfill's settled gate waits 3h
 * after window end, so a just-recorded market CANNOT have the strike in
 * `telonex_markets` yet — hard-erroring would fail every record-today /
 * backtest-tonight run with remediation commands that are no-ops until the
 * pipeline catches up.
 */
const FRESH_MARKET_GRACE_MS = 30 * 3_600_000

/**
 * Backtest-side counterpart of the feed wiring in `trading-bot.ts`, and
 * strategy-driven exactly like live: a strategy that registers
 * `ExternalFeedsRequestPlugin` gets its requested sub-feeds fulfilled from
 * historical data — no CLI flag, declaring the plugin IS the opt-in.
 * Strategies without the plugin replay exactly as before.
 *
 * Available sub-feeds: `binanceWsSpotPrice` (data.binance.vision aggTrades),
 * `polymarketPriceToBeat` (Gamma eventMetadata via `telonex_markets`, resolved
 * by the producer into `gammaPriceToBeat`), and
 * `rtdsPolymarketCryptoPrices.chainlink` (Telonex `crypto_prices` — the
 * Chainlink rounds Polymarket resolves with, two-clock visibility model).
 * `rtdsPolymarketCryptoPrices.binance` has no backtest source (the channel
 * carries only the chainlink stream) and stays absent, same as a live run
 * without that subscription — strategies needing a Binance price use
 * `binanceWsSpotPrice`.
 *
 * Missing historical data that SHOULD exist is a HARD error (fails the market
 * job naming the exact fix command) — a feed-declaring strategy silently
 * replaying feed-less would diverge from live, which is the one thing this
 * module exists to prevent. Data that CANNOT exist (priceToBeat before Gamma's
 * ~2026-02-19 epoch) leaves the key absent instead: no command can produce it,
 * and strategies must handle an absent key anyway (live it is absent until the
 * first poll succeeds). EXCEPTION — the chainlink feed is hard-error in EVERY
 * unavailable case, including pre-coverage markets (project decision): it is
 * the resolution price, and a strategy requesting it must never silently run
 * without it.
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
  const rtdsReq = reqPlugin.config.rtdsCryptoPrices
  if (!binanceReq && !priceToBeatEnabled && !rtdsReq) return

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

  if (rtdsReq) {
    if (rtdsReq.binanceSymbols?.length) {
      console.warn(
        `[backtest:feeds] strategy requests rtds BINANCE symbols (${rtdsReq.binanceSymbols.join(', ')}) — that sub-key has no backtest source (crypto_prices carries only the chainlink stream); it stays absent, same as a live run without that subscription. Use binanceWsSpotPrice for a Binance price. (slug=${args.slug})`,
      )
    }
    // Explicit chainlinkSymbols win; no list → follow the traded market
    // (live derives `${TRADING_SYMBOL}/usd` the same way).
    let feedSymbol: string | undefined
    if (rtdsReq.chainlinkSymbols?.length) {
      if (rtdsReq.chainlinkSymbols.length > 1) {
        console.warn(
          `[backtest:feeds] backtest supports a single chainlink symbol per market (live last-write-wins across symbols is not reproducible) — using ${rtdsReq.chainlinkSymbols[0]} (slug=${args.slug})`,
        )
      }
      feedSymbol = rtdsReq.chainlinkSymbols[0]!.trim().toLowerCase()
    } else if (slugSymbol) {
      feedSymbol = chainlinkFeedSymbolForMarketSymbol(slugSymbol)
    }
    if (!feedSymbol) {
      throw new Error(
        `[backtest:feeds] strategy requests the rtds chainlink feed with no symbol and none is derivable from the slug (${args.slug})`,
      )
    }
    const assetId = assetIdFromChainlinkFeedSymbol(feedSymbol) ?? assetIdForSymbol(feedSymbol)
    // An explicitly configured symbol wins even for a mismatched market — live
    // would feed whatever the strategy configured; parity over correctness,
    // but make it loud.
    if (slugSymbol && !assetId.startsWith(slugSymbol)) {
      console.warn(
        `[backtest:feeds] strategy requests chainlink symbol=${feedSymbol} but market slug is ${args.slug} — feeding ${feedSymbol} (same as live)`,
      )
    }
    const series = await loadChainlinkCryptoPricesSeries({
      assetId,
      startMs: window.startMs,
      endMs: window.endMs,
      lookbackMs: rtdsChainlinkLookbackMs(),
    })
    providerArgs.rtdsChainlink = {
      symbol: feedSymbol,
      series,
      latencyOffsetMs: envInt(
        'BACKTEST_RTDS_CHAINLINK_LATENCY_MS',
        DEFAULT_RTDS_CHAINLINK_LATENCY_MS,
      ),
    }
    fulfilled.push(`rtdsChainlink(symbol=${feedSymbol} rounds=${series.length})`)
  }

  if (priceToBeatEnabled) {
    const meta = args.gammaPriceToBeat
    if (meta && meta.priceToBeat !== null) {
      // A backfilled strike ALWAYS feeds, regardless of the series epoch —
      // the epoch below only classifies missing strikes. This keeps the
      // provisional (deliberately late) 1h/4h/1d epochs safe: data present
      // inside the provisional span is still served.
      providerArgs.polymarketPriceToBeat = {
        symbol: (slugSymbol ?? '').toUpperCase(),
        eventStartTimeIso: new Date(window.startMs).toISOString(),
        endDateIso: new Date(window.endMs).toISOString(),
        openPrice: meta.priceToBeat,
        availableAtMs:
          window.startMs +
          envInt('BACKTEST_PRICE_TO_BEAT_LATENCY_MS', DEFAULT_PRICE_TO_BEAT_LATENCY_MS),
      }
      fulfilled.push(`polymarketPriceToBeat(openPrice=${meta.priceToBeat})`)
    } else {
      // No strike. Recording started per series, not globally (5m eth/sol/xrp
      // a month after everyone else) — a market before ITS series' epoch
      // simply predates recording: key stays absent, no error, exactly like
      // live before the first successful poll.
      const seriesEpochMs = gammaPriceToBeatEpochMs(slugSymbol, timeframeFromSlug(args.slug))
      if (window.startMs < seriesEpochMs) {
        console.log(
          `[backtest:feeds] priceToBeat requested but this series' recording starts ${new Date(seriesEpochMs).toISOString().slice(0, 10)} — key stays absent (slug=${args.slug})`,
        )
      } else if (meta === undefined) {
        throw new Error(
          `[backtest:feeds] internal: strategy requests priceToBeat but the producer did not resolve gamma metadata for slug=${args.slug}`,
        )
      } else if (window.endMs > Date.now() - FRESH_MARKET_GRACE_MS) {
        // Recently settled market: the pipeline legitimately hasn't caught up
        // yet (Telonex publishes its catalog daily, and the backfill's settled
        // gate waits 3h after window end), so "no strike" is expected, not an
        // error. Warn loudly and replay with the key absent — re-run after the
        // backfill catches up to get the strike fed.
        console.warn(
          `[backtest:feeds] priceToBeat requested but the market settled <${FRESH_MARKET_GRACE_MS / 3_600_000}h ago and the backfill pipeline hasn't caught up yet — key stays absent for this run (slug=${args.slug}); re-run after telonex:sync + telonex:sync-pricetobeat-and-final-price to feed the strike`,
        )
      } else if (meta === null || meta.syncedAtMs === null) {
        throw new Error(
          `[backtest:feeds] priceToBeat requested but telonex_markets has no backfilled Gamma metadata for slug=${args.slug}. ` +
            `Run: npm run telonex:sync-pricetobeat-and-final-price` +
            (meta === null ? ' (slug missing from catalog — run telonex:sync first)' : ''),
        )
      } else {
        // Post-epoch market with an empty strike = a genuine Polymarket-side
        // hole (verified: re-fetching returns empty; ~1.7k markets, listed in
        // docs/datasets/data-coverage.md). A strategy that DEPENDS on the
        // strike must not silently run without it — hard error, the market
        // lands in backtest_run_failures. Exclude these windows from batches
        // instead.
        throw new Error(
          `[backtest:feeds] MISSING priceToBeat for ${args.slug} — this market has no price-to-beat: ` +
            `Polymarket never recorded the strike for this window (known outage day, ~1.36% of markets since Apr 2026; ` +
            `outage list in docs/datasets/data-coverage.md). The data does not exist anywhere and cannot be fetched — ` +
            `exclude this market from the batch.`,
        )
      }
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
