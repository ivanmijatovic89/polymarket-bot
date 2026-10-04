import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { setImmediate as settle } from 'node:timers/promises'
import { createPriceToBeatFeed } from './priceToBeat.js'
import type { FeedStatus, RawFrame, RecordedMarket } from '../types.js'

const START = Date.parse('2026-10-04T18:45:00Z')
const market: RecordedMarket = {
  slug: `btc-updown-15m-${START / 1_000}`,
  symbol: 'btc',
  timeframe: '15m',
  conditionId: 'condition',
  tokenIds: ['up', 'down'],
  outcomes: ['Up', 'Down'],
  startMs: START,
  endMs: START + 900_000,
  twapEnabled: true,
  twapLookbackSeconds: 60,
  resolutionSource: null,
  rawJson: '{}',
}

function harness(t: TestContext, respond: (index: number) => Response | Promise<Response>) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const requests: number[] = []
  const frames: RawFrame[] = []
  const statuses: FeedStatus[] = []
  const feed = createPriceToBeatFeed({
    market,
    clock: () => ({
      receivedAtMs: Date.now(),
      monotonicNs: String(BigInt(Date.now()) * 1_000_000n),
    }),
    fetch: async () => {
      requests.push(Date.now() - START)
      return respond(requests.length - 1)
    },
    onFrame: (frame) => frames.push(frame),
    onStatus: (status) => statuses.push(status),
  })
  t.after(() => feed.stop())
  return {
    feed,
    requests,
    frames,
    statuses,
    async start() {
      feed.start()
      await settle()
    },
    async advance(ms: number) {
      t.mock.timers.tick(ms)
      await settle()
    },
  }
}

const good = () => new Response('{"openPrice":85000}')
const limited = (retryAfter?: string) =>
  new Response('{"error":{"code":"429","message":"Too Many Requests"}}', {
    status: 429,
    ...(retryAfter === undefined ? {} : { headers: { 'Retry-After': retryAfter } }),
  })

test('healthy PTB correction observations retain the normal 30-second cadence', async (t) => {
  const h = harness(t, good)
  await h.start()
  await h.advance(29_999)
  assert.deepEqual(h.requests, [0])
  await h.advance(1)
  assert.deepEqual(h.requests, [0, 30_000])
  assert.equal(h.frames.length, 2)
  assert.equal(h.statuses.length, 0)
})

test('initial and repeated 429 responses back off exponentially with a five-minute local cap', async (t) => {
  const h = harness(t, () => limited())
  await h.start()
  await h.advance(1_000)
  assert.deepEqual(h.requests, [0])
  await h.advance(59_000)
  await h.advance(120_000)
  await h.advance(240_000)
  await h.advance(300_000)
  assert.deepEqual(h.requests, [0, 60_000, 180_000, 420_000, 720_000])
  assert.deepEqual(
    h.statuses.map((status) => status.details?.retryBackoffMs),
    [60_000, 120_000, 240_000, 300_000, 300_000],
  )
  assert.equal(h.frames.length, h.requests.length)
  assert(h.frames.every((frame) => frame.request?.httpStatus === 429))
})

test('an isolated success retains the learned cooldown instead of restarting alternating 429s', async (t) => {
  const h = harness(t, (index) => (index % 2 === 0 ? good() : limited()))
  await h.start()
  await h.advance(30_000)
  await h.advance(60_000)
  await h.advance(30_000)
  assert.deepEqual(h.requests, [0, 30_000, 90_000])
  await h.advance(30_000)
  await h.advance(60_000)
  assert.deepEqual(h.requests, [0, 30_000, 90_000, 150_000, 210_000])
  assert.equal(h.statuses.length, 2)
  assert(h.statuses.every((status) => status.kind === 'error'))
  assert.deepEqual(
    h.statuses.map((status) => status.details?.retryBackoffMs),
    [60_000, 60_000],
  )
})

test('HTTP 400 wrapping Chainlink 429 remains captured and uses the same retry backoff', async (t) => {
  const body = '{"error":"Chainlink API error 429"}'
  const h = harness(t, (index) => (index === 0 ? new Response(body, { status: 400 }) : good()))
  await h.start()
  await h.advance(59_999)
  assert.deepEqual(h.requests, [0])
  await h.advance(1)
  assert.deepEqual(h.requests, [0, 60_000])
  assert.equal(h.frames[0]?.rawJson, body)
  assert.equal(h.statuses[0]?.reason, 'price_to_beat_http_400')
})

