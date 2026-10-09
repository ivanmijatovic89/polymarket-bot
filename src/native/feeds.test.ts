/**
 * Feed day files and price-to-beat availability (14 §4.1-§6.2, 21 §5.3, §9).
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  FEED_ENGINE_CONSTANTS,
  PRICE_TO_BEAT_FRESH_GRACE_MS,
  binancePairFor,
  chainlinkAssetFor,
  dayFileFixCommand,
  feedDayFiles,
  resolvePriceToBeatAvailability,
} from './feeds.js'
import { FEEDS_ALL, SLUG } from './testSupport.js'

const W = { startMs: 1_776_556_800_000, endMs: 1_776_557_700_000 }

describe('feed day files (14 F-12, F-20; 21 §9 step 3)', () => {
  it('lists Binance then Chainlink days covering the lookback, under the data root', () => {
    // spec: 14 §4.1 path, F-12 day set; §5.1 path, F-20 day set
    const files = feedDayFiles('/d', SLUG, W, FEEDS_ALL)
    assert.deepEqual(
      files.map((f) => [f.feed, f.symbol, f.day, f.path]),
      [
        [
          'binance_agg_trades',
          'BTCUSDT',
          '2026-04-18',
          '/d/binance/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2026-04-18.parquet',
        ],
        [
          'binance_agg_trades',
          'BTCUSDT',
          '2026-04-19',
          '/d/binance/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2026-04-19.parquet',
        ],
        [
          'chainlink_crypto_prices',
          'btcusd',
          '2026-04-18',
          path.join('/d/telonex/crypto_prices/btcusd/btcusd-crypto-prices-2026-04-18.parquet'),
        ],
        [
          'chainlink_crypto_prices',
          'btcusd',
          '2026-04-19',
          '/d/telonex/crypto_prices/btcusd/btcusd-crypto-prices-2026-04-19.parquet',
        ],
      ],
    )
    assert.deepEqual(feedDayFiles('/d', SLUG, W, null), [])
    assert.deepEqual(feedDayFiles('/d', SLUG, W, { polymarketPriceToBeat: { enabled: true } }), [])
  })

  it('excludes the next day for a window ending exactly at UTC midnight', () => {
    // spec: 14 F-12 ("the end day excluded at exact midnight")
    const w = { startMs: Date.UTC(2026, 5, 1, 23, 45), endMs: Date.UTC(2026, 5, 2) }
    const days = feedDayFiles('/d', 'btc-updown-15m-1780357500', w, {
      binanceWsSpotPrice: {},
    }).map((f) => f.day)
    assert.deepEqual(days, ['2026-06-01'])
  })

  it('gives a pre-coverage Chainlink request no day file (the engine reports pre_coverage)', () => {
    // spec: 14 F-19 coverage floor, F-20
    const w = { startMs: Date.UTC(2026, 2, 1), endMs: Date.UTC(2026, 2, 1, 0, 15) }
    assert.deepEqual(
      feedDayFiles('/d', 'btc-updown-15m-1772323200', w, { rtdsCryptoPrices: {} }),
      [],
    )
    // A window starting right at the floor clamps the lookback to the floor.
    const floor = FEED_ENGINE_CONSTANTS.chainlinkCoverageFromMs
    const at = feedDayFiles(
      '/d',
      'btc-updown-15m-1775088000',
      { startMs: floor, endMs: floor + 900_000 },
      { rtdsCryptoPrices: {} },
    )
    assert.deepEqual(
      at.map((f) => f.day),
      ['2026-04-02'],
    )
  })

  it('honors explicit feed symbols and names the fix command', () => {
    // spec: 14 §11.1 symbol resolution; 20 §4 (the message names the fix command)
    assert.equal(binancePairFor(SLUG, { binanceWsSpotPrice: { symbol: 'ethusdt' } }), 'ETHUSDT')
    assert.equal(binancePairFor(SLUG, { binanceWsSpotPrice: {} }), 'BTCUSDT')
    assert.equal(
      chainlinkAssetFor(SLUG, { rtdsCryptoPrices: { chainlinkSymbols: ['eth/usd'] } }),
      'ethusd',
    )
    assert.throws(() =>
      chainlinkAssetFor(SLUG, { rtdsCryptoPrices: { chainlinkSymbols: ['eth'] } }),
    )
    assert.match(
      dayFileFixCommand({ feed: 'binance_agg_trades', symbol: 'BTCUSDT' }),
      /binance:download-aggtrades-r2-to-local -- --pair BTCUSDT/,
    )
    assert.match(
      dayFileFixCommand({ feed: 'chainlink_crypto_prices', symbol: 'btcusd' }),
      /crypto-prices:download-r2-to-local -- --asset btcusd/,
    )
  })
})

describe('price-to-beat availability (14 §6.2; 21 §5.3)', () => {
  const asOf = W.endMs + 10 * 86_400_000
  const resolve = (
    gamma: Parameters<typeof resolvePriceToBeatAvailability>[0]['gamma'],
    over: Partial<Parameters<typeof resolvePriceToBeatAvailability>[0]> = {},
  ) =>
    resolvePriceToBeatAvailability({
      requested: true,
      slug: SLUG,
      window: W,
      gamma,
      asOfMs: asOf,
      ...over,
    }).priceToBeat

  it('is null when the strategy does not request it', () => {
    // spec: 14 §6.2 ("priceToBeat": null when not requested)
    assert.deepEqual(
      resolvePriceToBeatAvailability({
        requested: false,
        slug: SLUG,
        window: W,
        gamma: undefined,
        asOfMs: asOf,
      }),
      { priceToBeat: null },
    )
  })

  it('feeds a present strike regardless of the epoch', () => {
    // spec: 14 §6.2 row "strike present (always fed, regardless of epoch)"
    assert.deepEqual(resolve({ priceToBeat: 84000, syncedAtMs: 1 }), { status: 'fed' })
    const early = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 0, 1, 0, 15) }
    assert.deepEqual(resolve({ priceToBeat: 84000, syncedAtMs: 1 }, { window: early }), {
      status: 'fed',
    })
  })

  it('classifies a missing strike with the TS rules evaluated at asOfMs', () => {
    // spec: 14 §6.2 table (pre-epoch, 30 h grace, pipeline incomplete, upstream hole)
    const early = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 0, 1, 0, 15) }
    assert.equal(resolve(null, { window: early })?.status, 'absent_pre_series_epoch')
    assert.equal(
      resolve(null, { asOfMs: W.endMs + PRICE_TO_BEAT_FRESH_GRACE_MS - 1 })?.status,
      'absent_fresh_market_grace',
    )
    const missing = resolve(null)
    assert.equal(missing?.status, 'unavailable_pipeline_incomplete')
    assert.match(missing?.message ?? '', /telonex:sync/)
    assert.equal(
      resolve({ priceToBeat: null, syncedAtMs: null })?.status,
      'unavailable_pipeline_incomplete',
    )
    const hole = resolve({ priceToBeat: null, syncedAtMs: 5 })
    assert.equal(hole?.status, 'unavailable_upstream_hole')
    assert.ok(hole?.message)
    assert.throws(() => resolve(undefined), /did not resolve Gamma metadata/)
  })
})
