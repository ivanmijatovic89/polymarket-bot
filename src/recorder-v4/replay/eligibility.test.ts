import assert from 'node:assert/strict'
import test from 'node:test'
import { eligibleManifest } from './selectionFixtures.js'
import type { CapturedEvent } from '../types.js'
import { captureEligibilityReasons } from './eligibility.js'
import { inspectOpeningReference } from './openingReference.js'

test('eligibility ignores gaps in unused feeds and rejects even short required-feed outages', () => {
  const manifest = eligibleManifest()
  manifest.coverage.complete = false
  manifest.coverage.gaps = [
    {
      feed: 'binance_book_ticker',
      startMs: 2000,
      endMs: 2001,
      reason: 'disconnected',
      certainty: 'uncertain',
    },
  ]
  assert.deepEqual(captureEligibilityReasons(manifest, {}), [])
  assert.deepEqual(captureEligibilityReasons(manifest, { binanceBookTicker: {} }), [
    'binance_book_ticker: disconnected',
  ])
  assert.deepEqual(
    captureEligibilityReasons(manifest, { binanceBookTicker: {} }, { allowGaps: true }),
    [],
  )
})

test('resolution, empty capture and unsupported requests cannot be bypassed by outage replay', () => {
  const manifest = eligibleManifest()
  const config = { binanceWsSpotPrice: { symbol: 'ETHUSDT' } }
  manifest.events.rows = 0
  const reasons = captureEligibilityReasons(manifest, config, { allowGaps: true, resolution: null })
  assert.equal(reasons.length, 3)
  assert.ok(reasons.some((reason) => reason.startsWith('unsupported_feed:')))
  assert.ok(reasons.some((reason) => reason.startsWith('unresolved_outcome:')))
  assert.ok(reasons.some((reason) => reason.startsWith('empty_capture:')))
})

test('shortened packages are excluded normally and admitted only for explicit outage replay', () => {
  const manifest = eligibleManifest()
  manifest.coverage.endedAtMs--
  manifest.finalizedAtMs--
  manifest.coverage.complete = false
  manifest.coverage.gaps = [
    {
      feed: 'polymarket',
      startMs: manifest.coverage.endedAtMs,
      endMs: manifest.market.endMs,
      reason: 'shutdown',
      certainty: 'confirmed',
    },
  ]
  assert.deepEqual(captureEligibilityReasons(manifest, {}), ['polymarket: shutdown'])
  assert.deepEqual(captureEligibilityReasons(manifest, {}, { allowGaps: true }), [])
})

test('production bootstrap callback jitter is not treated as a recording outage', () => {
  const manifest = eligibleManifest(1_791_284_400_000)
  manifest.coverage.startedAtMs = manifest.market.startMs + 4
  assert.deepEqual(captureEligibilityReasons(manifest, {}), [])
  manifest.coverage.startedAtMs = manifest.market.startMs + 1_500
  manifest.coverage.complete = false
  manifest.coverage.gaps = [
    {
      feed: 'polymarket',
      startMs: manifest.market.startMs,
      endMs: manifest.coverage.startedAtMs,
      reason: 'recording_started_late',
      certainty: 'confirmed',
    },
  ]
  assert.deepEqual(captureEligibilityReasons(manifest, {}), ['polymarket: recording_started_late'])
})

test('PTB admission uses the requested source and never treats metadata as verified reference evidence', async () => {
  const manifest = eligibleManifest()
  const event: CapturedEvent = {
    schemaVersion: 4,
    captureId: 'capture',
    sessionId: 'session',
    sequence: '1',
    eventId: 'capture:1',
    receivedAtMs: 1_001,
    monotonicNs: '1',
    source: 'chainlink',
    connectionId: 'chainlink',
    eventType: 'price',
    sourceTimeMs: 1_000,
    rawJson: JSON.stringify({
      channel: 'price.crypto.twap',
      payload: {
        source: 'chainlink',
        symbol: 'btcusd',
        window_seconds: 60,
        timestamp: 1_000,
        full_accuracy_value: '60000',
      },
    }),
    detailsJson: null,
  }
  const reference = await inspectOpeningReference(manifest.market, [event])
  const opening = {
    polymarketPriceToBeat: { enabled: true, source: 'chainlink-opening-twap' as const },
  }
  assert.deepEqual(captureEligibilityReasons(manifest, opening), [
    'ptb_unverified: reference observations not inspected',
  ])
  assert.deepEqual(captureEligibilityReasons(manifest, opening, { reference }), [])
  assert.deepEqual(
    captureEligibilityReasons(
      manifest,
      { polymarketPriceToBeat: { enabled: true } },
      { reference },
    ),
    ['price_to_beat: website opening observation missing'],
  )
  const late = await inspectOpeningReference(manifest.market, [
    { ...event, receivedAtMs: manifest.market.endMs },
  ])
  assert.ok(
    captureEligibilityReasons(manifest, opening, { reference: late }).some((reason) =>
      reason.includes('exact opening observation missing'),
    ),
  )
})
