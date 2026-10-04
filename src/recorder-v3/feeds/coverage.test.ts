import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test, { type TestContext } from 'node:test'
import { setImmediate as settle } from 'node:timers/promises'
import type WebSocket from 'ws'
import { CaptureCoordinator } from '../coordinator.js'
import { CapturedMarketDispatcher, capturedMarketGapReasons } from '../replay/dispatcher.js'
import type {
  CapturedEvent,
  FeedCallbacks,
  FeedStatus,
  MarketCoverage,
  RawFrame,
  RecordedMarket,
} from '../types.js'
import { createBinanceFeed } from './binance.js'
import { createPriceToBeatFeed } from './priceToBeat.js'

const START = 1_800_000
const market: RecordedMarket = {
  slug: 'btc-updown-5m-1800',
  symbol: 'btc',
  timeframe: '5m',
  conditionId: 'market',
  tokenIds: ['up', 'down'],
  outcomes: ['Up', 'Down'],
  startMs: START,
  endMs: START + 300_000,
  twapEnabled: true,
  twapLookbackSeconds: 60,
  resolutionSource: null,
  rawJson: '{}',
}
const trade = (id = 1) => ({
  stream: 'btcusdt@aggTrade',
  data: { e: 'aggTrade', s: 'BTCUSDT', T: START, p: '85000', a: id, q: '1' },
})
const quote = (id = 1) => ({
  stream: 'btcusdt@bookTicker',
  data: { s: 'BTCUSDT', u: id, b: '84999', B: '1', a: '85000', A: '1' },
})

function captureHarness(now: () => number) {
  let sequence = 0
  let coverage: MarketCoverage | undefined
  const rows: CapturedEvent[] = []
  const statuses: FeedStatus[] = []
  const stamp = () => ({ receivedAtMs: now(), monotonicNs: String(now() * 1_000_000) })
  const coordinator = new CaptureCoordinator({
    now,
    monotonic: () => stamp().monotonicNs,
    finalizationGraceMs: 0,
    capture(frame, eventType = 'frame') {
      sequence++
      return {
        schemaVersion: 3,
        captureId: 'capture',
        sessionId: 'session',
        sequence: String(sequence),
        eventId: String(sequence),
        source: frame.source,
        connectionId: frame.connectionId,
        rawJson: frame.rawJson,
        ...frame.stamp,
        eventType,
        sourceTimeMs: null,
        detailsJson: frame.request ? JSON.stringify({ request: frame.request }) : null,
      }
    },
    sink: {
      append: (_slug, row) => rows.push(row),
      finalize: (_slug, value) => {
        coverage = value
      },
    },
  })
  coordinator.register(market)
  const frame = (source: RawFrame['source'], value: unknown) =>
    coordinator.ingest({
      source,
      connectionId: source,
      rawJson: JSON.stringify(value),
      stamp: stamp(),
    })
  const callbacks: FeedCallbacks = {
    onFrame: (event) => coordinator.ingest(event),
    onStatus(status) {
      statuses.push(status)
      coordinator.status(status)
    },
  }
  return {
    coordinator,
    frame,
    callbacks,
    stamp,
    statuses,
    rows,
    prime() {
      frame(
        'polymarket',
        market.tokenIds.map((asset_id) => ({
          event_type: 'book',
          asset_id,
          market: market.conditionId,
          timestamp: String(now()),
          bids: [{ price: '0.4', size: '10' }],
          asks: [{ price: '0.6', size: '10' }],
        })),
      )
      frame('binance', trade())
      frame('binance', quote())
      for (const channel of ['price.crypto', 'price.crypto.twap'])
        frame('chainlink', {
          channel,
          seq: 1,
          payload: {
            source: 'chainlink',
            symbol: 'btcusd',
            timestamp: now(),
            full_accuracy_value: '85000',
            window_seconds: 60,
          },
        })
    },
    finish() {
      coordinator.advance(market.endMs)
      assert.ok(coverage)
      return coverage
    },
  }
}

function binanceHarness(t: TestContext) {
  let now = START - 100
  const h = captureHarness(() => now)
  h.prime()
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number
    terminate(): void
  }
  socket.readyState = 1
  socket.terminate = () => {
    socket.emit('close', 1000)
  }
  const feed = createBinanceFeed({
    ...h.callbacks,
    clock: h.stamp,
    socketFactory: () => socket as unknown as WebSocket,
  })
  t.after(() => feed.stop())
  feed.start()
  socket.emit('open')
  now = START
  h.coordinator.advance()
  h.frame('price_to_beat', { openPrice: 85000 })
  return {
    ...h,
    send(raw: unknown) {
      now += 10
      socket.emit(
        'message',
        Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw)),
        false,
      )
    },
    control(kind: 'ping' | 'pong') {
      socket.emit(kind, Buffer.from('heartbeat'))
    },
  }
}

