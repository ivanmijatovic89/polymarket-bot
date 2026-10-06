import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { OpeningReferenceTracker, inspectOpeningReference } from './openingReference.js'
import { CapturedMarketDispatcher, capturedMarketGapReasons } from './dispatcher.js'
import { requestedCapturedFeeds } from './feedState.js'
import type { CapturedEvent, MarketCoverage, RecordedMarket } from '../types.js'
import type { MarketTick } from '../../strategy/Strategy.js'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { runSingleMarket } from '../../backtest/runSingleMarket.js'
import { writeCapturedEvents } from '../storage/compactWriter.js'
import { digestFile } from '../storage/files.js'
import type { MarketManifest } from '../storage/manifest.js'
import { captureMarketMetadata } from './package.js'

const market: RecordedMarket = {
  slug: 'btc-updown-15m-1791144900',
  symbol: 'btc',
  timeframe: '15m',
  conditionId: 'market',
  tokenIds: ['up', 'down'],
  outcomes: ['Up', 'Down'],
  startMs: 1_791_144_900_000,
  endMs: 1_791_145_800_000,
  twapEnabled: true,
  twapLookbackSeconds: 60,
  resolutionSource: 'chainlink',
  rawJson: '{}',
}

const openingConfig: ExternalFeedsRequestConfig = {
  polymarketPriceToBeat: { enabled: true, source: 'chainlink-opening-twap' },
}

function event(
  sequence: number,
  source: CapturedEvent['source'],
  raw: unknown,
  receivedAtMs = market.startMs + sequence,
): CapturedEvent {
  return {
    schemaVersion: 4,
    captureId: 'capture',
    sessionId: 'session',
    sequence: String(sequence),
    eventId: `capture:${sequence}`,
    receivedAtMs,
    monotonicNs: String(sequence * 1000),
    source,
    connectionId: `${source}:connection`,
    eventType: source,
    sourceTimeMs: null,
    rawJson: JSON.stringify(raw),
    detailsJson: null,
  }
}

function point(fullAccuracyValue: string, timestamp = market.startMs) {
  return { timestamp, full_accuracy_value: fullAccuracyValue }
}

function twap(fullAccuracyValue: string, timestamp = market.startMs) {
  return {
    channel: 'price.crypto.twap',
    payload: {
      symbol: 'btcusd',
      source: 'chainlink',
      window_seconds: 60,
      ...point(fullAccuracyValue, timestamp),
    },
  }
}

function history(data: ReturnType<typeof point>[]) {
  return {
    channel: 'price.crypto.twap',
    snapshot: true,
    payload: { symbol: 'btcusd', source: 'chainlink', window_seconds: 60, data },
  }
}

function book() {
  return {
    event_type: 'book',
    market: market.conditionId,
    asset_id: 'up',
    timestamp: String(market.startMs),
    hash: 'book',
    bids: [{ price: '0.4', size: '10' }],
    asks: [{ price: '0.6', size: '20' }],
  }
}

function bootstrap(sequence: number, feeds: CapturedEvent[], sessionId = 'restart') {
  return {
    ...event(sequence, 'bootstrap', { kind: 'initial_state', market, feeds, books: [] }),
    sessionId,
  }
}

test('opening reference requires the exact source boundary and preserves receipt provenance', () => {
  const tracker = new OpeningReferenceTracker(market)
  tracker.accept(event(1, 'chainlink', twap('85410', market.startMs - 1)))
  tracker.accept(event(2, 'chainlink', twap('85412', market.startMs + 1)))
  assert.equal(tracker.snapshot()?.observation, undefined)

  const boundary = event(3, 'chainlink', twap('85411.123456789123456789'), market.startMs + 1900)
  tracker.accept(boundary)
  assert.deepEqual(tracker.snapshot()?.observation, {
    source: 'chainlink-opening-twap',
    symbol: 'BTC',
    sourceTimestampMs: market.startMs,
    windowSeconds: 60,
    openPrice: Number('85411.123456789123456789'),
    fullAccuracyValue: '85411.123456789123456789',
    receivedAtMs: boundary.receivedAtMs,
    eventId: boundary.eventId,
    sessionId: boundary.sessionId,
    connectionId: boundary.connectionId,
  })
  assert.equal(tracker.snapshot()?.comparison, 'waiting-for-website')
})

