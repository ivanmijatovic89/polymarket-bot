import assert from 'node:assert/strict'
import test from 'node:test'
import { CaptureCoordinator, RECORDER_FEEDS } from './coordinator.js'
import { parseRecorderMarket } from './markets.js'
import type {
  BootstrapPayload,
  CapturedEvent,
  MarketCoverage,
  RawFrame,
  RecordedMarket,
} from './types.js'

function market(timeframe: '5m' | '15m' = '5m', startMs = 1_000): RecordedMarket {
  return {
    slug: `btc-${timeframe}-${startMs}`,
    symbol: 'btc',
    timeframe,
    conditionId: `${timeframe}-${startMs}`,
    tokenIds: [`up-${timeframe}-${startMs}`, `down-${timeframe}-${startMs}`],
    outcomes: ['Up', 'Down'],
    startMs,
    endMs: startMs + (timeframe === '5m' ? 300_000 : 900_000),
    twapEnabled: true,
    twapLookbackSeconds: 60,
    resolutionSource: null,
    rawJson: '{}',
  }
}

function harness(markets: RecordedMarket[]) {
  let now = 900
  let sequence = 0n
  const rows = new Map<string, CapturedEvent[]>()
  const coverage = new Map<string, MarketCoverage>()
  const started = new Map<string, RecordedMarket>()
  let invalidFrames = 0
  const capture = (frame: RawFrame, eventType = 'frame'): CapturedEvent => {
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
      receivedAtMs: frame.stamp.receivedAtMs,
      monotonicNs: frame.stamp.monotonicNs,
      eventType,
      sourceTimeMs: null,
      detailsJson: frame.request ? JSON.stringify({ request: frame.request }) : null,
    }
  }
  const coordinator = new CaptureCoordinator({
    capture,
    now: () => now,
    monotonic: () => String(now * 1_000_000),
    onInvalidMarketFrame: () => {
      invalidFrames++
    },
    sink: {
      onStart: (value) => {
        started.set(value.slug, value)
      },
      append(slug, event) {
        const existing = rows.get(slug) ?? []
        if (existing.length)
          assert.ok(
            BigInt(event.sequence) > BigInt(existing[existing.length - 1]!.sequence),
            'each file must retain strict sequence order',
          )
        existing.push(event)
        rows.set(slug, existing)
      },
      finalize: (slug, value) => {
        coverage.set(slug, value)
      },
    },
  })
  for (const value of markets) coordinator.register(value)
  const stamp = (ms: number) => ({ receivedAtMs: ms, monotonicNs: String(ms * 1_000_000) })
  const frame = (source: RawFrame['source'], raw: unknown, ms = now, marketSlug?: string) => {
    now = ms
    return coordinator.ingest({
      source,
      connectionId: source,
      rawJson: JSON.stringify(raw),
      stamp: stamp(ms),
      ...(marketSlug ? { marketSlug } : {}),
    })
  }
  const advance = (ms: number) => {
    now = ms
    coordinator.advance(ms)
  }
  const book = (value: RecordedMarket, token: string, price = '0.4') => ({
    event_type: 'book',
    asset_id: token,
    market: value.conditionId,
    timestamp: '800',
    hash: '',
    bids: [{ price, size: '10' }],
    asks: [{ price: '0.6', size: '20' }],
  })
  const prime = () => {
    frame(
      'polymarket',
      markets.flatMap((value) => value.tokenIds.map((token) => book(value, token))),
    )
    frame('binance', {
      stream: 'btcusdt@aggTrade',
      data: { e: 'aggTrade', s: 'BTCUSDT', T: 800, p: '85000', a: 1, q: '1' },
    })
    frame('binance', {
      stream: 'btcusdt@bookTicker',
      data: { s: 'BTCUSDT', u: 1, b: '84999', B: '1', a: '85000', A: '1' },
    })
    for (const channel of ['price.crypto', 'price.crypto.twap'])
      frame('chainlink', {
        v: 1,
        channel,
        seq: 1,
        ts: 800,
        payload: {
          source: 'chainlink',
          symbol: 'btcusd',
          timestamp: 800,
          value: 85000,
          full_accuracy_value: '85000',
          window_seconds: 60,
        },
      })
    advance(1_000)
    for (const value of markets) frame('price_to_beat', { openPrice: 85000 }, 1_001, value.slug)
  }
  return {
    started,
    coordinator,
    rows,
    coverage,
    frame,
    advance,
    prime,
    stamp,
    book,
    invalidFrames: () => invalidFrames,
    setNow: (ms: number) => {
      now = ms
    },
  }
}

