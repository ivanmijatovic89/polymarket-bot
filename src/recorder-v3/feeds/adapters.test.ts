import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocketServer, type WebSocket } from 'ws'
import type { FeedStatus, RawFrame, RecordedMarket } from '../types.js'
import { candidateBtcSlugs, discoverBtcMarkets, parseRecorderMarket } from '../markets.js'
import { createBinanceFeed } from './binance.js'
import { createPolyBoltFeed } from './polybolt.js'
import { createPolymarketFeed } from './polymarket.js'
import { createPriceToBeatFeed, priceToBeatUrl } from './priceToBeat.js'
import { createSocketTransport } from './transport.js'

async function server(onConnect?: (socket: WebSocket) => void) {
  const sockets: WebSocket[] = []
  const wss = new WebSocketServer({ port: 0 })
  wss.on('connection', (socket) => {
    sockets.push(socket)
    onConnect?.(socket)
  })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const address = wss.address()
  assert.ok(address && typeof address === 'object')
  return {
    sockets,
    url: `ws://127.0.0.1:${address.port}`,
    async close() {
      for (const socket of sockets) socket.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}

async function until(predicate: () => boolean, timeout = 2_000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for test condition')
    await delay(5)
  }
}

function collect() {
  const frames: RawFrame[] = []
  const statuses: FeedStatus[] = []
  return {
    frames,
    statuses,
    onFrame: (frame: RawFrame) => {
      frames.push(frame)
    },
    onStatus: (status: FeedStatus) => {
      statuses.push(status)
    },
  }
}

function market(timeframe: '5m' | '15m' = '5m', startMs = 1_800_000): RecordedMarket {
  return parseRecorderMarket({
    slug: `btc-updown-${timeframe}-${startMs / 1_000}`,
    conditionId: `condition-${timeframe}-${startMs}`,
    clobTokenIds: JSON.stringify([`up-${timeframe}-${startMs}`, `down-${timeframe}-${startMs}`]),
    outcomes: '["Up", "Down"]',
    endDate: new Date(startMs + (timeframe === '5m' ? 300_000 : 900_000)).toISOString(),
    cryptoMarketConfig: {
      twapEnabled: true,
      twapLookbackSeconds: 60,
      asset: 'btc',
      duration: timeframe,
    },
    resolutionSource: 'https://data.chain.link/streams/btc-usd-twap-60s-streams',
  })
}

test('market discovery derives aligned 5m and 15m boundaries and preserves full rule metadata', async () => {
  assert.deepEqual(candidateBtcSlugs(1_801_000), [
    'btc-updown-5m-1800',
    'btc-updown-5m-2100',
    'btc-updown-15m-1800',
    'btc-updown-15m-2700',
  ])
  const found = market()
  assert.equal(found.startMs, 1_800_000)
  assert.equal(found.twapLookbackSeconds, 60)
  assert.ok(found.rawJson.includes('cryptoMarketConfig'))
  const errors: string[] = []
  const markets = await discoverBtcMarkets({
    nowMs: 1_801_000,
    fetch: async (url) => {
      if (String(url).endsWith('/btc-updown-5m-1800')) return new Response(found.rawJson)
      return new Response('{}', { status: 404 })
    },
    onError: (slug) => errors.push(slug),
  })
  assert.equal(markets.length, 1)
  assert.deepEqual(errors, [])
  const wrong = JSON.parse(found.rawJson) as Record<string, unknown>
  wrong.cryptoMarketConfig = { twapEnabled: true, twapLookbackSeconds: 30 }
  assert.throws(() => parseRecorderMarket(wrong), /Unsupported TWAP/)
  delete wrong.cryptoMarketConfig
  assert.throws(() => parseRecorderMarket(wrong), /Missing explicit/)
  assert.throws(
    () => parseRecorderMarket(JSON.parse(found.rawJson), 'another-slug'),
    /slug mismatch/,
  )
})

test('Polymarket keeps array frames intact and adds/removes tokens without reconnecting', async (t) => {
  const messages: Record<string, unknown>[] = []
  const fixture = '[{"event_type":"book","asset_id":"up"},{"event_type":"book","asset_id":"down"}]'
  const ws = await server((socket) => {
    socket.on('message', (data) => {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>
      messages.push(parsed)
      if (parsed.type === 'market') socket.send(fixture)
    })
  })
  const output = collect()
  const feed = createPolymarketFeed({
    ...output,
    url: ws.url,
    markets: [market('5m')],
    clock: () => ({ receivedAtMs: 123, monotonicNs: '456' }),
    random: () => 0,
  })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() => output.frames.length === 1)
  assert.equal(output.frames[0]?.rawJson, fixture)
  assert.deepEqual(output.frames[0]?.stamp, { receivedAtMs: 123, monotonicNs: '456' })
  assert.equal(messages[0]?.custom_feature_enabled, true)
  assert.equal(messages[0]?.initial_dump, true)
  feed.setMarkets([market('15m')])
  await until(() => messages.length === 3)
  assert.equal(messages[1]?.operation, 'subscribe')
  assert.equal(messages[2]?.operation, 'unsubscribe')
  assert.equal(ws.sockets.length, 1)
  feed.reconnect('capture_event_loop_gap')
  await until(() => messages.length === 4)
  assert.equal(ws.sockets.length, 2)
  assert.equal(messages[3]?.type, 'market')
  assert.equal(messages[3]?.initial_dump, true)
  assert.deepEqual(messages[3]?.assets_ids, market('15m').tokenIds)
  assert.ok(output.statuses.some((status) => status.reason === 'capture_event_loop_gap'))
})