test('opening reference scans every history point independently of the latest TWAP price', async () => {
  const snapshot = event(
    1,
    'chainlink',
    history([
      point('99', market.startMs + 2000),
      point('10', market.startMs),
      point('8', market.startMs - 1000),
    ]),
    market.startMs + 2100,
  )
  const inspected = await inspectOpeningReference(market, [snapshot])
  assert.equal(inspected.state?.observation?.openPrice, 10)
  assert.equal(inspected.state?.observation?.receivedAtMs, market.startMs + 2100)
  assert.deepEqual(inspected.reasons, [])

  const dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: '',
    config: { ...openingConfig, chainlinkTwap: {} },
    onTick: () => {},
  })
  await dispatcher.accept(snapshot)
  assert.equal(dispatcher.snapshot().chainlinkTwap?.value, 99)
  assert.equal(dispatcher.snapshot().openingReference?.observation?.openPrice, 10)
})

test('wrong providers, symbols, durations and malformed TWAP frames cannot establish a reference', async () => {
  const valid = twap('10')
  const frames = [
    { ...valid, channel: 'price.crypto' },
    { ...valid, payload: { ...valid.payload, source: 'binance' } },
    { ...valid, payload: { ...valid.payload, symbol: 'ethusd' } },
    { ...valid, payload: { ...valid.payload, window_seconds: 30 } },
    { ...valid, payload: { ...valid.payload, full_accuracy_value: 'NaN' } },
    { ...valid, payload: { ...valid.payload, full_accuracy_value: '0' } },
    { ...valid, payload: { ...valid.payload, timestamp: String(market.startMs) } },
    { ...valid, payload: { ...valid.payload, source: undefined } },
    history([point('10'), point('bad', market.startMs + 1)]),
  ]
  for (const raw of frames) {
    const inspected = await inspectOpeningReference(market, [event(1, 'chainlink', raw)])
    assert.equal(inspected.state?.observation, undefined, JSON.stringify(raw))
    assert.ok(inspected.reasons.length > 0)
  }
  for (const descriptor of [
    { ...market, twapEnabled: false },
    { ...market, twapLookbackSeconds: 30 },
    { ...market, twapLookbackSeconds: null },
  ]) {
    const inspected = await inspectOpeningReference(descriptor, [event(1, 'chainlink', valid)])
    assert.equal(inspected.state?.observation, undefined)
    assert.ok(inspected.reasons.length > 0)
  }
})

test('opening reference follows the half-open receipt window rather than the source timestamp', async () => {
  const excluded = await inspectOpeningReference(market, [
    event(1, 'chainlink', twap('10'), market.startMs - 1),
    event(2, 'chainlink', twap('11'), market.endMs),
  ])
  assert.equal(excluded.state?.observation, undefined)
  assert.ok(excluded.reasons.length > 0)
  const included = await inspectOpeningReference(market, [
    event(1, 'chainlink', twap('10'), market.startMs),
    event(2, 'chainlink', twap('11'), market.endMs - 1),
  ])
  assert.equal(included.state?.observation?.openPrice, 11)
  assert.equal(included.state?.observation?.receivedAtMs, market.endMs - 1)
})