test('bootstrap retains only latest observed feed state and materialized books without fake history rows', () => {
  const m = market()
  const h = harness([m])
  h.frame(
    'polymarket',
    m.tokenIds.map((token) => h.book(m, token)),
    900,
  )
  let latest!: CapturedEvent
  for (let i = 0; i < 10; i++)
    latest = h.frame(
      'binance',
      {
        stream: 'btcusdt@aggTrade',
        data: { e: 'aggTrade', s: 'BTCUSDT', T: 800 + i, p: String(85000 + i), a: i, q: '1' },
      },
      910 + i,
    )
  h.advance(1_000)
  assert.equal(h.rows.get(m.slug)?.length, 1)
  const bootstrap = JSON.parse(h.rows.get(m.slug)![0]!.rawJson) as BootstrapPayload
  assert.equal(bootstrap.feeds.length, 1)
  assert.equal(bootstrap.feeds[0]?.sequence, latest.sequence)
  assert.equal(bootstrap.feeds[0]?.receivedAtMs, 919)
  assert.equal(bootstrap.books.length, 2)
  assert.equal(bootstrap.books[0]?.observedAtMs, 900)
  assert.equal(h.rows.get(m.slug)![0]?.eventType, 'initial_state')
})

test('multi-market array and shared feed fanout retain one identity while books stay market-specific', () => {
  const five = market()
  const fifteen = market('15m')
  const h = harness([five, fifteen])
  h.prime()
  const event = h.frame(
    'polymarket',
    [h.book(five, five.tokenIds[0], '0.3'), h.book(fifteen, fifteen.tokenIds[0], '0.2')],
    2_000,
  )
  for (const m of [five, fifteen]) assert.equal(h.rows.get(m.slug)?.at(-1)?.eventId, event.eventId)
  const one = h.frame('polymarket', h.book(five, five.tokenIds[1]), 2_001)
  assert.equal(h.rows.get(five.slug)?.at(-1)?.eventId, one.eventId)
  assert.notEqual(h.rows.get(fifteen.slug)?.at(-1)?.eventId, one.eventId)
  const shared = h.frame(
    'binance',
    {
      stream: 'btcusdt@aggTrade',
      data: { e: 'aggTrade', s: 'BTCUSDT', T: 2_002, p: '85100', a: 2, q: '1' },
    },
    2_002,
  )
  assert.equal(h.rows.get(five.slug)?.at(-1)?.eventId, shared.eventId)
  assert.equal(h.rows.get(fifteen.slug)?.at(-1)?.eventId, shared.eventId)
  assert.ok(h.coordinator.snapshot().every((state) => state.booksReady))
})

test('late aggregate-gap report spans the boundary, is feed-scoped and finalized only after grace', () => {
  const old = market()
  const next = market('5m', old.endMs)
  const h = harness([old])
  h.prime()
  h.coordinator.register(next)
  h.frame(
    'polymarket',
    next.tokenIds.map((token) => h.book(next, token)),
    old.endMs - 10,
  )
  h.advance(old.endMs)
  assert.equal(h.coverage.size, 0)
  const outside = h.frame(
    'binance',
    {
      stream: 'btcusdt@aggTrade',
      data: { e: 'aggTrade', s: 'BTCUSDT', T: old.endMs + 5, p: '85100', a: 10, q: '1' },
    },
    old.endMs + 5,
  )
  assert.ok(!h.rows.get(old.slug)?.some((row) => row.eventId === outside.eventId))
  h.coordinator.status({
    source: 'binance',
    connectionId: 'binance',
    kind: 'gap',
    stamp: h.stamp(old.endMs + 5),
    reason: 'sequence_missing',
    details: {
      feed: 'binance_agg_trade',
      startMs: old.endMs - 5,
      endMs: old.endMs + 5,
      certainty: 'confirmed',
    },
  })
  h.advance(old.endMs + 59_999)
  assert.equal(h.coverage.size, 0)
  h.advance(old.endMs + 60_000)
  const oldCoverage = h.coverage.get(old.slug)!
  assert.equal(oldCoverage.complete, false)
  assert.deepEqual(oldCoverage.gaps, [
    {
      feed: 'binance_agg_trade',
      startMs: old.endMs - 5,
      endMs: old.endMs,
      reason: 'sequence_missing',
      certainty: 'confirmed',
    },
  ])
  h.advance(next.endMs + 60_000)
  assert.ok(
    h.coverage
      .get(next.slug)
      ?.gaps.some(
        (gap) =>
          gap.feed === 'binance_agg_trade' &&
          gap.startMs === next.startMs &&
          gap.endMs === next.startMs + 5,
      ),
  )
  assert.ok(!oldCoverage.gaps.some((gap) => gap.feed === 'binance_book_ticker'))
})

