import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { CapturedMarketDispatcher, capturedMarketGapReasons } from './dispatcher.js'
import { applyCapturedFeed } from './feedState.js'
import { captureMarketMetadata, captureMarketResolution } from './package.js'
import type {
  CapturedEvent,
  RecordedMarket,
  MarketCoverage,
  ResolutionObservation,
} from '../types.js'
import { readCapturedEvents } from '../storage/parquet.js'
import { writeCapturedEvents } from '../storage/compactWriter.js'
import type { MarketManifest } from '../storage/manifest.js'
import { digestFile } from '../storage/files.js'
import { runSingleMarket, buildRunnerForMarket } from '../../backtest/runSingleMarket.js'
import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import type { MarketTick } from '../../strategy/Strategy.js'

const market: RecordedMarket = {
  slug: 'btc-updown-15m-1000',
  symbol: 'btc',
  timeframe: '15m',
  conditionId: 'm',
  tokenIds: ['up', 'down'],
  outcomes: ['Up', 'Down'],
  startMs: 1_000_000,
  endMs: 1_900_000,
  twapEnabled: true,
  twapLookbackSeconds: 60,
  resolutionSource: 'chainlink',
  rawJson: '{}',
}
const coverage: MarketCoverage = {
  complete: true,
  startedAtMs: market.startMs,
  endedAtMs: market.endMs,
  missingInitialBook: false,
  gaps: [],
  warnings: [],
}
const book = (asset = 'up', condition = 'm') => ({
  event_type: 'book',
  market: condition,
  asset_id: asset,
  timestamp: String(market.startMs),
  hash: 'h',
  bids: Array.from({ length: 25 }, (_, i) => ({
    price: String(0.4 - i * 0.01),
    size: String(10 + i),
  })),
  asks: [{ price: '0.6', size: '20' }],
})
const frame = (
  sequence: number,
  source: CapturedEvent['source'],
  raw: unknown,
  receivedAtMs = market.startMs,
): CapturedEvent => ({
  schemaVersion: 4,
  captureId: 'capture',
  sessionId: 'session',
  sequence: String(sequence),
  eventId: `capture:${sequence}`,
  receivedAtMs,
  monotonicNs: String(sequence * 1000),
  source,
  connectionId: source,
  eventType: source,
  sourceTimeMs: null,
  rawJson: JSON.stringify(raw),
  detailsJson: null,
})
const trade = (price: string) => ({
  stream: 'btcusdt@aggTrade',
  data: { e: 'aggTrade', s: 'BTCUSDT', T: market.startMs - 100, p: price, a: 1, q: '1' },
})
const chainlink = (value: number) => ({
  channel: 'price.crypto',
  payload: {
    symbol: 'btcusd',
    source: 'chainlink',
    timestamp: market.startMs - 50,
    value,
    full_accuracy_value: String(value),
  },
})

test('outage replay resets disconnected books without emitting control ticks or losing independent feed state', async () => {
  const seen: Array<{ assets: string[]; price: number | undefined }> = []
  let dispatcher: CapturedMarketDispatcher
  dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: '',
    config: { binanceWsSpotPrice: {} },
    onTick: (tick) => {
      seen.push({
        assets: Object.keys(tick.snapshot.byAssetId).sort(),
        price: dispatcher.snapshotForTick(tick).binanceWsSpotPrice?.value,
      })
    },
  })
  await dispatcher.accept(frame(1, 'binance', trade('100')))
  await dispatcher.accept(frame(2, 'polymarket', [book(), book('down')]))
  await dispatcher.accept(frame(3, 'control', { source: 'polymarket', kind: 'disconnected' }))
  assert.equal(seen.length, 2)
  await dispatcher.accept(frame(4, 'polymarket', book()))
  assert.deepEqual(seen.at(-1), { assets: ['up'], price: 100 })
  await dispatcher.accept(
    frame(5, 'control', { source: 'polymarket', kind: 'gap', marketSlug: 'another-market' }),
  )
  await dispatcher.accept(frame(6, 'polymarket', book('down')))
  assert.deepEqual(seen.at(-1), { assets: ['down', 'up'], price: 100 })
  assert.equal(seen.length, 4)
})