test('separate-frame corrections preserve full precision and ignore equivalent decimal spellings', async () => {
  const first = '85411.123456789123456781'
  const corrected = '85411.123456789123456782'
  assert.equal(Number(first), Number(corrected), 'fixture must expose a sub-double correction')
  const inspected = await inspectOpeningReference(market, [
    event(1, 'chainlink', twap(first)),
    event(2, 'chainlink', twap(`${first}00`)),
    event(3, 'chainlink', twap(corrected)),
  ])
  assert.equal(inspected.corrections, 1)
  assert.equal(inspected.state?.observation?.fullAccuracyValue, corrected)
  assert.equal(inspected.state?.observation?.eventId, 'capture:3')
  assert.deepEqual(inspected.reasons, [])
})

test('conflicting same-frame boundary points withhold the reference until an unambiguous frame', async () => {
  const tracker = new OpeningReferenceTracker(market)
  const first = event(1, 'chainlink', twap('10'))
  const conflict = event(2, 'chainlink', history([point('11'), point('12')]))
  const unrelated = event(3, 'chainlink', twap('100', market.startMs + 1))
  const recovery = event(4, 'chainlink', history([point('13.0'), point('13.00')]))
  tracker.accept(first)
  tracker.accept(conflict)
  assert.equal(tracker.snapshot()?.comparison, 'conflicting-twap')
  assert.ok(tracker.snapshot()?.conflict)
  assert.equal(tracker.snapshot()?.conflictCount, 1)
  tracker.accept(unrelated)
  assert.equal(tracker.snapshot()?.comparison, 'conflicting-twap')
  tracker.accept(recovery)
  assert.equal(tracker.snapshot()?.observation?.openPrice, 13)
  assert.equal(tracker.snapshot()?.comparison, 'waiting-for-website')
  assert.equal(tracker.snapshot()?.conflict, undefined)
  assert.equal(tracker.snapshot()?.conflictCount, 1)
  tracker.accept(event(5, 'price_to_beat', { openPrice: 13 }))
  assert.equal(tracker.snapshot()?.comparison, 'match')
  assert.equal(tracker.snapshot()?.conflictCount, 1)
  tracker.accept(bootstrap(6, []))
  assert.equal(tracker.snapshot()?.observation, undefined)
  const afterRestart = event(7, 'chainlink', twap('13'))
  tracker.accept(afterRestart)
  const freshTracker = new OpeningReferenceTracker(market)
  freshTracker.accept(bootstrap(6, []))
  freshTracker.accept(afterRestart)
  assert.deepEqual(tracker.snapshot(), freshTracker.snapshot())
  assert.equal(tracker.snapshot()?.conflictCount, 0)
  assert.equal(tracker.report().conflicts, 1)
  assert.ok(tracker.report().reasons.some((reason) => /conflicting boundary/.test(reason)))
  const inspected = await inspectOpeningReference(market, [first, conflict, unrelated, recovery])
  assert.equal(inspected.conflicts, 1)
  assert.ok(inspected.reasons.length > 0, 'recovery must not erase the earlier admission failure')
})

test('same-frame conflicts use full decimal precision even when JavaScript numbers compare equal', () => {
  const tracker = new OpeningReferenceTracker(market)
  const first = '85411.123456789123456781'
  const second = '85411.123456789123456782'
  assert.equal(Number(first), Number(second))
  tracker.accept(event(1, 'chainlink', history([point(first), point(second)])))
  assert.equal(tracker.snapshot()?.comparison, 'conflicting-twap')
  assert.ok(tracker.snapshot()?.conflict)
})

