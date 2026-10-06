import assert from 'node:assert/strict'
import test from 'node:test'
import { wireBacktestExternalFeeds } from '../backtest/feeds/wireBacktestExternalFeeds.js'
import { ConfigSchema, createStrategy } from '../strategies/readExternalFeedsExample.v1.js'
import {
  assertLegacyPriceToBeatSource,
  ExternalFeedsRequestPlugin,
  type ExternalFeedsRequestConfig,
} from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { PluginSet } from '../strategy/plugins/PluginSet.js'
import type { MarketTick, PortfolioSnapshot } from '../strategy/Strategy.js'
import type { ExternalFeedsSnapshot } from './feeds/externalFeeds.js'

function tick(timestamp: number): MarketTick {
  return {
    source: { kind: 'parquet', filePath: '/fixture.parquet', ingestSeq: 1n, tsLocalMs: timestamp },
    msg: { event_type: 'price_change' } as MarketTick['msg'],
    snapshot: { market: 'fixture', timestamp, byAssetId: {} },
  }
}

test('legacy runtime guard accepts website defaults and explicitly rejects opening TWAP', () => {
  for (const runtime of ['trading-bot', 'historical-backtest'] as const) {
    for (const config of [
      undefined,
      {},
      { polymarketPriceToBeat: { enabled: true } },
      { polymarketPriceToBeat: { enabled: true, source: 'website' } },
    ] satisfies Array<ExternalFeedsRequestConfig | undefined>) {
      assert.doesNotThrow(() => assertLegacyPriceToBeatSource(config, runtime))
    }
    for (const enabled of [true, false, undefined]) {
      assert.throws(
        () =>
          assertLegacyPriceToBeatSource(
            {
              polymarketPriceToBeat: {
                ...(enabled !== undefined ? { enabled } : {}),
                source: 'chainlink-opening-twap',
              },
            },
            runtime,
          ),
        /chainlink-opening-twap requires --input-mode recorder-v4/,
      )
    }
  }
})

test('historical backtest refuses opening TWAP before reading unrelated data or Gamma fallback', async () => {
  const request = new ExternalFeedsRequestPlugin({
    binanceWsSpotPrice: {},
    rtdsCryptoPrices: {},
    polymarketPriceToBeat: { enabled: true, source: 'chainlink-opening-twap' },
  })
  const pluginSet = new PluginSet()
  pluginSet.register(request)
  await assert.rejects(
    wireBacktestExternalFeeds({
      pluginSet,
      slug: 'btc-updown-15m-1791144900',
      gammaPriceToBeat: { priceToBeat: 85_412.32, syncedAtMs: 1_791_146_000_000 },
    }),
    /historical-backtest.*chainlink-opening-twap requires --input-mode recorder-v4/,
  )
  assert.equal(request.snapshot(), undefined)
})

test('historical website selection preserves Gamma-backed price and availability semantics', async (t) => {
  t.mock.method(console, 'log', () => undefined)
  const startMs = 1_791_144_900_000
  for (const source of [undefined, 'website'] as const) {
    const request = new ExternalFeedsRequestPlugin({
      polymarketPriceToBeat: { enabled: true, ...(source ? { source } : {}) },
    })
    const pluginSet = new PluginSet()
    pluginSet.register(request)
    await wireBacktestExternalFeeds({
      pluginSet,
      slug: 'btc-updown-15m-1791144900',
      gammaPriceToBeat: { priceToBeat: 85_412.32, syncedAtMs: startMs + 1_000_000 },
    })
    pluginSet.onMarketTick(tick(startMs - 1))
    assert.equal((request.snapshot() as ExternalFeedsSnapshot).polymarketPriceToBeat, undefined)
    pluginSet.onMarketTick(tick(startMs + 900_000))
    const snapshot = request.snapshot() as ExternalFeedsSnapshot
    assert.equal(snapshot.polymarketPriceToBeat?.openPrice, 85_412.32)
    assert.equal(snapshot.polymarketPriceToBeat?.source, undefined)
    assert.equal(snapshot.openingReference, undefined)
  }
})

test('example strategy source is strict, opt-in, and visible when absent or observed', (t) => {
  assert.equal(ConfigSchema.parse({}).priceToBeatSource, 'website')
  assert.equal(ConfigSchema.safeParse({ priceToBeatSource: 'nearest-twap' }).success, false)
  assert.equal(ConfigSchema.safeParse({ priceToBeatSource: 'website', typo: true }).success, false)
  const logs: string[] = []
  t.mock.method(console, 'log', (message: string) => logs.push(message))
  const { strategy, plugins } = createStrategy(
    ConfigSchema.parse({ priceToBeatSource: 'chainlink-opening-twap', logEveryMs: 1 }),
  )
  assert.deepEqual(plugins[0]?.config.polymarketPriceToBeat, {
    enabled: true,
    source: 'chainlink-opening-twap',
  })
  const portfolio = {} as PortfolioSnapshot
  assert.deepEqual(strategy.onMarketTick(tick(1_000), portfolio, { plugins: {} }), [])
  assert.match(logs[0]!, /priceToBeatRequestedSource=chainlink-opening-twap/)
  assert.match(logs[0]!, /priceToBeatSource=unavailable/)
  const feeds: ExternalFeedsSnapshot = {
    polymarketPriceToBeat: {
      source: 'chainlink-opening-twap',
      symbol: 'BTC',
      openPrice: 85_412.32,
      eventStartTimeIso: '2026-10-04T20:15:00.000Z',
      endDateIso: '2026-10-04T20:30:00.000Z',
      receivedAtMs: 1_500,
    },
    openingReference: { comparison: 'waiting-for-website' },
  }
  assert.deepEqual(
    strategy.onMarketTick(tick(2_000), portfolio, { plugins: { externalFeeds: feeds } }),
    [],
  )
  assert.match(logs[1]!, /priceToBeatSource=chainlink-opening-twap/)
  assert.match(logs[1]!, /priceToBeatComparison=waiting-for-website/)
})