test('outage replay discards malformed market members atomically and resumes on replacement books', async () => {
  const seen: MarketTick[] = []
  const dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: '',
    config: {},
    onTick: (tick) => {
      seen.push(tick)
    },
  })
  await dispatcher.accept(frame(1, 'polymarket', [book(), book('down')]))
  const invalid = {
    event_type: 'price_change',
    market: 'm',
    timestamp: String(market.startMs),
    price_changes: [{ asset_id: 'up', price: '0.5', size: '99', side: 'BID' }],
  }
  await dispatcher.accept(frame(2, 'polymarket', [book(), invalid]))
  assert.equal(seen.length, 2, 'no member of an invalid market frame may emit a tick')
  await dispatcher.accept(frame(3, 'polymarket', book('down')))
  assert.deepEqual(Object.keys(seen.at(-1)!.snapshot.byAssetId), ['down'])
  await dispatcher.accept({ ...frame(4, 'polymarket', null), rawJson: '{"event_type":' })
  assert.equal(seen.length, 3)
  await dispatcher.accept(frame(5, 'polymarket', book()))
  assert.deepEqual(Object.keys(seen.at(-1)!.snapshot.byAssetId), ['up'])
  await dispatcher.accept(frame(6, 'polymarket', { ...invalid, price_changes: null }))
  await dispatcher.accept(frame(7, 'polymarket', [book(), book('down')]))
  assert.deepEqual(Object.keys(seen.at(-1)!.snapshot.byAssetId).sort(), ['down', 'up'])
  assert.ok(
    seen.every((tick) => !tick.snapshot.byAssetId.up?.asks.some((level) => level.price === 0.5)),
  )
})

test('same-clock mixed frames preserve receive order, full depth, and immutable tick feed state', async () => {
  const seen: Array<{ sequence: string; asset: string; value: number | undefined; depth: number }> =
    []
  let dispatcher: CapturedMarketDispatcher
  const retained: MarketTick[] = []
  dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: 'capture.parquet',
    config: { binanceWsSpotPrice: {} },
    onTick: (tick) => {
      retained.push(tick)
      seen.push({
        sequence: String(tick.source.kind === 'parquet' ? tick.source.ingestSeq : 0),
        asset: 'asset_id' in tick.msg ? tick.msg.asset_id : '',
        value: dispatcher.snapshotForTick(tick).binanceWsSpotPrice?.value,
        depth: tick.snapshot.byAssetId.up?.bids.length ?? 0,
      })
    },
  })
  const events = [
    frame(1, 'binance', trade('100')),
    frame(2, 'polymarket', [book(), book('down')]),
    frame(3, 'binance', trade('200')),
    frame(4, 'polymarket', book()),
  ]
  await Promise.all(events.map((event) => dispatcher.accept(event)))
  assert.deepEqual(seen, [
    { sequence: '2', asset: 'up', value: 100, depth: 25 },
    { sequence: '2', asset: 'down', value: 100, depth: 25 },
    { sequence: '4', asset: 'up', value: 200, depth: 25 },
  ])
  assert.equal(dispatcher.snapshotForTick(retained[0]).binanceWsSpotPrice?.value, 100)
  await assert.rejects(dispatcher.accept(events[0]!), /strictly increasing/)
})

test('history snapshot is available at receipt only and emits no historical synthetic ticks', async () => {
  const seen: Array<{ type: string; price?: number }> = []
  let dispatcher: CapturedMarketDispatcher
  dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: '',
    config: { rtdsCryptoPrices: { tickOnUpdate: true } },
    onTick: (tick) => {
      const price = dispatcher.snapshotForTick(tick).rtdsPolymarketCryptoPrices?.chainlink?.value
      seen.push({ type: tick.msg.event_type, ...(price === undefined ? {} : { price }) })
    },
  })
  await dispatcher.accept(frame(1, 'polymarket', [book(), book('down')]))
  await dispatcher.accept(
    frame(2, 'chainlink', {
      channel: 'price.crypto',
      snapshot: true,
      payload: {
        symbol: 'btcusd',
        source: 'chainlink',
        data: [
          { timestamp: market.startMs - 100, value: 2, full_accuracy_value: '2' },
          { timestamp: market.startMs - 200, value: 1, full_accuracy_value: '1' },
        ],
      },
    }),
  )
  await dispatcher.accept(frame(3, 'polymarket', book()))
  await dispatcher.accept(frame(4, 'chainlink', chainlink(3)))
  assert.deepEqual(seen, [
    { type: 'book' },
    { type: 'book' },
    { type: 'book', price: 2 },
    { type: 'chainlink_round', price: 3 },
  ])
})

