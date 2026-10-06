import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LiveCapturedMarketStream,
  createLiveCapturedFeeds,
  type LiveCapturedFeedDependencies,
  resolveLiveFeedMode,
  resolveLiveTimeframe,
} from './liveCapturedFeeds.js'
import { CapturedMarketDispatcher } from '../../recorder-v4/replay/dispatcher.js'
import { captureMarketMetadata } from '../../recorder-v4/replay/package.js'
import type {
  CapturedEvent,
  RawFrame,
  RecordedMarket,
  RecorderTimeframe,
} from '../../recorder-v4/types.js'
import {
  ExternalFeedsRequestPlugin,
  type ExternalFeedsRequestConfig,
} from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { PluginSet } from '../../strategy/plugins/PluginSet.js'
import { StrategyRunner } from '../StrategyRunner.js'
import { OrderManager } from '../OrderManager.js'
import type { ExecutionAdapter } from '../OrderManager.js'
import type { GammaMarketMeta } from '../../polymarket/gammaMarketMeta.js'
import type { MarketTick, Strategy } from '../../strategy/Strategy.js'
import type { ExternalFeedsSnapshot } from './externalFeeds.js'

const start = 1_800_000
function market(timeframe: RecorderTimeframe, at = start): RecordedMarket {
  const slug = `btc-updown-${timeframe}-${at / 1000}`
  const conditionId = `condition-${at}`
  const tokenIds: [string, string] = [`up-${at}`, `down-${at}`]
  const raw = {
    slug,
    conditionId,
    clobTokenIds: JSON.stringify(tokenIds),
    outcomes: '["Up","Down"]',
    endDate: new Date(at + (timeframe === '5m' ? 300_000 : 900_000)).toISOString(),
    cryptoMarketConfig: { twapEnabled: true, twapLookbackSeconds: 60 },
    resolutionSource: 'https://chain.link',
  }
  return {
    slug,
    symbol: 'btc',
    timeframe,
    conditionId,
    tokenIds,
    outcomes: ['Up', 'Down'],
    startMs: at,
    endMs: Date.parse(raw.endDate),
    twapEnabled: true,
    twapLookbackSeconds: 60,
    resolutionSource: 'https://chain.link',
    rawJson: JSON.stringify(raw),
  }
}
function books(m: RecordedMarket, ts = m.startMs) {
  return m.tokenIds.map((asset_id) => ({
    event_type: 'book',
    market: m.conditionId,
    asset_id,
    timestamp: String(ts),
    hash: 'h',
    bids: [{ price: '0.4', size: '10' }],
    asks: [{ price: '0.6', size: '10' }],
  }))
}
const trade = (value: number, at = start) => ({
  stream: 'btcusdt@aggTrade',
  data: { e: 'aggTrade', s: 'BTCUSDT', a: at, p: String(value), T: at, q: '1' },
})
const quote = {
  stream: 'btcusdt@bookTicker',
  data: { s: 'BTCUSDT', u: 1, b: '99', B: '1', a: '101', A: '2' },
}
const chainlink = (value: number, at = start, twap = false) => ({
  channel: twap ? 'price.crypto.twap' : 'price.crypto',
  payload: {
    source: 'chainlink',
    symbol: 'btcusd',
    timestamp: at,
    full_accuracy_value: String(value),
    ...(twap ? { window_seconds: 60 } : {}),
  },
})

type Observation = {
  event: string
  ts: number
  received: number | undefined
  sequence: string
  frame: number | undefined
  feeds: ExternalFeedsSnapshot
  decision: 'buy' | 'wait'
  market: string | undefined
}
function dryStack(
  config: ExternalFeedsRequestConfig,
  snapshot: (tick?: MarketTick) => ExternalFeedsSnapshot,
) {
  let metadata: GammaMarketMeta | undefined
  const seen: Observation[] = []
  const build = () => {
    const request = new ExternalFeedsRequestPlugin(config)
    request.fulfill(snapshot)
    const pluginSet = new PluginSet()
    pluginSet.register(request)
    const strategy: Strategy = {
      name: 'v4-live-parity-test',
      onAccountEvent: () => [],
      async onMarketTick(tick, _portfolio, context) {
        // Yield as order/account work could: later observations must not leak in.
        await Promise.resolve()
        const feeds = context?.plugins?.externalFeeds as ExternalFeedsSnapshot
        const decision =
          feeds.binanceWsSpotPrice &&
          feeds.polymarketPriceToBeat &&
          feeds.binanceWsSpotPrice.value > feeds.polymarketPriceToBeat.openPrice
            ? 'buy'
            : 'wait'
        seen.push({
          event: tick.msg.event_type,
          ts: tick.snapshot.timestamp,
          received: tick.source.tsLocalMs,
          sequence: String(tick.source.ingestSeq),
          frame: tick.source.frameIndex,
          feeds,
          decision,
          market: context?.market?.slug,
        })
        return []
      },
    }
    return { strategy, pluginSet }
  }
  // The execution adapter is deliberately unavailable: these tests must never place an order.
  const runner = new StrategyRunner({
    ...build(),
    createStrategy: build,
    skipLateStartAfterMs: 0,
    getMarket: () => metadata,
    orderManager: new OrderManager({ dryRun: true, execution: {} as ExecutionAdapter }),
  })
  return {
    runner,
    seen,
    setMarket: (m: RecordedMarket) => {
      metadata = captureMarketMetadata({ market: m })
    },
  }
}