for (const [name, header, expectedDelay] of [
  ['seconds', '120', 120_000],
  ['HTTP date', new Date(START + 180_000).toUTCString(), 180_000],
  ['invalid', 'not-a-valid-retry-delay', 60_000],
  ['invalid negative seconds', '-9999', 60_000],
  ['invalid fractional seconds', '1.5', 60_000],
  ['past date', new Date(START - 180_000).toUTCString(), 60_000],
  ['zero seconds', '0', 60_000],
] as const) {
  test(`Retry-After ${name} is honored or safely falls back to local backoff`, async (t) => {
    const h = harness(t, (index) => (index === 0 ? limited(header) : good()))
    await h.start()
    await h.advance(expectedDelay - 1)
    assert.deepEqual(h.requests, [0])
    await h.advance(1)
    assert.deepEqual(h.requests, [0, expectedDelay])
    assert.equal(h.statuses[0]?.details?.retryAfter, header)
  })
}

test('Retry-After beyond the local cap or timer range never causes an early retry', async (t) => {
  for (const header of ['600', '999999999999999999999999999999999999999999']) {
    await t.test(header, async (subtest) => {
      const h = harness(subtest, () => limited(header))
      await h.start()
      await h.advance(300_000)
      assert.deepEqual(h.requests, [0])
      await h.advance(299_999)
      assert.deepEqual(h.requests, [0])
      await h.advance(1)
      assert.deepEqual(h.requests, header === '600' ? [0, 600_000] : [0])
      await h.advance(900_000)
      assert(h.requests.every((time) => time < market.endMs - START))
    })
  }
})

test('shutdown during backoff cancels all future polls', async (t) => {
  const h = harness(t, () => limited('120'))
  await h.start()
  h.feed.stop()
  await h.advance(500_000)
  assert.deepEqual(h.requests, [0])
  assert.equal(h.frames.length, 1)
  assert.equal(h.statuses.length, 1)
})

test('a Retry-After deadline on another HTTP error also learns a cooldown', async (t) => {
  const h = harness(t, (index) =>
    index === 0
      ? new Response('temporarily unavailable', {
          status: 503,
          headers: { 'Retry-After': '120' },
        })
      : good(),
  )
  await h.start()
  await h.advance(120_000)
  await h.advance(30_000)
  assert.deepEqual(h.requests, [0, 120_000])
  await h.advance(30_000)
  assert.deepEqual(h.requests, [0, 120_000, 180_000])
  assert.equal(h.statuses[0]?.reason, 'price_to_beat_http_503')
})

test('Retry-After remains binding when reading the response body fails', async (t) => {
  const h = harness(t, (index) =>
    index === 0
      ? new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('Interrupted response body'))
            },
          }),
          { status: 429, headers: { 'Retry-After': '180' } },
        )
      : good(),
  )
  await h.start()
  assert.equal(h.frames.length, 0)
  assert.equal(h.statuses[0]?.reason, 'price_to_beat_request_failed')
  assert.equal(h.statuses[0]?.details?.retryAfter, '180')
  await h.advance(179_999)
  assert.deepEqual(h.requests, [0])
  await h.advance(1)
  assert.deepEqual(h.requests, [0, 180_000])
})

test('invalid successful bodies cannot reset failure backoff or invent a valid initial price', async (t) => {
  const bodies = ['not-json', '{"openPrice":true}', '{"openPrice":85000}']
  const h = harness(t, (index) => new Response(bodies[Math.min(index, 2)]!))
  await h.start()
  await h.advance(2_000)
  await h.advance(4_000)
  assert.deepEqual(h.requests, [0, 2_000, 6_000])
  assert.deepEqual(
    h.frames.map((frame) => frame.rawJson),
    bodies,
  )
  assert.deepEqual(
    h.statuses.map((status) => status.reason),
    ['price_to_beat_invalid_response', 'price_to_beat_invalid_open_price'],
  )
})

test('network failures back off, while a missing initial price retains fast healthy polling', async (t) => {
  const h = harness(t, (index) => {
    if (index === 0) return new Response('{"openPrice":null}')
    if (index === 1) throw new Error('Network unavailable')
    return good()
  })
  await h.start()
  await h.advance(1_000)
  assert.deepEqual(h.requests, [0, 1_000])
  assert.equal(h.statuses[0]?.reason, 'price_to_beat_request_failed')
  await h.advance(2_000)
  assert.deepEqual(h.requests, [0, 1_000, 3_000])
  assert.equal(h.frames.length, 2)
  assert.equal(h.frames[1]?.rawJson, '{"openPrice":85000}')
  await h.advance(30_000)
  assert.deepEqual(h.requests, [0, 1_000, 3_000, 33_000])
})

test('ordinary HTTP failures use the current polling cadence and reset after a valid price', async (t) => {
  const h = harness(t, (index) =>
    index === 0 || index === 2 ? new Response('temporarily unavailable', { status: 503 }) : good(),
  )
  await h.start()
  await h.advance(2_000)
  await h.advance(30_000)
  await h.advance(60_000)
  await h.advance(30_000)
  assert.deepEqual(h.requests, [0, 2_000, 32_000, 92_000, 122_000])
  assert.deepEqual(
    h.statuses.map((status) => status.details?.retryBackoffMs),
    [2_000, 60_000],
  )
})