test('website comparison uses its observed numeric precision and cannot replace the TWAP reference', () => {
  const tracker = new OpeningReferenceTracker(market)
  const full = '85411.123456789123456789'
  tracker.accept(event(1, 'chainlink', twap(full)))
  tracker.accept(event(2, 'price_to_beat', { openPrice: Number(full) }))
  assert.equal(tracker.snapshot()?.comparison, 'match')
  tracker.accept(event(3, 'price_to_beat', { openPrice: 90000 }))
  assert.equal(tracker.snapshot()?.comparison, 'mismatch')
  assert.equal(tracker.snapshot()?.observation?.fullAccuracyValue, full)
  assert.deepEqual(tracker.snapshot()?.website, {
    openPrice: 90000,
    receivedAtMs: market.startMs + 3,
    eventId: 'capture:3',
  })
  tracker.accept(event(4, 'price_to_beat', { openPrice: null }))
  tracker.accept({
    ...event(5, 'price_to_beat', { openPrice: 123 }),
    detailsJson: JSON.stringify({ request: { httpStatus: 429 } }),
  })
  assert.equal(tracker.snapshot()?.website?.openPrice, 90000)
})

test('bootstrap clears prior references and restores only explicit validated captured feed rows', () => {
  const tracker = new OpeningReferenceTracker(market)
  tracker.accept(event(1, 'chainlink', twap('10')))
  tracker.accept(event(2, 'price_to_beat', { openPrice: 10 }))
  tracker.accept(bootstrap(3, []))
  assert.equal(tracker.snapshot()?.observation, undefined)
  assert.equal(tracker.snapshot()?.website, undefined)
  const restored = event(4, 'chainlink', twap('11'))
  tracker.accept(bootstrap(5, [restored], 'next-restart'))
  assert.equal(tracker.snapshot()?.observation?.openPrice, 11)
  assert.equal(tracker.snapshot()?.observation?.receivedAtMs, restored.receivedAtMs)
  assert.equal(tracker.snapshot()?.observation?.eventId, restored.eventId)
})

test('missing boundary evidence fails inspection even if ordinary TWAP observations are healthy', async () => {
  async function* frames() {
    yield event(1, 'chainlink', twap('10', market.startMs - 1000))
    yield event(2, 'chainlink', twap('11', market.startMs + 1000))
    yield event(3, 'price_to_beat', { openPrice: 10.5 })
  }
  const inspected = await inspectOpeningReference(market, frames())
  assert.equal(inspected.state?.observation, undefined)
  assert.equal(inspected.observations, 0)
  assert.ok(inspected.reasons.length > 0)
})

test('restart cannot make a previously observed reference survive without an actual bootstrap row', async () => {
  const inspected = await inspectOpeningReference(market, [
    event(1, 'chainlink', twap('10')),
    bootstrap(2, []),
    event(3, 'chainlink', twap('11', market.startMs + 1000)),
  ])
  assert.equal(inspected.state?.observation, undefined)
  assert.ok(inspected.reasons.length > 0)
})

test('derived PTB appears on subsequent ticks with provenance and never mutates earlier tick snapshots', async () => {
  const seen: Array<{ tick: MarketTick; snapshot: ExternalFeedsSnapshot }> = []
  let dispatcher: CapturedMarketDispatcher
  dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: 'capture.parquet',
    config: openingConfig,
    onTick: (tick) => {
      seen.push({ tick, snapshot: dispatcher.snapshotForTick(tick) })
    },
  })
  const receivedAtMs = market.startMs + 1500
  await dispatcher.accept(event(1, 'polymarket', book(), receivedAtMs))
  await dispatcher.accept(event(2, 'chainlink', twap('10'), receivedAtMs))
  assert.equal(seen.length, 1, 'TWAP observations must not introduce strategy ticks')
  await dispatcher.accept(event(3, 'polymarket', book(), receivedAtMs))
  await dispatcher.accept(event(4, 'price_to_beat', { openPrice: 12 }, receivedAtMs))
  await dispatcher.accept(event(5, 'polymarket', book(), receivedAtMs))
  await dispatcher.accept(event(6, 'chainlink', twap('11'), receivedAtMs + 1))
  await dispatcher.accept(event(7, 'polymarket', book(), receivedAtMs + 1))
  assert.deepEqual(
    seen.map(({ snapshot }) => snapshot.polymarketPriceToBeat?.openPrice),
    [undefined, 10, 10, 11],
  )
  assert.equal(seen[1]!.snapshot.polymarketPriceToBeat?.source, 'chainlink-opening-twap')
  assert.equal(seen[1]!.snapshot.polymarketPriceToBeat?.receivedAtMs, receivedAtMs)
  assert.equal(seen[1]!.snapshot.openingReference?.observation?.eventId, 'capture:2')
  assert.equal(seen[2]!.snapshot.websitePriceToBeat?.openPrice, 12)
  assert.equal(seen[2]!.snapshot.openingReference?.comparison, 'mismatch')
  assert.equal(dispatcher.snapshotForTick(seen[0]!.tick).polymarketPriceToBeat, undefined)
  assert.equal(dispatcher.snapshotForTick(seen[1]!.tick).polymarketPriceToBeat?.openPrice, 10)
})