const credentials = {
  apiKey: 'TEST_ONLY_APIKEY',
  secret: 'TEST_ONLY_SECRET',
  passphrase: 'TEST_ONLY_PASSPHRASE',
}
function price(channel: string, seq: number, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    channel,
    seq,
    ts: 10_000,
    payload: {
      symbol: 'btcusd',
      source: 'chainlink',
      window_seconds: 60,
      timestamp: 10_000,
      value: 85_000,
      full_accuracy_value: '85000.00000000000001',
    },
    ...extra,
  })
}

test('PolyBolt authenticates before subscribing, preserves snapshots and detects missing/dropped/provider frames', async (t) => {
  const requests: Record<string, unknown>[] = []
  const ws = await server((socket) => {
    socket.on('message', (data) => {
      const request = JSON.parse(data.toString()) as Record<string, unknown>
      requests.push(request)
      if (request.op === 'auth') socket.send('{"op":"authed"}')
      if (request.op === 'subscribe') {
        socket.send(
          price('price.crypto', 1, {
            snapshot: true,
            payload: {
              symbol: 'btcusd',
              source: 'chainlink',
              data: [{ timestamp: 1, full_accuracy_value: '84999.1', value: 84999.1 }],
            },
          }),
        )
        socket.send(price('price.crypto.twap', 1))
        socket.send(price('price.crypto', 3, { dropped: 1 }))
        socket.send(price('price.crypto', 4, { payload: { symbol: 'btcusd', source: 'pyth' } }))
      }
    })
  })
  const output = collect()
  const feed = createPolyBoltFeed({ ...output, url: ws.url, credentials })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() => output.frames.length === 5)
  assert.deepEqual(
    requests.map((request) => request.op),
    ['auth', 'subscribe'],
  )
  assert.ok(output.frames[1]?.rawJson.includes('84999.1'))
  assert.ok(output.statuses.some((status) => status.reason === 'polybolt_sequence'))
  assert.ok(output.statuses.some((status) => status.reason === 'polybolt_dropped'))
  assert.ok(output.statuses.some((status) => status.kind === 'provider_mismatch'))
  const recorded = JSON.stringify({ frames: output.frames, statuses: output.statuses })
  for (const value of Object.values(credentials)) assert.equal(recorded.includes(value), false)
})

test('PolyBolt reconnect resets channel sequence and retains an explicit disconnect even for code 1000', async (t) => {
  let connections = 0
  const ws = await server((socket) => {
    connections++
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>
      if (message.op === 'auth') socket.send('{"op":"authed"}')
      if (message.op === 'subscribe') {
        socket.send(price('price.crypto', 1))
        socket.send(price('price.crypto.twap', 1))
        if (connections === 1) socket.close(1000)
      }
    })
  })
  const output = collect()
  const feed = createPolyBoltFeed({
    ...output,
    url: ws.url,
    credentials,
    reconnectBaseMs: 1,
    random: () => 0,
  })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() => output.frames.length === 6)
  assert.equal(connections, 2)
  assert.ok(
    output.statuses.some(
      (status) => status.kind === 'disconnected' && status.details?.code === 1000,
    ),
  )
  assert.ok(!output.statuses.some((status) => status.reason === 'polybolt_sequence'))
  assert.notEqual(output.frames[0]?.connectionId, output.frames[3]?.connectionId)
})

test('PolyBolt policy/authentication failure halts instead of an endless credential retry loop', async (t) => {
  const ws = await server((socket) => socket.close(4001))
  const output = collect()
  const feed = createPolyBoltFeed({ ...output, url: ws.url, credentials, reconnectBaseMs: 1 })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() => output.statuses.some((status) => status.details?.permanent === true))
  await delay(30)
  assert.equal(ws.sockets.length, 1)
})