test('undecodable Binance frames survive capture and reject both required-feed backtests', async (t) => {
  for (const raw of ['{"stream":"btcusdt@bookTicker",broken', 'null', '[]', '42', '"text"']) {
    await t.test(raw, (subtest) => {
      const h = binanceHarness(subtest)
      h.send(raw)
      h.send(quote(3))
      h.send(trade(2))
      const coverage = h.finish()
      assert.equal(coverage.complete, false)
      assert.equal(coverage.gaps.length, 2)
      assert(
        coverage.gaps.every(
          (gap) => gap.reason === 'invalid_binance_json' && gap.certainty === 'uncertain',
        ),
      )
      assert.equal(
        coverage.gaps.find((gap) => gap.feed === 'binance_book_ticker')?.endMs,
        START + 20,
      )
      assert.equal(coverage.gaps.find((gap) => gap.feed === 'binance_agg_trade')?.endMs, START + 30)
      assert(h.rows.some((row) => row.rawJson === raw))
      for (const config of [{ binanceBookTicker: {} }, { binanceWsSpotPrice: {} }])
        assert.equal(capturedMarketGapReasons(market, coverage, config).length, 1)
      assert.deepEqual(capturedMarketGapReasons(market, coverage, {}), [])
    })
  }
})

test('recognizable malformed Binance envelopes invalidate their feed without inventing unrelated loss', async (t) => {
  for (const data of [undefined, null, [], 4, 'invalid']) {
    await t.test(JSON.stringify(data) ?? 'missing payload', (subtest) => {
      const h = binanceHarness(subtest)
      h.send({ stream: 'btcusdt@bookTicker', data })
      h.send(quote(3))
      const coverage = h.finish()
      assert.deepEqual(
        coverage.gaps.map((gap) => gap.feed),
        ['binance_book_ticker'],
      )
      assert.equal(capturedMarketGapReasons(market, coverage, { binanceBookTicker: {} }).length, 1)
      assert.deepEqual(capturedMarketGapReasons(market, coverage, { binanceWsSpotPrice: {} }), [])
    })
  }
})

test('unknown envelopes cannot disguise malformed subscribed prices as transport or control messages', async (t) => {
  for (const raw of [
    { stream: 'btcusdt@unknown', data: { s: 'BTCUSDT' } },
    { stream: 'btcusdt@unknown', data: {} },
    { stream: 'btcusdt@bookTicker', data: null, transport: 'pong' },
    { stream: 'btcusdt@bookTicker', result: null, id: 1 },
  ]) {
    await t.test(JSON.stringify(raw), (subtest) => {
      const h = binanceHarness(subtest)
      h.send(raw)
      h.send(quote(3))
      h.send(trade(2))
      const coverage = h.finish()
      assert.equal(coverage.complete, false)
      assert.equal(capturedMarketGapReasons(market, coverage, { binanceBookTicker: {} }).length, 1)
      assert(h.rows.some((row) => row.rawJson === JSON.stringify(raw)))
    })
  }
})

test('Binance control replies, protocol heartbeats and unrelated streams do not fabricate price gaps', (t) => {
  const h = binanceHarness(t)
  h.send({ result: null, id: 1 })
  h.send({ result: ['btcusdt@aggTrade', 'btcusdt@bookTicker'], id: 'subscriptions' })
  h.send({ result: true, id: null })
  h.send({ stream: 'ethusdt@bookTicker', data: { ...quote().data, s: 'ETHUSDT' } })
  h.control('ping')
  h.control('pong')
  assert.equal(h.finish().complete, true)
  assert.equal(h.statuses.filter((status) => status.kind === 'gap').length, 0)
})

test('disappearing PTB remains raw, retains its old receipt through outage replay and rejects ordinary admission', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START - 100 })
  const h = captureHarness(Date.now)
  h.prime()
  t.mock.timers.tick(100)
  h.coordinator.advance()
  const replies = [
    '{"openPrice":null}',
    '{"openPrice":85000}',
    '{"openPrice":null}',
    '{"openPrice":null}',
    '{"openPrice":85001}',
  ]
  let index = 0
  const feed = createPriceToBeatFeed({
    ...h.callbacks,
    market,
    clock: h.stamp,
    fetch: async () => new Response(replies[Math.min(index++, replies.length - 1)]),
  })
  t.after(() => feed.stop())
  feed.start()
  await settle()
  assert.equal(h.statuses.length, 0, 'initial publication delay does not invent an outage')
  for (const ms of [1_000, 30_000, 60_000, 120_000]) {
    t.mock.timers.tick(ms)
    await settle()
  }
  feed.stop()
  const coverage = h.finish()
  assert.deepEqual(coverage.gaps, [
    {
      feed: 'price_to_beat',
      startMs: START + 31_000,
      endMs: START + 211_000,
      reason: 'price_to_beat_unavailable',
      certainty: 'uncertain',
    },
  ])
  assert.deepEqual(capturedMarketGapReasons(market, coverage, {}), [])
  assert.deepEqual(
    capturedMarketGapReasons(market, coverage, { polymarketPriceToBeat: { enabled: true } }),
    ['price_to_beat: price_to_beat_unavailable'],
  )
  const dispatcher = new CapturedMarketDispatcher({
    market,
    filePath: 'fixture.parquet',
    config: { polymarketPriceToBeat: { enabled: true } },
    onTick() {},
  })
  const observed: Array<{ price: number | undefined; receipt: number | undefined }> = []
  for (const row of h.rows) {
    await dispatcher.accept(row)
    if (row.source === 'price_to_beat') {
      const value = dispatcher.snapshot().polymarketPriceToBeat
      observed.push({ price: value?.openPrice, receipt: value?.receivedAtMs })
    }
  }
  assert.deepEqual(observed, [
    { price: undefined, receipt: undefined },
    { price: 85000, receipt: START + 1_000 },
    { price: 85000, receipt: START + 1_000 },
    { price: 85000, receipt: START + 1_000 },
    { price: 85001, receipt: START + 211_000 },
  ])
})
