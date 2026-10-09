import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MarketTick, PortfolioSnapshot } from '../../strategy/Strategy.js'
import { externalFeedsRequest } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { EXERCISER_SCHEDULE_VERSION } from './engine-exerciser.js'
import {
  ConfigSchema,
  FEED_EXERCISER_ID,
  createFeedExerciser,
  definition,
} from './feed-exerciser.js'

const UP = 'up-token'
const DOWN = 'down-token'
const portfolio: PortfolioSnapshot = {
  nowMs: 0,
  positionsByAssetId: {},
  openOrdersByClientId: {},
  ordersByClientId: {},
  recentFills: [],
  marketByAssetId: {},
}
const ctx = { market: { upAssetId: UP, downAssetId: DOWN } } as never

function tick(eventType: string, ts: number): MarketTick {
  return {
    source: { kind: 'parquet', filePath: 'f', ingestSeq: 0n },
    msg: { event_type: eventType, market: 'm', timestamp: String(ts) },
    snapshot: {
      market: 'm',
      timestamp: ts,
      byAssetId: {
        [UP]: { bestBid: 0.5, bestAsk: 0.52 },
        [DOWN]: { bestBid: 0.47, bestAsk: 0.49 },
      },
    },
  } as unknown as MarketTick
}

describe('feed exerciser (60 §5.8, 14 V-3)', () => {
  it('params are {tickOnUpdate, trade, ta, chainlink}; only chainlink defaults (true); unknown keys fail', () => {
    assert.equal(definition.id, FEED_EXERCISER_ID)
    assert.deepEqual(ConfigSchema.parse({ tickOnUpdate: 'true', trade: 'false', ta: false }), {
      tickOnUpdate: true,
      trade: false,
      ta: false,
      chainlink: true,
    })
    assert.throws(() => ConfigSchema.parse({ trade: false, ta: false }))
    assert.throws(() =>
      ConfigSchema.parse({ tickOnUpdate: true, trade: false, ta: false, extra: 1 }),
    )
  })

  it('requests Binance, Chainlink (only with chainlink) and price to beat with tickOnUpdate per the param', () => {
    const on = createFeedExerciser(
      ConfigSchema.parse({ tickOnUpdate: true, trade: false, ta: false }),
    )
    assert.deepEqual(externalFeedsRequest(on), {
      binanceWsSpotPrice: { tickOnUpdate: true },
      rtdsCryptoPrices: { tickOnUpdate: true },
      polymarketPriceToBeat: { enabled: true },
    })
    const noCl = createFeedExerciser(
      ConfigSchema.parse({ tickOnUpdate: false, trade: false, ta: false, chainlink: false }),
    )
    assert.deepEqual(externalFeedsRequest(noCl), {
      binanceWsSpotPrice: { tickOnUpdate: false },
      polymarketPriceToBeat: { enabled: true },
    })
  })

  it('registers TimeWindowVolatility, DwellGate, TimeWindowGate, and TechnicalIndicators only with ta (D19)', () => {
    const ids = (ta: boolean) =>
      createFeedExerciser(
        ConfigSchema.parse({ tickOnUpdate: false, trade: false, ta }),
      ).plugins.map((p) => p.id)
    assert.deepEqual(ids(false), [
      'externalFeeds',
      'timeWindowVolatility',
      'dwellGate',
      'timeWindowGate',
    ])
    assert.deepEqual(ids(true), [
      'externalFeeds',
      'timeWindowVolatility',
      'dwellGate',
      'timeWindowGate',
      'technicalIndicators',
    ])
  })

  it('trade: false returns no intents on any tick (T15 checkpoint)', async () => {
    const { strategy } = createFeedExerciser(
      ConfigSchema.parse({ tickOnUpdate: true, trade: false, ta: false }),
    )
    for (let i = 0; i < 700; i++)
      assert.deepEqual(await strategy.onMarketTick(tick('price_change', i), portfolio, ctx), [])
  })

  it('trade: true runs the engine exerciser schedule on real ticks only (60 §5.1, §5.8)', async () => {
    assert.equal(EXERCISER_SCHEDULE_VERSION, 1)
    const { strategy } = createFeedExerciser(
      ConfigSchema.parse({ tickOnUpdate: true, trade: true, ta: false }),
    )
    let firstAt: number | null = null
    for (let i = 0; i < 60 && firstAt === null; i++) {
      // a synthetic tick between every real tick must not advance n
      await strategy.onMarketTick(tick('binance_agg_trade', 2 * i), portfolio, ctx)
      const out = await strategy.onMarketTick(tick('price_change', 2 * i + 1), portfolio, ctx)
      if (out.length > 0) {
        firstAt = i
        assert.equal(out[0]!.kind, 'place_limit')
        assert.equal((out[0] as { clientOrderId: string }).clientOrderId, 'x1')
      }
    }
    assert.equal(firstAt, 50)
  })
})