test('event-loop stall status annotates retained old windows before delayed advance finalizes them', () => {
  const m = market()
  const h = harness([m])
  h.prime()
  const at = m.endMs + 120_000
  h.setNow(at)
  h.coordinator.status({
    source: 'chainlink',
    connectionId: 'chainlink',
    kind: 'gap',
    stamp: h.stamp(at),
    reason: 'event_loop_stall',
    details: { startMs: m.endMs - 1_000, endMs: at, certainty: 'uncertain' },
  })
  assert.equal(h.coverage.size, 0)
  h.coordinator.status({
    source: 'binance',
    connectionId: 'binance',
    kind: 'gap',
    stamp: h.stamp(at),
    reason: 'event_loop_stall',
    details: { startMs: m.endMs - 1_000, endMs: at, certainty: 'uncertain' },
  })
  h.advance(at)
  assert.equal(h.coverage.get(m.slug)?.complete, false)
  assert.equal(h.coverage.get(m.slug)?.gaps.length, 4)
  assert.ok(
    h.coverage
      .get(m.slug)
      ?.gaps.every((gap) => gap.endMs === m.endMs && gap.certainty === 'uncertain'),
  )
})

test('Polymarket disconnect invalidates bootstrap books until both replacement snapshots arrive', () => {
  const m = market()
  const h = harness([m])
  h.frame(
    'polymarket',
    m.tokenIds.map((token) => h.book(m, token)),
    900,
  )
  h.coordinator.status({
    source: 'polymarket',
    connectionId: 'polymarket',
    kind: 'disconnected',
    stamp: h.stamp(950),
  })
  h.advance(m.startMs)
  const bootstrap = JSON.parse(h.rows.get(m.slug)![0]!.rawJson) as BootstrapPayload
  assert.equal(bootstrap.books.length, 0)
  h.frame('polymarket', h.book(m, m.tokenIds[0]), 1_100)
  assert.equal(h.coordinator.snapshot()[0]?.booksReady, false)
  h.frame('polymarket', h.book(m, m.tokenIds[1]), 1_200)
  assert.equal(h.coordinator.snapshot()[0]?.booksReady, true)
  h.advance(m.endMs + 60_000)
  assert.equal(h.coverage.get(m.slug)?.missingInitialBook, true)
  assert.equal(h.coverage.get(m.slug)?.gaps.find((gap) => gap.feed === 'polymarket')?.endMs, 1_200)
})

test('malformed book payload is preserved before invalidating only its market state', () => {
  const five = market()
  const fifteen = market('15m')
  const h = harness([five, fifteen])
  h.prime()
  const raw = { event_type: 'price_change', market: five.conditionId, price_changes: null }
  const event = h.frame('polymarket', raw, 1_500)
  assert.ok(
    h.rows
      .get(five.slug)
      ?.some((row) => row.eventId === event.eventId && row.rawJson === JSON.stringify(raw)),
  )
  assert.equal(
    h.coordinator.snapshot().find((state) => state.slug === five.slug)?.booksReady,
    false,
  )
  assert.equal(
    h.coordinator.snapshot().find((state) => state.slug === fifteen.slug)?.booksReady,
    true,
  )
  assert.ok(!h.rows.get(fifteen.slug)?.some((row) => row.eventId === event.eventId))
  assert.equal(h.invalidFrames(), 1)
})