test('bootstrap restores books and last observed feeds without fake ticks; PTB arrives later', async () => {
  const seen: ExternalFeedsSnapshot[] = []
  let dispatcher: CapturedMarketDispatcher
  dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: '',
    config: {
      binanceWsSpotPrice: { tickOnUpdate: true },
      polymarketPriceToBeat: { enabled: true },
    },
    onTick: (tick) => {
      seen.push(dispatcher.snapshotForTick(tick))
    },
  })
  await dispatcher.accept(
    frame(2, 'bootstrap', {
      kind: 'initial_state',
      market,
      feeds: [frame(1, 'binance', trade('10'), market.startMs - 100)],
      books: ['up', 'down'].map((asset) => ({
        rawJson: JSON.stringify(book(asset)),
        sequence: '1',
        observedAtMs: market.startMs - 10,
      })),
    }),
  )
  assert.equal(seen.length, 0)
  await dispatcher.accept(frame(3, 'polymarket', book()))
  await dispatcher.accept(frame(4, 'price_to_beat', { openPrice: 9 }))
  await dispatcher.accept(frame(5, 'binance', trade('11')))
  assert.equal(seen[0]!.binanceWsSpotPrice?.receivedAtMs, market.startMs - 100)
  assert.equal(seen[0]!.polymarketPriceToBeat, undefined)
  assert.equal(seen[1]!.polymarketPriceToBeat?.openPrice, 9)
})

test('simultaneous 5m/15m dispatchers retain independent market books and half-open boundaries', async () => {
  const short = {
    ...market,
    timeframe: '5m' as const,
    slug: 'btc-updown-5m-1000',
    conditionId: 'short',
    endMs: market.startMs + 300_000,
  }
  const counts = [0, 0]
  const dispatchers = [market, short].map(
    (descriptor, i) =>
      new CapturedMarketDispatcher({
        market: descriptor,
        filePath: '',
        config: {},
        onTick: () => {
          counts[i]! += 1
        },
      }),
  )
  for (const event of [
    frame(1, 'polymarket', [book(), book('down'), book('up', 'short'), book('down', 'short')]),
    frame(2, 'polymarket', [book(), book('up', 'short')], short.endMs),
  ]) {
    await Promise.all(dispatchers.map((dispatcher) => dispatcher.accept(event)))
  }
  assert.deepEqual(counts, [3, 2])
})

test('gap eligibility is feed-specific, including uncertain recovery intervals', () => {
  const broken = {
    ...coverage,
    complete: false,
    gaps: [
      {
        feed: 'chainlink_spot' as const,
        startMs: market.startMs + 1,
        endMs: market.startMs + 20,
        reason: 'restart recovery',
        certainty: 'uncertain' as const,
      },
    ],
  }
  assert.deepEqual(capturedMarketGapReasons(market, broken, {}), [])
  assert.deepEqual(capturedMarketGapReasons(market, broken, { rtdsCryptoPrices: {} }), [
    'chainlink_spot: restart recovery',
  ])
})

test('gap boundaries conservatively reject an uncertain instant inside the half-open market and unknown incompleteness', () => {
  assert.deepEqual(capturedMarketGapReasons(market, { ...coverage, complete: false }, {}), [
    'recording coverage is incomplete',
  ])
  for (const [startMs, endMs, expected] of [
    [market.startMs - 10, market.startMs, false],
    [market.startMs, market.startMs, true],
    [market.startMs + 10, market.startMs + 10, true],
    [market.endMs, market.endMs, false],
    [market.endMs, market.endMs + 10, false],
  ] as const) {
    const reasons = capturedMarketGapReasons(
      market,
      {
        ...coverage,
        complete: false,
        gaps: [
          {
            feed: 'polymarket',
            startMs,
            endMs,
            reason: 'uncertain instant',
            certainty: 'uncertain',
          },
        ],
      },
      {},
    )
    assert.equal(reasons.length > 0, expected, `${startMs}–${endMs}`)
  }
})