test('website PTB remains the default and derived selection never falls back to website values', async () => {
  const configs: ExternalFeedsRequestConfig[] = [
    { polymarketPriceToBeat: { enabled: true } },
    { polymarketPriceToBeat: { enabled: true, source: 'website' } },
    openingConfig,
  ]
  const seen: ExternalFeedsSnapshot[][] = configs.map(() => [])
  const dispatchers = configs.map((config, index) => {
    const dispatcher = new CapturedMarketDispatcher({
      market,
      filePath: '',
      config,
      onTick: (tick) => {
        seen[index]!.push(dispatcher.snapshotForTick(tick))
      },
    })
    return dispatcher
  })
  for (const frame of [
    event(1, 'price_to_beat', { openPrice: 20 }),
    event(2, 'polymarket', book()),
    event(3, 'chainlink', twap('10')),
    event(4, 'polymarket', book()),
  ]) {
    await Promise.all(dispatchers.map((dispatcher) => dispatcher.accept(frame)))
  }
  assert.deepEqual(seen[0], seen[1])
  assert.deepEqual(
    seen[0]!.map((snapshot) => snapshot.polymarketPriceToBeat?.openPrice),
    [20, 20],
  )
  assert.equal(seen[0]![1]!.openingReference, undefined)
  assert.equal(seen[0]![1]!.websitePriceToBeat, undefined)
  assert.deepEqual(
    seen[2]!.map((snapshot) => snapshot.polymarketPriceToBeat?.openPrice),
    [undefined, 10],
  )
  assert.equal(seen[2]![0]!.websitePriceToBeat?.openPrice, 20)
})

test('dispatcher withholds conflicted derived prices and exposes recovery only after receipt', async () => {
  const seen: ExternalFeedsSnapshot[] = []
  let dispatcher: CapturedMarketDispatcher
  dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: '',
    config: openingConfig,
    onTick: (tick) => {
      seen.push(dispatcher.snapshotForTick(tick))
    },
  })
  for (const frame of [
    event(1, 'chainlink', twap('10')),
    event(2, 'polymarket', book()),
    event(3, 'chainlink', history([point('11'), point('12')])),
    event(4, 'polymarket', book()),
    event(5, 'chainlink', twap('13')),
    event(6, 'polymarket', book()),
  ]) {
    await dispatcher.accept(frame)
  }
  assert.deepEqual(
    seen.map((snapshot) => snapshot.polymarketPriceToBeat?.openPrice),
    [10, undefined, 13],
  )
  assert.equal(seen[1]!.openingReference?.comparison, 'conflicting-twap')
  assert.equal(seen[2]!.openingReference?.observation?.receivedAtMs, market.startMs + 5)
  assert.equal(seen[2]!.openingReference?.conflictCount, 1)
})