test('unknown order sides are retained as gaps and require fresh snapshots before restoration', () => {
  const m = market()
  const h = harness([m])
  h.prime()
  const change = (side: string) => ({
    event_type: 'price_change',
    market: m.conditionId,
    timestamp: '1500',
    price_changes: [{ asset_id: m.tokenIds[0], price: '0.5', size: '99', side }],
  })
  const invalid = h.frame('polymarket', change('BID'), 1_500)
  assert.ok(h.rows.get(m.slug)?.some((row) => row.eventId === invalid.eventId))
  assert.equal(h.coordinator.snapshot()[0]?.booksReady, false)
  assert.equal(h.invalidFrames(), 1)
  h.frame('polymarket', change('BUY'), 1_600)
  assert.equal(h.coordinator.snapshot()[0]?.booksReady, false)
  h.frame('polymarket', h.book(m, m.tokenIds[0]), 1_700)
  assert.equal(h.coordinator.snapshot()[0]?.booksReady, false)
  h.frame('polymarket', h.book(m, m.tokenIds[1]), 1_800)
  assert.equal(h.coordinator.snapshot()[0]?.booksReady, true)
  h.advance(m.endMs + 60_000)
  assert.equal(h.coverage.get(m.slug)?.complete, false)
  assert.deepEqual(h.coverage.get(m.slug)?.gaps, [
    {
      feed: 'polymarket',
      startMs: 1_500,
      endMs: 1_800,
      reason: 'invalid_market_payload',
      certainty: 'confirmed',
    },
  ])
})

test('undecodable Polymarket text invalidates all affected books while PONG remains harmless', () => {
  const five = market()
  const fifteen = market('15m')
  const h = harness([five, fifteen])
  h.prime()
  const ingest = (rawJson: string, at: number) =>
    h.coordinator.ingest({
      source: 'polymarket',
      connectionId: 'polymarket',
      rawJson,
      stamp: h.stamp(at),
    })
  ingest('PONG', 1_400)
  assert.equal(h.invalidFrames(), 0)
  const invalid = ingest('{"event_type":"price_change",', 1_500)
  assert.equal(h.invalidFrames(), 1)
  assert.ok(h.coordinator.snapshot().every((state) => !state.booksReady))
  for (const m of [five, fifteen])
    assert.ok(h.rows.get(m.slug)?.some((row) => row.eventId === invalid.eventId))
  h.advance(fifteen.endMs + 60_000)
  for (const m of [five, fifteen]) {
    assert.equal(h.coverage.get(m.slug)?.complete, false)
    assert.ok(h.coverage.get(m.slug)?.gaps.some((gap) => gap.reason === 'invalid_market_payload'))
  }
})

test('a changed market event schema in a shared array cannot silently produce complete coverage', () => {
  const five = market()
  const fifteen = market('15m')
  const h = harness([five, fifteen])
  h.prime()
  const event = h.frame(
    'polymarket',
    [
      h.book(five, five.tokenIds[0]),
      { event_type: 'price_change_v2', market: fifteen.conditionId, changes: [] },
    ],
    1_500,
  )
  assert.equal(h.invalidFrames(), 1)
  assert.equal(h.coordinator.snapshot().find((state) => state.slug === five.slug)?.booksReady, true)
  assert.equal(
    h.coordinator.snapshot().find((state) => state.slug === fifteen.slug)?.booksReady,
    false,
  )
  for (const m of [five, fifteen])
    assert.ok(h.rows.get(m.slug)?.some((row) => row.eventId === event.eventId))
  h.advance(fifteen.endMs + 60_000)
  assert.equal(h.coverage.get(five.slug)?.complete, true)
  assert.equal(h.coverage.get(fifteen.slug)?.complete, false)
})

test('post-end resolution and market metadata survive grace without recording subsequent price rows', () => {
  const m = market()
  const h = harness([m])
  h.prime()
  const resolution = h.frame(
    'polymarket',
    {
      event_type: 'market_resolved',
      market: m.conditionId,
      winning_asset_id: m.tokenIds[0],
      winning_outcome: 'Up',
    },
    m.endMs + 20_000,
  )
  const metadata = h.frame(
    'market_metadata',
    { umaResolutionStatus: 'resolved' },
    m.endMs + 20_001,
    m.slug,
  )
  const price = h.frame(
    'binance',
    {
      stream: 'btcusdt@aggTrade',
      data: { e: 'aggTrade', s: 'BTCUSDT', T: m.endMs + 20_002, p: '85001', a: 2, q: '1' },
    },
    m.endMs + 20_002,
  )
  assert.ok(h.rows.get(m.slug)?.some((row) => row.eventId === resolution.eventId))
  assert.ok(h.rows.get(m.slug)?.some((row) => row.eventId === metadata.eventId))
  assert.ok(!h.rows.get(m.slug)?.some((row) => row.eventId === price.eventId))
  h.advance(m.endMs + 60_000)
  assert.equal(h.coverage.get(m.slug)?.complete, true)
})