test('Binance records aggregate trades and timestamp-free book tickers, detecting aggregate gaps only', async (t) => {
  const ws = await server((socket) => {
    socket.send(
      JSON.stringify({
        stream: 'btcusdt@aggTrade',
        data: { s: 'BTCUSDT', e: 'aggTrade', a: 20, E: 1, T: 1, p: '85000', q: '1' },
      }),
    )
    socket.send(
      JSON.stringify({
        stream: 'btcusdt@bookTicker',
        data: { s: 'BTCUSDT', u: 123, b: '84999', B: '1', a: '85000', A: '2' },
      }),
    )
    socket.send(
      JSON.stringify({
        stream: 'btcusdt@bookTicker',
        data: { s: 'BTCUSDT', u: 200, b: '84999', B: '1', a: '85000', A: '2' },
      }),
    )
    socket.send(
      JSON.stringify({
        stream: 'btcusdt@aggTrade',
        data: { s: 'BTCUSDT', e: 'aggTrade', a: 22, E: 2, T: 2, p: '85001', q: '1' },
      }),
    )
  })
  const output = collect()
  const feed = createBinanceFeed({ ...output, url: ws.url })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() => output.frames.length === 4)
  assert.equal(output.statuses.filter((status) => status.kind === 'gap').length, 1)
  assert.equal(
    output.statuses.find((status) => status.kind === 'gap')?.details?.feed,
    'binance_agg_trade',
  )
  assert.equal(
    (JSON.parse(output.frames[1]!.rawJson) as { data: Record<string, unknown> }).data.E,
    undefined,
  )
})

test('a quiet price subscription reconnects even while server protocol ping frames arrive', async (t) => {
  const ws = await server((socket) => {
    const timer = setInterval(() => socket.ping(), 5)
    socket.on('close', () => clearInterval(timer))
  })
  const output = collect()
  const feed = createBinanceFeed({
    ...output,
    url: ws.url,
    dataStaleMs: 40,
    tickMs: 5,
    reconnectBaseMs: 10,
    random: () => 0.5,
  })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() =>
    output.statuses.some((status) => status.reason?.startsWith('binance_data_stale')),
  )
  assert.ok(output.frames.some((frame) => frame.rawJson.includes('"transport":"ping"')))
})

test('transport captures binary/control frames without data loss and stops reconnect timers', async (t) => {
  const ws = await server((socket) => {
    socket.send(Buffer.from([0, 255, 13]), { binary: true })
    socket.ping('hello')
  })
  const output = collect()
  const feed = createSocketTransport({
    ...output,
    source: 'binance',
    url: ws.url,
    reconnectBaseMs: 1,
  })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() => output.frames.length >= 2)
  const binary = JSON.parse(output.frames[0]!.rawJson) as { base64: string }
  assert.deepEqual(Buffer.from(binary.base64, 'base64'), Buffer.from([0, 255, 13]))
  feed.stop()
  await delay(30)
  assert.equal(ws.sockets.length, 1)
})

test('price-to-beat includes exact TWAP and timeframe arguments and continues recording corrections', async (t) => {
  const m = market()
  const five = new URL(priceToBeatUrl(m, m.startMs))
  assert.equal(five.searchParams.get('variant'), 'fiveminute')
  assert.equal(five.searchParams.get('twapEnabled'), 'true')
  assert.equal(five.searchParams.get('twapLookbackSeconds'), '60')
  assert.equal(
    new URL(priceToBeatUrl(market('15m'), m.startMs)).searchParams.get('variant'),
    'fifteen',
  )
  const output = collect()
  let count = 0
  const values = [
    '{"openPrice":null}',
    '{"openPrice":85000.123456789}',
    '{"openPrice":85000.223456789}',
  ]
  const feed = createPriceToBeatFeed({
    ...output,
    market: m,
    pollMs: 100,
    correctionPollMs: 100,
    clock: () => ({ receivedAtMs: m.startMs + count, monotonicNs: String(count + 1) }),
    fetch: async () => new Response(values[Math.min(count++, 2)]),
  })
  t.after(() => feed.stop())
  feed.start()
  await until(() => output.frames.length === 3)
  assert.deepEqual(
    output.frames.map((frame) => frame.rawJson),
    values,
  )
  assert.equal(output.frames[0]?.request?.httpStatus, 200)
  assert.equal(output.frames[2]?.marketSlug, m.slug)
})

test('stopping price-to-beat discards a late response and does not resurrect polling', async () => {
  const output = collect()
  let respond: ((response: Response) => void) | undefined
  let count = 0
  const m = market()
  const feed = createPriceToBeatFeed({
    ...output,
    market: m,
    clock: () => ({ receivedAtMs: m.startMs, monotonicNs: '1' }),
    fetch: () => {
      count++
      return new Promise<Response>((resolve) => {
        respond = resolve
      })
    },
  })
  feed.start()
  feed.stop()
  respond?.(new Response('{"openPrice":85000}'))
  await delay(20)
  assert.equal(count, 1)
  assert.equal(output.frames.length, 0)
})