for (const timeframe of ['5m', '15m'] as const) {
  for (const source of ['website', 'chainlink-opening-twap'] as const) {
    test(`V4 ${timeframe} live dry-run and replay preserve feeds, decisions and rotation (${source})`, async () => {
      const first = market(timeframe)
      const second = market(timeframe, first.endMs)
      const config: ExternalFeedsRequestConfig = {
        binanceWsSpotPrice: { tickOnUpdate: true },
        binanceBookTicker: {},
        rtdsCryptoPrices: { chainlinkSymbols: ['btc/usd'], tickOnUpdate: true },
        chainlinkTwap: {},
        polymarketPriceToBeat: { enabled: true, source },
      }
      let now = start - 100
      let mono = 0
      const errors: Error[] = []
      const captures = new Map<string, CapturedEvent[]>()
      let live!: LiveCapturedMarketStream
      const stack = dryStack(config, (tick) => live.snapshotForTick(tick))
      live = new LiveCapturedMarketStream({
        config,
        clock: () => ({ receivedAtMs: now, monotonicNs: String(++mono) }),
        onMarket: stack.setMarket,
        onTick: (tick) => stack.runner.onMarketTick(tick),
        onFatal: (error) => errors.push(error),
        onObservation: (m, event) => {
          const rows = captures.get(m.slug) ?? []
          rows.push(event)
          captures.set(m.slug, rows)
        },
      })
      live.register(first)
      live.register(second)
      const emit = (feed: RawFrame['source'], raw: unknown, at: number, slug?: string) => {
        now = at
        live.onFrame({
          source: feed,
          connectionId: `${feed}-1`,
          rawJson: JSON.stringify(raw),
          stamp: { receivedAtMs: now, monotonicNs: String(++mono) },
          ...(slug ? { marketSlug: slug } : {}),
        })
      }
      emit('polymarket', books(first, start - 100), start - 100)
      emit('binance', trade(99), start - 50)
      emit('chainlink', chainlink(98), start - 40)
      emit('binance', quote, start - 30)
      emit('chainlink', chainlink(100, start, true), start + 1)
      emit('polymarket', books(first), start + 2)
      emit('price_to_beat', { openPrice: 100 }, start + 3, first.slug)
      emit('binance', trade(102), start + 4)
      emit('chainlink', chainlink(103, start + 5), start + 5)
      emit('polymarket', books(first), start + 6)
      now = start + 7
      live.onStatus({
        source: 'polymarket',
        connectionId: 'polymarket-1',
        kind: 'disconnected',
        stamp: { receivedAtMs: now, monotonicNs: String(++mono) },
        marketSlug: first.slug,
      })
      // A feed update during a disconnected book cannot invent a strategy tick.
      emit('binance', trade(104), start + 8)
      emit('polymarket', books(first), start + 9)
      emit('polymarket', books(second, second.startMs - 10), second.startMs - 10)
      emit('polymarket', books(second), second.startMs + 1)
      emit('chainlink', chainlink(110, second.startMs, true), second.startMs + 2)
      emit('price_to_beat', { openPrice: 110 }, second.startMs + 3, second.slug)
      emit('binance', trade(111, second.startMs + 4), second.startMs + 4)
      await live.flush()
      assert.deepEqual(errors, [])
      assert.ok(stack.seen.some((row) => row.decision === 'buy'))
      const secondRows = stack.seen.filter((row) => row.market === second.slug)
      assert.ok(secondRows.length > 0)
      assert.equal(
        secondRows[0]!.feeds.polymarketPriceToBeat,
        undefined,
        'old market PTB must not leak',
      )
      assert.ok(
        stack.seen.some((row) => row.frame === 1),
        'batched market child ordering is retained',
      )
      const replayed: Observation[] = []
      for (const m of [first, second]) {
        let replay!: CapturedMarketDispatcher
        const replayStack = dryStack(config, (tick) => replay.snapshotForTick(tick))
        replayStack.setMarket(m)
        replay = new CapturedMarketDispatcher({
          market: m,
          config,
          filePath: '/fixture.parquet',
          onTick: (tick) => replayStack.runner.onMarketTick(tick),
        })
        for (const event of captures.get(m.slug) ?? []) await replay.accept(event)
        replayed.push(...replayStack.seen)
      }
      assert.deepEqual(stack.seen, replayed)
      await live.stop()
    })
  }
}