test('prestart metadata revisions are retained and bootstrap freezes the latest observed compatible rules', () => {
  const raw = {
    slug: 'btc-updown-5m-1',
    conditionId: 'condition-metadata',
    clobTokenIds: '["up","down"]',
    outcomes: '["Up","Down"]',
    endDate: new Date(301_000).toISOString(),
    cryptoMarketConfig: { twapEnabled: true, twapLookbackSeconds: 60 },
    resolutionSource: 'https://data.chain.link/streams/btc-usd-twap-60s-streams',
    feeSchedule: { rate: 0.01 },
    description: 'original rules',
  }
  const m = parseRecorderMarket(raw)
  const h = harness([m])
  const revised = { ...raw, feeSchedule: { rate: 0.07 }, description: 'updated rules' }
  const metadata = h.frame('market_metadata', revised, 950, m.slug)
  assert.equal(h.rows.get(m.slug)?.length, 1)
  assert.equal(h.rows.get(m.slug)?.[0]?.eventId, metadata.eventId)
  h.advance(1_000)
  const bootstrap = JSON.parse(h.rows.get(m.slug)![1]!.rawJson) as BootstrapPayload
  assert.deepEqual(JSON.parse(bootstrap.market.rawJson).feeSchedule, { rate: 0.07 })
  assert.equal(JSON.parse(bootstrap.market.rawJson).description, 'updated rules')
  assert.equal(h.started.get(m.slug)?.rawJson, bootstrap.market.rawJson)
  assert.equal(bootstrap.feeds.length, 0)
  assert.equal(h.rows.get(m.slug)?.filter((row) => row.eventType === 'initial_state').length, 1)
  const later = { ...raw, feeSchedule: { rate: 0.08 }, description: 'later rules' }
  h.frame('market_metadata', later, 1_010, m.slug)
  assert.deepEqual(JSON.parse(bootstrap.market.rawJson).feeSchedule, { rate: 0.07 })
  const bad = { ...revised, cryptoMarketConfig: { twapEnabled: true, twapLookbackSeconds: 30 } }
  assert.throws(() => h.frame('market_metadata', bad, 1_020, m.slug), /Unsupported TWAP/)
  assert.ok(h.rows.get(m.slug)?.at(-1)?.rawJson.includes('"twapLookbackSeconds":30'))
  assert.throws(
    () => h.frame('market_metadata', { ...revised, conditionId: 'different' }, 1_030, m.slug),
    /identity changed/,
  )
  assert.throws(
    () =>
      h.frame(
        'market_metadata',
        { ...revised, resolutionSource: 'https://pyth.network/BTCUSD' },
        1_040,
        m.slug,
      ),
    /Unsupported reference-price provider/,
  )
})

test('a pre-registered window skipped entirely by a pause finalizes as missing without fake ticks', () => {
  const m = market()
  const h = harness([m])
  h.frame(
    'polymarket',
    m.tokenIds.map((token) => h.book(m, token)),
    900,
  )
  h.advance(m.endMs + 120_000)
  const coverage = h.coverage.get(m.slug)!
  assert.equal(coverage.complete, false)
  assert.equal(coverage.missingInitialBook, true)
  assert.equal(coverage.gaps.length, RECORDER_FEEDS.length)
  assert.ok(
    coverage.gaps.every(
      (gap) =>
        gap.startMs === m.startMs && gap.endMs === m.endMs && gap.reason === 'market_window_missed',
    ),
  )
  assert.ok(h.rows.get(m.slug)?.every((event) => event.source === 'control'))
  h.coordinator.prune()
  assert.deepEqual(h.coordinator.snapshot(), [])
})
