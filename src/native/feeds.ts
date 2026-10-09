/**
 * Feed inputs of a native job on the TS side: the day files the shim passes
 * as `market.feedFiles` (14 §4.1, §5.1; 21 §9 step 3) and the producer's
 * price-to-beat availability decision (14 §6.2, 21 §5.3). The binary
 * recomputes the day set itself and fails `data_missing` when one is absent;
 * the shim only resolves and checks files under the data root.
 */
import path from 'node:path'

import { utcDatesCovering } from '../binance/paths.js'
import { gammaPriceToBeatEpochMs } from '../polymarket/gammaEventMetadata.js'
import { symbolFromSlug, timeframeFromSlug } from '../polymarket/upDownSlugWindow.js'
import type { ExternalFeedsRequestConfig } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type {
  FeedAvailability,
  FeedId,
  PriceToBeatAvailability,
  Window,
} from './contract/generated.js'

/**
 * Engine feed constants of 14 F-47 (also exported by `describe` as
 * `engineConstants`): lookback 300,000 ms for both feeds and the Chainlink
 * coverage floor 2026-04-02T00:00:00Z (14 F-19).
 */
// D-PENDING: 20 §5.1 shows `engineConstants` without key names, so the shim cannot read them from describe yet; chose module constants equal to the 14 F-47 values (the runner exposes describe's engineConstants for a later equality check).
export const FEED_ENGINE_CONSTANTS = {
  binanceLookbackMs: 300_000,
  chainlinkLookbackMs: 300_000,
  chainlinkCoverageFromMs: Date.UTC(2026, 3, 2),
} as const

/** 30 h fresh-market grace for a missing strike (`wireBacktestExternalFeeds.ts:314`). */
export const PRICE_TO_BEAT_FRESH_GRACE_MS = 30 * 3_600_000

/** A resolved feed day file before the shim stats it. */
export interface FeedDayFile {
  feed: FeedId
  symbol: string
  day: string
  path: string
}

/**
 * Binance pair of a job (14 §11.1): `binanceWsSpotPrice.symbol` when set,
 * else `<slug symbol>usdt`, upper-cased like the dump files.
 */
export function binancePairFor(slug: string, req: ExternalFeedsRequestConfig): string {
  const explicit = req.binanceWsSpotPrice?.symbol
  const symbol = explicit ?? `${symbolFromSlug(slug) ?? ''}usdt`
  const pair = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]+$/.test(pair) || pair === 'USDT') {
    throw new Error(`cannot derive the Binance pair of ${slug} (symbol ${JSON.stringify(symbol)})`)
  }
  return pair
}

/**
 * Chainlink asset id of a job (14 §11.1): the first `chainlinkSymbols`
 * entry (`btc/usd` → `btcusd`) when set, else `<slug symbol>usd`.
 */
export function chainlinkAssetFor(slug: string, req: ExternalFeedsRequestConfig): string {
  const explicit = req.rtdsCryptoPrices?.chainlinkSymbols?.[0]
  if (explicit !== undefined) {
    const m = explicit
      .trim()
      .toLowerCase()
      .match(/^([a-z0-9]+)\/usd$/)
    if (!m) throw new Error(`unparsable Chainlink symbol ${JSON.stringify(explicit)}`)
    return `${m[1]}usd`
  }
  const sym = symbolFromSlug(slug)
  if (!sym) throw new Error(`cannot derive the Chainlink asset of ${slug}`)
  return `${sym}usd`
}

/**
 * The day files a job needs under `dataRoot` (21 §9 step 3), in feed then
 * day order: Binance days covering `[start - lookback, end)` (14 F-12) and
 * Chainlink days covering `[max(start - lookback, floor), end)` (14 F-20).
 * A Chainlink request on a window that starts before coverage yields no
 * Chainlink day: the engine fails it `data_defect: pre_coverage` (14 F-19),
 * which a missing-day error must not mask.
 */