test('V4 live queues fail closed on overflow and never continue with omitted observations', async () => {
  const errors: Error[] = []
  let ticks = 0
  const m = market('5m')
  const stream = new LiveCapturedMarketStream({
    config: {},
    maxPendingBytes: 1,
    clock: () => ({ receivedAtMs: start, monotonicNs: '1' }),
    onMarket() {},
    onTick() {
      ticks++
    },
    onFatal: (error) => errors.push(error),
  })
  stream.register(m)
  stream.onFrame({
    source: 'polymarket',
    connectionId: 'p',
    rawJson: JSON.stringify(books(m)),
    stamp: { receivedAtMs: start, monotonicNs: '1' },
  })
  await stream.flush()
  assert.equal(errors.length, 1)
  assert.match(errors[0]!.message, /queue exceeded/)
  assert.equal(ticks, 0)
  stream.advance()
  assert.equal(errors.length, 1)
})

test('V4 configuration is opt-in for existing strategies and rejects incompatible requests', () => {
  assert.equal(resolveLiveFeedMode(undefined, { binanceWsSpotPrice: {} }), 'legacy')
  assert.equal(resolveLiveFeedMode('recorder-v4', {}), 'recorder-v4')
  for (const config of [
    { binanceBookTicker: {} },
    { chainlinkTwap: {} },
    { polymarketPriceToBeat: { source: 'chainlink-opening-twap' } },
  ] satisfies ExternalFeedsRequestConfig[]) {
    assert.equal(resolveLiveFeedMode(undefined, config), 'recorder-v4')
    assert.throws(() => resolveLiveFeedMode('legacy', config), /requires recorder-v4/)
  }
  assert.throws(() => resolveLiveFeedMode('typo', {}), /TRADING_FEED_MODE/)
  assert.equal(resolveLiveTimeframe('5m', 'recorder-v4', 'btc'), '5m')
  assert.throws(() => resolveLiveTimeframe('5m', 'legacy', 'btc'), /requires/)
  assert.throws(() => resolveLiveTimeframe('15m', 'recorder-v4', 'eth'), /BTC only/)
  const stream = new LiveCapturedMarketStream({
    config: { rtdsCryptoPrices: { binanceSymbols: ['btcusdt'] } },
    onMarket() {},
    onTick() {},
    onFatal() {},
  })
  assert.throws(() => stream.register(market('5m')), /legacy RTDS Binance/)
})