test('bootstrap cannot substitute another market identity, tokens, boundary, or reference contract', async () => {
  for (const changed of [
    { conditionId: 'other' },
    { tokenIds: ['other', 'down'] },
    { outcomes: ['Down', 'Up'] },
    { startMs: market.startMs - 1 },
    { endMs: market.endMs + 1 },
    { timeframe: '5m' },
    { twapEnabled: false },
    { twapLookbackSeconds: 30 },
    { resolutionSource: 'other' },
  ]) {
    const dispatcher = new CapturedMarketDispatcher({
      market,
      filePath: '',
      config: {},
      onTick: () => assert.fail('Bootstrap cannot tick'),
    })
    await assert.rejects(
      dispatcher.accept(
        frame(1, 'bootstrap', {
          kind: 'initial_state',
          market: { ...market, ...changed },
          feeds: [],
          books: [],
        }),
      ),
      /Invalid market bootstrap/,
    )
  }
})

test('a restart bootstrap resets state without ticks while repeated bootstrap in one session fails', async () => {
  let ticks = 0
  const dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: '',
    config: {},
    onTick: () => {
      ticks++
    },
  })
  const initial = frame(1, 'bootstrap', { kind: 'initial_state', market, feeds: [], books: [] })
  await dispatcher.accept(initial)
  await dispatcher.accept(frame(2, 'polymarket', [book(), book('down')]))
  await dispatcher.accept({
    ...frame(100, 'bootstrap', { kind: 'initial_state', market, feeds: [], books: [] }),
    sessionId: 'restart',
  })
  assert.equal(ticks, 2)
  assert.deepEqual(dispatcher.snapshot(), {})
  await assert.rejects(
    dispatcher.accept({
      ...frame(101, 'bootstrap', { kind: 'initial_state', market, feeds: [], books: [] }),
      sessionId: 'restart',
    }),
    /Duplicate bootstrap/,
  )
})

test('provider fallback and wrong TWAP duration never masquerade as required Chainlink data', () => {
  const payload = {
    symbol: 'btcusd',
    source: 'chainlink',
    timestamp: 10,
    full_accuracy_value: '123.123456789123456789',
    window_seconds: 60,
  }
  const update = applyCapturedFeed(
    {},
    frame(1, 'chainlink', { channel: 'price.crypto.twap', payload }),
    market,
  )
  assert.equal(update?.snapshot.chainlinkTwap?.fullAccuracyValue, payload.full_accuracy_value)
  assert.equal(
    applyCapturedFeed(
      {},
      frame(2, 'chainlink', {
        channel: 'price.crypto.twap',
        payload: { ...payload, source: 'binance' },
      }),
      market,
    ),
    null,
  )
  assert.equal(
    applyCapturedFeed(
      {},
      frame(3, 'chainlink', {
        channel: 'price.crypto.twap',
        payload: { ...payload, window_seconds: 30 },
      }),
      market,
    ),
    null,
  )
})

test('queued StrategyRunner ticks capture feed state before awaiting prior strategy work', async () => {
  let current = 1
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const seen: number[] = []
  const plugin = new ExternalFeedsRequestPlugin({ binanceWsSpotPrice: {} })
  plugin.fulfill(() => ({ value: current }))
  const { runner } = buildRunnerForMarket({
    strategyId: 'queue-test',
    strategyParams: {},
    latency: { delayMs: 0, jitterMs: 0 },
    strategyDefinition: {
      id: 'queue-test',
      schema: z.strictObject({}),
      create: () => ({
        plugins: [plugin],
        strategy: {
          name: 'queue-test',
          onAccountEvent: () => [],
          onMarketTick: async (_tick, _portfolio, ctx) => {
            seen.push((ctx?.plugins?.externalFeeds as { value: number }).value)
            if (seen.length === 1) await blocked
            return []
          },
        },
      }),
    },
  })
  const ticks: MarketTick[] = []
  const dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: '',
    config: {},
    onTick: (tick) => {
      ticks.push(tick)
    },
  })
  await dispatcher.accept(frame(1, 'polymarket', [book(), book('down')]))
  const first = runner.onMarketTick(ticks[0]!)
  current = 2
  const second = runner.onMarketTick(ticks[1]!)
  current = 3
  release()
  await Promise.all([first, second])
  assert.deepEqual(seen, [1, 2])
})