export function feedDayFiles(
  dataRoot: string,
  slug: string,
  window: Window,
  req: ExternalFeedsRequestConfig | null,
): FeedDayFile[] {
  const out: FeedDayFile[] = []
  if (req?.binanceWsSpotPrice) {
    const pair = binancePairFor(slug, req)
    for (const day of utcDatesCovering(
      window.startMs - FEED_ENGINE_CONSTANTS.binanceLookbackMs,
      window.endMs,
    )) {
      out.push({
        feed: 'binance_agg_trades',
        symbol: pair,
        day,
        path: path.join(dataRoot, 'binance', 'aggTrades', pair, `${pair}-aggTrades-${day}.parquet`),
      })
    }
  }
  if (req?.rtdsCryptoPrices && window.startMs >= FEED_ENGINE_CONSTANTS.chainlinkCoverageFromMs) {
    const asset = chainlinkAssetFor(slug, req)
    const from = Math.max(
      window.startMs - FEED_ENGINE_CONSTANTS.chainlinkLookbackMs,
      FEED_ENGINE_CONSTANTS.chainlinkCoverageFromMs,
    )
    for (const day of utcDatesCovering(from, window.endMs)) {
      out.push({
        feed: 'chainlink_crypto_prices',
        symbol: asset,
        day,
        path: path.join(
          dataRoot,
          'telonex',
          'crypto_prices',
          asset,
          `${asset}-crypto-prices-${day}.parquet`,
        ),
      })
    }
  }
  return out
}

/** The worker-side command that pulls a missing day file (20 §4 "the message names the fix command"). */
export function dayFileFixCommand(f: Pick<FeedDayFile, 'feed' | 'symbol'>): string {
  return f.feed === 'binance_agg_trades'
    ? `npm run binance:download-aggtrades-r2-to-local -- --pair ${f.symbol}`
    : `npm run telonex:crypto-prices:download-r2-to-local -- --asset ${f.symbol}`
}

/**
 * The producer's `feedAvailability.priceToBeat` (14 §6.2), evaluated once at
 * `asOfMs` with the TS rules of `wireBacktestExternalFeeds.ts:283-344`, so
 * the binary never reads the wall clock (21 §5.3). `gamma` keeps the job's
 * tri-state: `undefined` = not resolved, `null` = catalog miss, object =
 * resolved.
 */
export function resolvePriceToBeatAvailability(args: {
  requested: boolean
  slug: string
  window: Window
  gamma: { priceToBeat: number | null; syncedAtMs: number | null } | null | undefined
  asOfMs: number
}): FeedAvailability {
  if (!args.requested) return { priceToBeat: null }
  const status = (s: PriceToBeatAvailability): FeedAvailability => ({ priceToBeat: s })
  const g = args.gamma
  if (g && g.priceToBeat !== null) {
    if (!Number.isFinite(g.priceToBeat)) {
      throw new Error(`price-to-beat of ${args.slug} is not finite (21 §18 N1)`)
    }
    return status({ status: 'fed' })
  }
  const epochMs = gammaPriceToBeatEpochMs(symbolFromSlug(args.slug), timeframeFromSlug(args.slug))
  if (args.window.startMs < epochMs) return status({ status: 'absent_pre_series_epoch' })
  if (g === undefined) {
    throw new Error(
      `internal: price-to-beat is requested but the producer did not resolve Gamma metadata for ${args.slug}`,
    )
  }
  if (args.window.endMs > args.asOfMs - PRICE_TO_BEAT_FRESH_GRACE_MS) {
    return status({ status: 'absent_fresh_market_grace' })
  }
  if (g === null || g.syncedAtMs === null) {
    return status({
      status: 'unavailable_pipeline_incomplete',
      message:
        `no backfilled Gamma metadata for ${args.slug}; run npm run telonex:sync-pricetobeat-and-final-price` +
        (g === null ? ' (slug missing from the catalog: run telonex:sync first)' : ''),
    })
  }
  return status({
    status: 'unavailable_upstream_hole',
    message: `Polymarket never recorded the price-to-beat of ${args.slug} (outage list in docs/datasets/data-coverage.md)`,
  })
}