test('opening source requires TWAP coverage instead of website HTTP coverage', () => {
  assert.deepEqual([...requestedCapturedFeeds(openingConfig)].sort(), [
    'chainlink_twap',
    'polymarket',
  ])
  const coverage: MarketCoverage = {
    complete: false,
    startedAtMs: market.startMs,
    endedAtMs: market.endMs,
    missingInitialBook: false,
    warnings: [],
    gaps: [
      {
        feed: 'price_to_beat',
        startMs: market.startMs,
        endMs: market.startMs + 60_000,
        reason: 'HTTP 429',
        certainty: 'uncertain',
      },
    ],
  }
  assert.deepEqual(capturedMarketGapReasons(market, coverage, openingConfig), [])
  assert.deepEqual(
    capturedMarketGapReasons(market, coverage, { polymarketPriceToBeat: { enabled: true } }),
    ['price_to_beat: HTTP 429'],
  )
  assert.deepEqual(
    capturedMarketGapReasons(
      market,
      { ...coverage, gaps: [{ ...coverage.gaps[0]!, feed: 'chainlink_twap' }] },
      openingConfig,
    ),
    ['chainlink_twap: HTTP 429'],
  )
})

test('opening-reference bootstrap rejects future rows, foreign clocks and substituted market identity', () => {
  for (const feed of [
    { ...event(1, 'chainlink', twap('10')), captureId: 'another-capture' },
    event(1, 'chainlink', twap('10'), market.startMs + 100),
    event(10, 'chainlink', twap('10'), market.startMs + 1),
  ]) {
    const tracker = new OpeningReferenceTracker(market)
    assert.throws(() => tracker.accept(bootstrap(2, [feed])), /bootstrap/)
  }
  const tracker = new OpeningReferenceTracker(market)
  assert.throws(
    () =>
      tracker.accept(
        event(2, 'bootstrap', {
          kind: 'initial_state',
          market: { ...market, startMs: market.startMs - 1 },
          feeds: [event(1, 'chainlink', twap('10'))],
          books: [],
        }),
      ),
    /bootstrap/,
  )
})