test('real mixed Parquet runs shared strategy pipeline, rejects corrupt files, and skips required gaps', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-replay-'))
  try {
    const filePath = path.join(directory, 'events.parquet')
    const events = [
      frame(1, 'binance', trade('100')),
      frame(2, 'polymarket', [book(), book('down')]),
      frame(3, 'binance', trade('200')),
      frame(4, 'polymarket', book()),
    ]
    await writeCapturedEvents(filePath, events)
    const restored = []
    for await (const event of readCapturedEvents(filePath)) restored.push(event)
    const semantic = (event: CapturedEvent) => ({
      ...event,
      rawJson: JSON.parse(event.rawJson) as unknown,
    })
    assert.deepEqual(restored.map(semantic), events.map(semantic))
    const manifest: MarketManifest = {
      schemaVersion: 4,
      archiveLayout: 'symbol-timeframe',
      recordingId: 'test',
      market,
      coverage,
      createdAtMs: market.startMs,
      finalizedAtMs: market.endMs,
      events: {
        key: `recorder-v4/btc/15m/${market.slug}/${'test'}/events-${(await digestFile(filePath)).sha256}.parquet`,
        ...(await digestFile(filePath)),
        rows: events.length,
        firstSequence: '1',
        lastSequence: '4',
      },
    }
    const seen: number[] = []
    const input = {
      idx: 0,
      filePath,
      slug: market.slug,
      marketMeta: captureMarketMetadata(manifest),
      marketResolution: { tokenMap: { UP: 'up', DOWN: 'down' }, outcome: 'UP' as const },
      strategyId: 'parity-test',
      strategyParams: {},
      inputMode: 'recorder-v4' as const,
      order: 'recorded' as const,
      timeDriven: false,
      latency: { delayMs: 0, jitterMs: 0 },
      machineId: 'test',
      commitSha: 'test',
      recorderV4: { manifest },
      strategyDefinition: {
        id: 'parity-test',
        schema: z.strictObject({}),
        create: () => ({
          plugins: [new ExternalFeedsRequestPlugin({ binanceWsSpotPrice: {} })],
          strategy: {
            name: 'parity-test',
            onAccountEvent: () => [],
            onMarketTick: (
              _tick: MarketTick,
              _portfolio: unknown,
              ctx?: { plugins?: Record<string, unknown> },
            ) => {
              seen.push(
                (ctx?.plugins?.externalFeeds as ExternalFeedsSnapshot).binanceWsSpotPrice!.value,
              )
              return []
            },
          },
        }),
      },
    }
    const result = await runSingleMarket(input)
    assert.equal(result.eventsProcessed, 3)
    assert.deepEqual(seen, [100, 100, 200])
    assert.equal(result.marketStats?.tradeCount, 0)
    const incomplete = { ...manifest, coverage: { ...coverage, missingInitialBook: true } }
    assert.equal(
      (await runSingleMarket({ ...input, recorderV4: { manifest: incomplete } })).skipReason,
      'incomplete_capture',
    )
    assert.equal(
      (await runSingleMarket({ ...input, recorderV4: { manifest: incomplete, allowGaps: true } }))
        .eventsProcessed,
      3,
    )
    await assert.rejects(
      runSingleMarket({
        ...input,
        recorderV4: {
          manifest: { ...manifest, events: { ...manifest.events, sha256: '0'.repeat(64) } },
        },
      }),
      /integrity/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('resolution is settlement-only and a later dispute revokes an earlier resolved observation', () => {
  const manifest = {
    market: {
      ...market,
      rawJson: JSON.stringify({
        question: 'BTC?',
        outcomePrices: '[1,0]',
        events: [{ eventMetadata: { finalPrice: 200 } }],
      }),
    },
  } as MarketManifest
  const resolved = {
    slug: market.slug,
    conditionId: market.conditionId,
    observedAtMs: 1,
    status: 'resolved',
    winningOutcome: 'Up',
    winningTokenId: 'up',
  } as ResolutionObservation
  assert.equal(captureMarketResolution(manifest, [resolved]).outcome, 'UP')
  assert.equal(
    captureMarketResolution(manifest, [
      resolved,
      { ...resolved, observedAtMs: 2, status: 'disputed' },
    ]).outcome,
    null,
  )
  const meta = captureMarketMetadata(manifest)
  assert.equal(meta.outcomePrices, undefined)
  assert.equal(meta.events, undefined)
})

test('retired or unknown queued input modes fail before reading files or loading feeds', async () => {
  for (const inputMode of ['recorder-v3', 'future-unknown']) {
    await assert.rejects(
      runSingleMarket({ inputMode } as unknown as Parameters<typeof runSingleMarket>[0]),
      /Unsupported backtest input mode/,
    )
  }
})