test('live transport wiring starts only requested providers and stops discovery and all feeds', async () => {
  const m = market('5m')
  const next = market('5m', m.endMs)
  const started: string[] = []
  const stopped: string[] = []
  const subscriptions: string[][] = []
  const priceMarkets: string[] = []
  const errors: Error[] = []
  let discoverySignal: AbortSignal | undefined
  const feed = (name: string) => ({
    start: () => {
      started.push(name)
    },
    stop: () => {
      stopped.push(name)
    },
    reconnect() {},
    send: () => true,
    halt() {},
    connectionId: () => name,
  })
  const dependencies: LiveCapturedFeedDependencies = {
    discover: async (args) => {
      discoverySignal = args.signal
      return [m, next]
    },
    polymarket: () => ({
      ...feed('polymarket'),
      setMarkets(markets) {
        subscriptions.push(markets.map((m) => m.slug))
      },
    }),
    binance: () => feed('binance'),
    chainlink: (args) => {
      assert.equal(args.credentials.apiKey, 'fixture-key')
      return feed('chainlink')
    },
    priceToBeat: (args) => {
      priceMarkets.push(args.market.slug)
      return feed(`ptb:${args.market.slug}`)
    },
  }
  const runtime = createLiveCapturedFeeds(
    {
      timeframe: '5m',
      config: {
        binanceBookTicker: {},
        chainlinkTwap: {},
        polymarketPriceToBeat: { enabled: true, source: 'chainlink-opening-twap' },
      },
      credentials: { apiKey: 'fixture-key', secret: 'fixture-secret', passphrase: 'fixture-pass' },
      clock: () => ({ receivedAtMs: start, monotonicNs: '1' }),
      onMarket() {},
      onTick() {},
      onFatal: (err) => errors.push(err),
    },
    dependencies,
  )
  runtime.start()
  runtime.start()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(started.slice(0, 3), ['polymarket', 'binance', 'chainlink'])
  assert.deepEqual(
    priceMarkets,
    [m.slug, next.slug],
    'website comparison still runs for opening TWAP',
  )
  assert.deepEqual(subscriptions.at(-1), [m.slug, next.slug])
  await runtime.stop()
  assert.deepEqual(errors, [])
  assert.equal(stopped.length, 5)
  assert.ok(discoverySignal)
  assert.throws(() => runtime.start(), /cannot restart/)

  started.length = 0
  const justBooks = createLiveCapturedFeeds(
    { timeframe: '15m', config: {}, onMarket() {}, onTick() {}, onFatal() {} },
    { ...dependencies, discover: async () => [] },
  )
  justBooks.start()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await justBooks.stop()
  assert.deepEqual(started, ['polymarket'])
  assert.throws(
    () =>
      createLiveCapturedFeeds(
        {
          timeframe: '5m',
          config: { chainlinkTwap: {} },
          onMarket() {},
          onTick() {},
          onFatal() {},
        },
        dependencies,
      ),
    /CLOB API credentials/,
  )
})

test('stopping during discovery cannot resurrect subscriptions or PTB pollers', async () => {
  let finish!: (markets: RecordedMarket[]) => void
  let signal: AbortSignal | undefined
  let subscriptions = 0
  let prices = 0
  const runtime = createLiveCapturedFeeds(
    {
      timeframe: '5m',
      config: { polymarketPriceToBeat: { enabled: true } },
      onMarket() {},
      onTick() {},
      onFatal(error) {
        throw error
      },
    },
    {
      discover: (args) => {
        signal = args.signal
        return new Promise((resolve) => {
          finish = resolve
        })
      },
      polymarket: () => ({
        start() {},
        stop() {},
        reconnect() {},
        setMarkets() {
          subscriptions++
        },
      }),
      priceToBeat: () => {
        prices++
        return { start() {}, stop() {} }
      },
    },
  )
  runtime.start()
  await runtime.stop()
  assert.equal(signal?.aborted, true)
  finish([market('5m')])
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(subscriptions, 0)
  assert.equal(prices, 0)
})

test('a slow strategy keeps its market context and receipt-scoped snapshot across a queued rotation', async () => {
  const first = market('5m')
  const second = market('5m', first.endMs)
  let now = first.startMs
  let unblock!: () => void
  let entered!: () => void
  const pending = new Promise<void>((resolve) => {
    unblock = resolve
  })
  const firstTick = new Promise<void>((resolve) => {
    entered = resolve
  })
  let active = ''
  const seen: Array<{ slug: string; value: number | undefined }> = []
  const stream = new LiveCapturedMarketStream({
    config: { binanceWsSpotPrice: {} },
    clock: () => ({ receivedAtMs: now, monotonicNs: String(now) }),
    onMarket(m) {
      active = m.slug
    },
    onFatal(error) {
      throw error
    },
    async onTick(tick) {
      if (seen.length === 0) {
        entered()
        await pending
      }
      seen.push({ slug: active, value: stream.snapshotForTick(tick).binanceWsSpotPrice?.value })
    },
  })
  stream.register(first)
  stream.register(second)
  const send = (source: RawFrame['source'], payload: unknown) =>
    stream.onFrame({
      source,
      connectionId: source,
      rawJson: JSON.stringify(payload),
      stamp: { receivedAtMs: now, monotonicNs: String(now) },
    })
  send('binance', trade(100))
  send('polymarket', books(first))
  await firstTick
  now = second.startMs
  send('binance', trade(200, now))
  send('polymarket', books(second))
  assert.equal(active, first.slug)
  unblock()
  await stream.flush()
  assert.deepEqual(
    seen.map((row) => row.slug),
    [first.slug, first.slug, second.slug, second.slug],
  )
  assert.deepEqual(
    seen.map((row) => row.value),
    [100, 100, 200, 200],
  )
  await stream.stop()
})