test('Polymarket PONG-only activity cannot hide a stalled active market subscription', async (t) => {
  const ws = await server((socket) => {
    const timer = setInterval(() => socket.send('PONG'), 5)
    socket.on('close', () => clearInterval(timer))
  })
  const output = collect()
  const now = Date.now()
  const active = { ...market(), startMs: now - 1_000, endMs: now + 10_000 }
  const feed = createPolymarketFeed({
    ...output,
    url: ws.url,
    markets: [active],
    dataStaleMs: 40,
    tickMs: 5,
  })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() =>
    output.statuses.some((status) => status.reason === 'polymarket_market_data_stale'),
  )
  const stale = output.statuses.find((status) => status.reason === 'polymarket_market_data_stale')!
  assert.equal(stale.marketSlug, active.slug)
  assert.ok(Number(stale.details?.startMs) < stale.stamp.receivedAtMs)
  assert.equal(stale.details?.certainty, 'uncertain')
  assert.ok(output.frames.some((frame) => frame.rawJson === 'PONG'))
})

test('transport timeout reports the last observable activity so a tail gap can cross a boundary', async (t) => {
  const ws = await server()
  const output = collect()
  const feed = createSocketTransport({
    ...output,
    source: 'polymarket',
    url: ws.url,
    idleMs: 40,
    tickMs: 5,
  })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() => output.statuses.some((status) => status.kind === 'stale'))
  const stale = output.statuses.find((status) => status.kind === 'stale')!
  assert.ok(Number(stale.details?.startMs) <= stale.stamp.receivedAtMs - 40)
})

test('Binance reports a stale trade interval even when quotes continue on the shared socket', async (t) => {
  const ws = await server((socket) => {
    socket.send(
      JSON.stringify({
        stream: 'btcusdt@aggTrade',
        data: { e: 'aggTrade', s: 'BTCUSDT', a: 1, p: '85000', q: '1', T: Date.now() },
      }),
    )
    const timer = setInterval(() => {
      socket.send(
        JSON.stringify({
          stream: 'btcusdt@bookTicker',
          data: { s: 'BTCUSDT', u: 1, b: '85000', a: '85001', B: '1', A: '1' },
        }),
      )
    }, 5)
    socket.on('close', () => clearInterval(timer))
  })
  const output = collect()
  const feed = createBinanceFeed({ ...output, url: ws.url, dataStaleMs: 40, tickMs: 5 })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() => output.statuses.some((status) => status.kind === 'stale'))
  const stale = output.statuses.find((status) => status.kind === 'stale')!
  const trade = output.frames.find((frame) => frame.rawJson.includes('aggTrade'))!
  assert.equal(stale.details?.feed, 'binance_agg_trade')
  assert.equal(stale.details?.startMs, trade.stamp.receivedAtMs)
  assert.ok(stale.stamp.receivedAtMs - trade.stamp.receivedAtMs >= 40)
  assert.ok(output.frames.some((frame) => frame.rawJson.includes('bookTicker')))
})

test('PolyBolt reports the stopped channel since its last valid receipt while the other continues', async (t) => {
  const ws = await server((socket) => {
    let timer: ReturnType<typeof setInterval> | undefined
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { op: string }
      if (message.op === 'auth') socket.send('{"op":"authed"}')
      if (message.op === 'subscribe') {
        socket.send(price('price.crypto', 1))
        let sequence = 0
        timer = setInterval(() => socket.send(price('price.crypto.twap', ++sequence)), 5)
      }
    })
    socket.on('close', () => clearInterval(timer))
  })
  const output = collect()
  const feed = createPolyBoltFeed({
    ...output,
    credentials,
    url: ws.url,
    dataStaleMs: 40,
    tickMs: 5,
  })
  t.after(async () => {
    feed.stop()
    await ws.close()
  })
  feed.start()
  await until(() => output.statuses.some((status) => status.kind === 'stale'))
  const stale = output.statuses.find((status) => status.kind === 'stale')!
  const spot = output.frames.find((frame) => frame.rawJson.includes('"price.crypto"'))!
  assert.equal(stale.details?.feed, 'chainlink_spot')
  assert.equal(stale.details?.startMs, spot.stamp.receivedAtMs)
  assert.ok(stale.stamp.receivedAtMs - spot.stamp.receivedAtMs >= 40)
  assert.ok(output.frames.some((frame) => frame.rawJson.includes('price.crypto.twap')))
})
