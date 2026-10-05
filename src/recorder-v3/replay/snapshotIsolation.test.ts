import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cloneExternalFeedsSnapshot,
  type ExternalFeedsSnapshot,
} from '../../trading/feeds/externalFeeds.js'
import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { MarketTick } from '../../strategy/Strategy.js'

// Require every nested optional field so schema additions also update this fixture.
type Complete<T> = T extends object ? { [K in keyof T]-?: Complete<NonNullable<T[K]>> } : T

function allFeeds(): Complete<ExternalFeedsSnapshot> {
  const point = { symbol: 'btc/usd', value: 100, tsMs: 1, receivedAtMs: 2 }
  const price = {
    symbol: 'BTC',
    eventStartTimeIso: '2026-10-05T00:00:00.000Z',
    endDateIso: '2026-10-05T00:15:00.000Z',
    openPrice: 100,
    apiTimestampMs: 1,
    receivedAtMs: 2,
    source: 'website' as const,
    fullAccuracyValue: '100.000000000000000001',
    sourceTimestampMs: 1,
    windowSeconds: 60,
    eventId: 'event',
  }
  return {
    binanceWsSpotPrice: { ...point, symbol: 'btcusdt' },
    binanceBookTicker: {
      symbol: 'btcusdt',
      updateId: '9007199254740993',
      bidPrice: '100.01',
      bidQuantity: '0.01',
      askPrice: '100.02',
      askQuantity: '0.02',
      receivedAtMs: 2,
    },
    chainlinkTwap: {
      ...point,
      source: 'chainlink',
      windowSeconds: 60,
      fullAccuracyValue: price.fullAccuracyValue,
    },
    rtdsPolymarketCryptoPrices: { binance: { ...point }, chainlink: { ...point } },
    polymarketPriceToBeat: { ...price },
    websitePriceToBeat: { ...price },
    openingReference: {
      observation: {
        source: 'chainlink-opening-twap',
        symbol: 'BTC',
        sourceTimestampMs: 1,
        windowSeconds: 60,
        openPrice: 100,
        fullAccuracyValue: price.fullAccuracyValue,
        receivedAtMs: 2,
        eventId: 'event',
        sessionId: 'session',
        connectionId: 'connection',
      },
      conflict: { fullAccuracyValue: '101', receivedAtMs: 3, eventId: 'conflict' },
      conflictCount: 1,
      website: { openPrice: 100, receivedAtMs: 2, eventId: 'website' },
      comparison: 'conflicting-twap',
    },
  }
}

function assertDetached(copy: unknown, original: unknown): void {
  if (original === null || typeof original !== 'object') return
  assert.notEqual(copy, original, 'every nested object must be independently owned')
  for (const key of Object.keys(original))
    assertDetached(
      (copy as Record<string, unknown>)[key],
      (original as Record<string, unknown>)[key],
    )
}

function tick(timestamp: number): MarketTick {
  return {
    source: { kind: 'live', attempt: 1 },
    msg: {
      event_type: 'book',
      asset_id: 'up',
      market: 'm',
      timestamp: String(timestamp),
      hash: '',
      bids: [],
      asks: [],
    },
    snapshot: { market: 'm', timestamp, byAssetId: {} },
  }
}

test('feed DTO copies match structuredClone and detach every nested object', () => {
  for (const value of [allFeeds(), {}, { binanceWsSpotPrice: allFeeds().binanceWsSpotPrice }]) {
    const copy = cloneExternalFeedsSnapshot(value)
    assert.deepEqual(copy, structuredClone(value))
    assertDetached(copy, value)
  }
})

test('custom feed copier captures before queued work and isolates ticks from provider and consumer mutations', () => {
  const provider = allFeeds()
  const expected = structuredClone(provider)
  const first = tick(1),
    second = tick(2)
  const plugin = new ExternalFeedsRequestPlugin({})
  plugin.fulfill(() => provider, cloneExternalFeedsSnapshot)
  plugin.captureMarketTick(first)
  provider.binanceWsSpotPrice.value = 200
  provider.openingReference.observation.openPrice = 200
  plugin.captureMarketTick(second)
  provider.openingReference.observation.openPrice = 300
  plugin.onMarketTick(first)
  const retained = plugin.snapshot() as ExternalFeedsSnapshot
  assert.deepEqual(retained, expected)
  retained.rtdsPolymarketCryptoPrices!.chainlink!.value = 999
  retained.openingReference!.observation!.openPrice = 999
  plugin.onMarketTick(second)
  const next = plugin.snapshot() as ExternalFeedsSnapshot
  assert.equal(next.binanceWsSpotPrice?.value, 200)
  assert.equal(next.openingReference?.observation?.openPrice, 200)
  assert.equal(next.rtdsPolymarketCryptoPrices?.chainlink?.value, 100)
  assert.equal(provider.rtdsPolymarketCryptoPrices.chainlink.value, 100)
  assert.equal(provider.openingReference.observation.openPrice, 300)
  plugin.reset()
  assert.equal(plugin.snapshot(), provider)
})

test('the default plugin copier still supports arbitrary structured-cloneable snapshots', () => {
  const provider = { date: new Date(1000), map: new Map([['price', { value: 100 }]]) }
  const plugin = new ExternalFeedsRequestPlugin({})
  plugin.fulfill(() => provider)
  const current = tick(1)
  plugin.captureMarketTick(current)
  provider.map.get('price')!.value = 200
  provider.date.setTime(2000)
  plugin.onMarketTick(current)
  assert.deepEqual(plugin.snapshot(), {
    date: new Date(1000),
    map: new Map([['price', { value: 100 }]]),
  })
})