async function runCapturedFixture(
  frames: CapturedEvent[],
  options: {
    allowGaps?: boolean
    gaps?: MarketCoverage['gaps']
    config?: ExternalFeedsRequestConfig
  } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opening-reference-test-'))
  try {
    const filePath = path.join(directory, 'events.parquet')
    await writeCapturedEvents(filePath, frames)
    const manifest: MarketManifest = {
      schemaVersion: 4,
      archiveLayout: 'symbol-timeframe',
      recordingId: 'opening-reference-test',
      market,
      coverage: {
        complete: !options.gaps?.length,
        startedAtMs: market.startMs,
        endedAtMs: market.endMs,
        missingInitialBook: false,
        warnings: [],
        gaps: options.gaps ?? [],
      },
      createdAtMs: market.startMs,
      finalizedAtMs: market.endMs,
      events: {
        key: `recorder-v4/btc/15m/${market.slug}/${'opening-reference-test'}/events-${(await digestFile(filePath)).sha256}.parquet`,
        ...(await digestFile(filePath)),
        rows: frames.length,
        firstSequence: frames[0]!.sequence,
        lastSequence: frames.at(-1)!.sequence,
      },
    }
    const seen: ExternalFeedsSnapshot[] = []
    const result = await runSingleMarket({
      idx: 0,
      filePath,
      slug: market.slug,
      marketMeta: captureMarketMetadata(manifest),
      marketResolution: { tokenMap: { UP: 'up', DOWN: 'down' }, outcome: 'UP' },
      strategyId: 'opening-reference-observer',
      strategyParams: {},
      inputMode: 'recorder-v4',
      order: 'recorded',
      timeDriven: false,
      latency: { delayMs: 0, jitterMs: 0 },
      machineId: 'test',
      commitSha: 'test',
      recorderV4: { manifest, ...(options.allowGaps ? { allowGaps: true } : {}) },
      strategyDefinition: {
        id: 'opening-reference-observer',
        schema: z.strictObject({}),
        create: () => ({
          plugins: [new ExternalFeedsRequestPlugin(options.config ?? openingConfig)],
          strategy: {
            name: 'opening-reference-observer',
            onAccountEvent: () => [],
            onMarketTick: (
              _tick: MarketTick,
              _portfolio: unknown,
              ctx?: { plugins?: Record<string, unknown> },
            ) => {
              seen.push(structuredClone(ctx?.plugins?.externalFeeds as ExternalFeedsSnapshot))
              return []
            },
          },
        }),
      },
    })
    return { result, seen }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('real backtest rejects missing boundary evidence and allows explicit outage replay without a fallback', async () => {
  const frames = [
    event(1, 'price_to_beat', { openPrice: 99 }),
    event(2, 'chainlink', twap('10', market.startMs + 1000)),
    event(3, 'polymarket', book()),
  ]
  const ordinary = await runCapturedFixture(frames)
  assert.equal(ordinary.result.skipReason, 'incomplete_capture')
  assert.equal(ordinary.result.eventsProcessed, 0)
  assert.equal(ordinary.seen.length, 0)
  assert.ok(
    ordinary.result.coverageReasons?.some((reason) => /opening observation missing/.test(reason)),
  )
  const outage = await runCapturedFixture(frames, { allowGaps: true })
  assert.equal(outage.result.eventsProcessed, 1)
  assert.equal(outage.seen[0]!.polymarketPriceToBeat, undefined)
  assert.equal(outage.seen[0]!.websitePriceToBeat?.openPrice, 99)
  const website = await runCapturedFixture(frames, {
    config: { polymarketPriceToBeat: { enabled: true } },
  })
  assert.equal(website.result.eventsProcessed, 1)
  assert.equal(website.seen[0]!.polymarketPriceToBeat?.openPrice, 99)
})

test('real backtest rejects earlier ambiguous boundary frames even after a later recovery', async () => {
  const frames = [
    event(1, 'chainlink', history([point('10'), point('11')])),
    event(2, 'polymarket', book()),
    event(3, 'chainlink', twap('12')),
    event(4, 'polymarket', book()),
  ]
  const ordinary = await runCapturedFixture(frames)
  assert.equal(ordinary.result.skipReason, 'incomplete_capture')
  assert.equal(ordinary.result.eventsProcessed, 0)
  assert.ok(ordinary.result.coverageReasons?.some((reason) => /conflicting boundary/.test(reason)))
  const outage = await runCapturedFixture(frames, { allowGaps: true })
  assert.deepEqual(
    outage.seen.map((snapshot) => snapshot.polymarketPriceToBeat?.openPrice),
    [undefined, 12],
  )
})

test('real backtest admits complete opening TWAP despite website rate limits without injecting final state into early ticks', async () => {
  const frames = [
    event(1, 'polymarket', book()),
    event(2, 'chainlink', twap('10')),
    event(3, 'polymarket', book()),
    event(4, 'price_to_beat', { openPrice: 20 }),
    event(5, 'polymarket', book()),
    event(6, 'chainlink', twap('11')),
    event(7, 'polymarket', book()),
  ]
  const { result, seen } = await runCapturedFixture(frames, {
    gaps: [
      {
        feed: 'price_to_beat',
        startMs: market.startMs,
        endMs: market.startMs + 4,
        reason: 'HTTP 429',
        certainty: 'uncertain',
      },
    ],
  })
  assert.equal(result.eventsProcessed, 4)
  assert.equal(result.skipReason, 'no_activity', 'the observer deliberately submits no orders')
  assert.deepEqual(
    seen.map((snapshot) => snapshot.polymarketPriceToBeat?.openPrice),
    [undefined, 10, 10, 11],
  )
  assert.equal(seen[2]!.openingReference?.comparison, 'mismatch')
  assert.equal(seen[3]!.polymarketPriceToBeat?.receivedAtMs, market.startMs + 6)
  assert.equal(seen[3]!.polymarketPriceToBeat?.eventId, 'capture:6')
})
