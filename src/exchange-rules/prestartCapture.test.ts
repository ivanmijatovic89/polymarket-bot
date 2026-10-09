import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  CLOB_MARKET_URL,
  GAMMA_MARKET_URL,
  PrestartCapture,
  onceVerdict,
  runWatch,
  type CaptureDeps,
  type FetchLike,
  type TickResult,
} from './prestartCapture.js'
import { buildReport, buildStatus, formatReport } from './prestartCoverage.js'
import { readDayFile, repairTornTail, type CaptureRecord } from './prestartFiles.js'
import {
  captureWindowMarkets,
  gridMarketsBetween,
  isFinalTick,
  nextTickMs,
  parseMarketsArg,
  type Timeframe,
} from './prestartGrid.js'

// 2026-10-08T23:30:00Z: aligned to both the 5m and the 15m grid.
const B = 1_791_502_200_000
const COMMIT = 'c'.repeat(40)
const conditionIdFor = (slug: string): string =>
  `0x${createHash('sha256').update(slug).digest('hex')}`

const tempDirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-capture-test-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

type Handler = (url: string, signal: AbortSignal) => Promise<Response> | Response

interface Call {
  url: string
  atMs: number
}

function gammaBody(slug: string): string {
  return JSON.stringify({ id: '1', slug, conditionId: conditionIdFor(slug), feeType: 'crypto' })
}

function clobBody(conditionId: string): string {
  return JSON.stringify({ c: conditionId, mos: 5, mts: 0.01, itode: true, fd: { r: 0.07, e: 1 } })
}

/** Both origins answer 200 with well-formed bodies. */
const okHandler = (url: string): Response => {
  if (url.startsWith(GAMMA_MARKET_URL)) {
    return new Response(gammaBody(url.slice(GAMMA_MARKET_URL.length)), { status: 200 })
  }
  return new Response(clobBody(url.slice(CLOB_MARKET_URL.length)), { status: 200 })
}

function makeEnv(options: {
  startMs: number
  handler?: Handler
  timeframes?: readonly Timeframe[]
  latencyMs?: number
  timeoutMs?: number
}) {
  const outDir = tempDir()
  const clock = { ms: options.startMs }
  const calls: Call[] = []
  const sleeps: number[] = []
  const handler = options.handler ?? okHandler
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, atMs: clock.ms })
    assert.deepEqual(init.headers, { accept: 'application/json' })
    clock.ms += options.latencyMs ?? 50
    return handler(url, init.signal)
  }
  const deps: CaptureDeps = {
    outDir,
    fetch,
    now: () => clock.ms,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock.ms += ms
    },
    random: () => 0.5,
    host: 'test-host',
    captureCommit: COMMIT,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }
  const capture = new PrestartCapture(deps, options.timeframes ?? ['5m', '15m'])
  const records = (): CaptureRecord[] =>
    fs
      .readdirSync(outDir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .flatMap((name) =>
        fs
          .readFileSync(path.join(outDir, name), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as CaptureRecord),
      )
  const tickAt = async (ms: number): Promise<TickResult> => {
    clock.ms = ms
    return capture.runTick()
  }
  return { outDir, clock, calls, sleeps, capture, deps, records, tickAt }
}

const slugOf = (url: string): string => url.slice(url.lastIndexOf('/') + 1)
const describeCall = (call: Call): string =>
  `${call.url.startsWith(GAMMA_MARKET_URL) ? 'gamma' : 'clob'} ${call.url.startsWith(GAMMA_MARKET_URL) ? slugOf(call.url) : 'cid'}`

describe('grid', () => {
  it('builds epoch-grid slugs for both timeframes', () => {
    const markets = captureWindowMarkets(B - 595_000, ['5m', '15m'])
    assert.deepEqual(
      markets.map((m) => m.slug),
      ['btc-updown-5m-1791501900', 'btc-updown-5m-1791502200', 'btc-updown-15m-1791502200'],
    )
    assert.deepEqual(
      markets.map((m) => [m.timeframe, m.marketStartMs]),
      [
        ['5m', B - 300_000],
        ['5m', B],
        ['15m', B],
      ],
    )
    for (const market of gridMarketsBetween(['5m', '15m'], B, B + 86_400_000)) {
      const startSec = market.marketStartMs / 1_000
      assert.equal(startSec % (market.timeframe === '5m' ? 300 : 900), 0)
      assert.equal(market.slug, `btc-updown-${market.timeframe}-${startSec}`)
    }
    assert.equal(gridMarketsBetween(['5m'], B, B + 86_400_000).length, 288)
    assert.equal(gridMarketsBetween(['15m'], B, B + 86_400_000).length, 96)
  })

  it('applies the (now + 15 s, now + 10 min] window bounds exactly', () => {
    assert.deepEqual(
      captureWindowMarkets(B - 600_000, ['15m']).map((m) => m.marketStartMs),
      [B],
    )
    assert.deepEqual(captureWindowMarkets(B - 600_001, ['15m']), [])
    assert.deepEqual(captureWindowMarkets(B - 15_000, ['15m']), [])
    assert.deepEqual(
      captureWindowMarkets(B - 15_001, ['15m']).map((m) => m.marketStartMs),
      [B],
    )
  })

  it('selects the final tick and the second-5 tick grid', () => {
    assert.equal(isFinalTick(B - 55_000, B), true)
    assert.equal(isFinalTick(B - 15_000, B), true)
    assert.equal(isFinalTick(B - 14_999, B), false)
    assert.equal(isFinalTick(B - 90_000, B), false)
    assert.equal(isFinalTick(B - 115_000, B), false)
    assert.equal(nextTickMs(B), B + 5_000)
    assert.equal(nextTickMs(B + 5_000), B + 65_000)
    assert.equal(nextTickMs(B + 4_999), B + 5_000)
  })

  it('parses --market', () => {
    assert.deepEqual(parseMarketsArg('btc:5m,btc:15m'), ['5m', '15m'])
    assert.deepEqual(parseMarketsArg('btc:15m, btc:5m'), ['5m', '15m'])
    assert.deepEqual(parseMarketsArg('btc:15m'), ['15m'])
    assert.throws(() => parseMarketsArg('eth:5m'), /--market accepts/)
  })
})

describe('slot selection per tick', () => {
  it('fetches first at start - 595 s and final at start - 55 s, nothing in between', async () => {
    const env = makeEnv({ startMs: B - 895_000, timeframes: ['15m'] })
    const perTick: string[][] = []
    for (let tick = B - 895_000; tick <= B + 5_000; tick += 60_000) {
      const before = env.calls.length
      await env.tickAt(tick)
      perTick.push(env.calls.slice(before).map(describeCall))
    }
    const slug = 'btc-updown-15m-1791502200'
    assert.deepEqual(perTick, [
      [], // start - 895 s: outside the window
      [], // start - 835 s
      [], // start - 775 s
      [], // start - 715 s
      [], // start - 655 s
      [`gamma ${slug}`, 'clob cid'], // start - 595 s: first
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [`gamma ${slug}`, 'clob cid'], // start - 55 s: final
      [], // start + 5 s: started
    ])
    const records = env.records()
    assert.deepEqual(
      records.map((r) => `${r.origin}/${r.slot}@${(r.marketStartMs - r.requestedAtMs) / 1_000}`),
      ['gamma/first@595', 'clob/first@594.95', 'gamma/final@55', 'clob/final@54.95'],
    )
  })

  it('repeats first every tick until a 200, and fetches final whatever first returned', async () => {
    let gammaCalls = 0
    const env = makeEnv({
      startMs: B,
      timeframes: ['15m'],
      handler: (url) => {
        if (url.startsWith(GAMMA_MARKET_URL)) {
          gammaCalls += 1
          // 404 until the final tick (the market is created late).
          if (gammaCalls < 10) return new Response('{"error":"not found"}', { status: 404 })
        }
        return okHandler(url)
      },
    })
    for (let tick = B - 595_000; tick <= B - 55_000; tick += 60_000) await env.tickAt(tick)
    const records = env.records()
    const gammaFirst = records.filter((r) => r.origin === 'gamma' && r.slot === 'first')
    // One 404 per tick from start - 595 s to start - 115 s, then the 200 at start - 55 s.
    assert.deepEqual(
      gammaFirst.map((r) => r.httpStatus),
      [404, 404, 404, 404, 404, 404, 404, 404, 404, 200],
    )
    assert.deepEqual(
      records
        .filter((r) => r.requestedAtMs >= B - 55_000)
        .map((r) => `${r.origin}/${r.slot}/${r.httpStatus}`),
      ['gamma/first/200', 'gamma/final/200', 'clob/first/200', 'clob/final/200'],
    )
    assert.deepEqual(env.sleeps, [], 'a Gamma 404 defers without an in-tick retry')
  })

  it('fetches every market of the window in one tick, 5m before 15m', async () => {
    const env = makeEnv({ startMs: B - 595_000 })
    const result = await env.tickAt(B - 595_000)
    assert.deepEqual(env.calls.map(describeCall), [
      'gamma btc-updown-5m-1791501900',
      'clob cid',
      'gamma btc-updown-5m-1791502200',
      'clob cid',
      'gamma btc-updown-15m-1791502200',
      'clob cid',
    ])
    assert.equal(onceVerdict(result).complete, true)
  })
})

describe('retries', () => {
  async function oneRequest(handler: Handler, timeoutMs?: number) {
    const env = makeEnv({
      startMs: B - 595_000,
      timeframes: ['15m'],
      handler: (url, signal) =>
        url.startsWith(GAMMA_MARKET_URL) ? handler(url, signal) : okHandler(url),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
    const result = await env.tickAt(B - 595_000)
    const gamma = result.markets[0]!.requests.find((r) => r.origin === 'gamma')!
    const records = env.records().filter((r) => r.origin === 'gamma')
    return { env, gamma, records }
  }

  function sequence(...responses: Array<() => Response>): Handler {
    let i = 0
    return () => responses[Math.min(i++, responses.length - 1)]!()
  }

  it('defers a Gamma 404 to the next tick', async () => {
    const { env, gamma, records } = await oneRequest(() => new Response('{}', { status: 404 }))
    assert.equal(gamma.status, 'deferred')
    assert.equal(records.length, 1)
    assert.deepEqual(env.sleeps, [])
    await env.tickAt(B - 535_000)
    assert.equal(env.records().filter((r) => r.origin === 'gamma').length, 2)
  })

  it('waits for Retry-After <= 20 s after a 429', async () => {
    const { env, gamma, records } = await oneRequest(
      sequence(
        () => new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
        () => okHandler(`${GAMMA_MARKET_URL}btc-updown-15m-1791502200`),
      ),
    )
    assert.equal(gamma.status, 'ok')
    assert.deepEqual(
      records.map((r) => r.httpStatus),
      [429, 200],
    )
    assert.deepEqual(env.sleeps, [2_000])
  })

  it('defers a 429 without Retry-After or with one above 20 s', async () => {
    for (const headers of [{}, { 'retry-after': '21' }]) {
      const { env, gamma, records } = await oneRequest(
        () => new Response('slow down', { status: 429, headers }),
      )
      assert.equal(gamma.status, 'deferred')
      assert.equal(records.length, 1)
      assert.deepEqual(env.sleeps, [])
    }
  })

  it('retries a 5xx with Retry-After up to 3 attempts and defers one without', async () => {
    const withHeader = await oneRequest(
      () => new Response('down', { status: 503, headers: { 'retry-after': '1' } }),
    )
    assert.equal(withHeader.gamma.status, 'failed')
    assert.equal(withHeader.gamma.attempts, 3)
    assert.deepEqual(
      withHeader.records.map((r) => r.httpStatus),
      [503, 503, 503],
    )
    assert.deepEqual(withHeader.env.sleeps, [1_000, 1_000])

    const without = await oneRequest(() => new Response('oops', { status: 500 }))
    assert.equal(without.gamma.status, 'deferred')
    assert.equal(without.records.length, 1)
  })

  it('retries a timeout with a jittered 1-3 s pause and records status 0', async () => {
    const hang: Handler = (_url, signal) =>
      new Promise<Response>((_resolve, reject) => {
        // AbortSignal.timeout's timer is unref'd; keep the event loop alive until it fires.
        const keepAlive = setTimeout(() => {}, 10_000)
        signal.addEventListener('abort', () => {
          clearTimeout(keepAlive)
          reject(signal.reason as Error)
        })
      })
    const { env, gamma, records } = await oneRequest(hang, 20)
    assert.equal(gamma.status, 'failed')
    assert.equal(records.length, 3)
    for (const record of records) {
      assert.equal(record.httpStatus, 0)
      assert.match(record.error ?? '', /TimeoutError/)
      assert.equal(record.rawSha256, null)
      assert.equal(record.rawBody, null)
    }
    assert.deepEqual(env.sleeps, [2_000, 2_000], 'random 0.5 -> 1 s + 0.5 * 2 s')
    assert.equal(env.records().filter((r) => r.origin === 'clob').length, 0)
  })

  it('records a transport error with its cause and recovers within the tick', async () => {
    const { gamma, records } = await oneRequest(
      sequence(
        () => {
          throw new TypeError('fetch failed', {
            cause: Object.assign(new Error('getaddrinfo ENOTFOUND gamma-api.polymarket.com'), {
              code: 'ENOTFOUND',
            }),
          })
        },
        () => okHandler(`${GAMMA_MARKET_URL}btc-updown-15m-1791502200`),
      ),
    )
    assert.equal(gamma.status, 'ok')
    assert.equal(records[0]!.httpStatus, 0)
    assert.equal(
      records[0]!.error,
      'TypeError: fetch failed (cause: ENOTFOUND getaddrinfo ENOTFOUND gamma-api.polymarket.com)',
    )
  })

  it('keeps going with the other markets when one fails', async () => {
    const env = makeEnv({
      startMs: B - 595_000,
      handler: (url) =>
        url.includes('btc-updown-5m-1791501900')
          ? new Response('nope', { status: 500 })
          : okHandler(url),
    })
    const result = await env.tickAt(B - 595_000)
    const verdict = onceVerdict(result)
    assert.equal(verdict.complete, false)
    assert.match(verdict.lines[0]!, /btc-updown-5m-1791501900 .*gamma NO 200 .*clob NO 200/)
    assert.match(verdict.lines[1]!, /gamma 200 \(first\)  clob 200 \(first\)/)
    assert.match(verdict.lines[2]!, /gamma 200 \(first\)  clob 200 \(first\)/)
  })
})

describe('records', () => {
  it('writes the PC4 fields in order with the exact values', async () => {
    const env = makeEnv({ startMs: B - 595_000, timeframes: ['15m'] })
    await env.tickAt(B - 595_000)
    const [gamma, clob] = env.records()
    const slug = 'btc-updown-15m-1791502200'
    const cid = conditionIdFor(slug)
    const body = gammaBody(slug)
    assert.deepEqual(Object.keys(gamma!), [
      'v',
      'origin',
      'slot',
      'slug',
      'timeframe',
      'marketStartMs',
      'conditionId',
      'url',
      'requestedAtMs',
      'fetchedAtMs',
      'httpStatus',
      'error',
      'rawSha256',
      'rawBody',
      'host',
      'captureCommit',
    ])
    assert.deepEqual(gamma, {
      v: 1,
      origin: 'gamma',
      slot: 'first',
      slug,
      timeframe: '15m',
      marketStartMs: B,
      conditionId: cid,
      url: `https://gamma-api.polymarket.com/markets/slug/${slug}`,
      requestedAtMs: B - 595_000,
      fetchedAtMs: B - 595_000 + 50,
      httpStatus: 200,
      error: null,
      rawSha256: createHash('sha256').update(body).digest('hex'),
      rawBody: body,
      host: 'test-host',
      captureCommit: COMMIT,
    })
    assert.equal(clob!.origin, 'clob')
    assert.equal(clob!.conditionId, cid)
    assert.equal(clob!.url, `https://clob.polymarket.com/clob-markets/${cid}`)
    assert.equal(clob!.rawBody, clobBody(cid))
  })

  it('records a non-200 body and leaves the Gamma conditionId null', async () => {
    const env = makeEnv({
      startMs: B - 595_000,
      timeframes: ['15m'],
      handler: () => new Response('{"error":"market not found"}', { status: 404 }),
    })
    await env.tickAt(B - 595_000)
    const [record] = env.records()
    assert.equal(record!.httpStatus, 404)
    assert.equal(record!.conditionId, null)
    assert.equal(record!.rawBody, '{"error":"market not found"}')
    assert.equal(record!.error, null)
  })

  it('hashes the raw bytes and keeps a BOM so the body re-encodes to the same bytes', async () => {
    const slug = 'btc-updown-15m-1791502200'
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const gammaBytes = Buffer.concat([bom, Buffer.from(gammaBody(slug))])
    const clobBytes = Buffer.concat([bom, Buffer.from(clobBody(conditionIdFor(slug)))])
    const env = makeEnv({
      startMs: B - 595_000,
      timeframes: ['15m'],
      handler: (url) =>
        new Response(url.startsWith(GAMMA_MARKET_URL) ? gammaBytes : clobBytes, { status: 200 }),
    })
    await env.tickAt(B - 595_000)
    const [gamma, clob] = env.records()
    for (const [record, bytes] of [
      [gamma!, gammaBytes],
      [clob!, clobBytes],
    ] as const) {
      assert.equal(record.rawSha256, createHash('sha256').update(bytes).digest('hex'))
      assert.equal(record.rawBody!.charCodeAt(0), 0xfeff)
      assert.deepEqual(Buffer.from(record.rawBody!, 'utf8'), bytes)
    }
    assert.equal(gamma!.conditionId, conditionIdFor(slug), 'the BOM does not hide the conditionId')
  })

  it('stores no body for invalid UTF-8 or above 1 MiB, but still hashes the bytes', async () => {
    const invalid = Buffer.from([0x7b, 0xff, 0x7d])
    const large = Buffer.alloc(1024 * 1024 + 1, 0x20)
    for (const [bytes, error] of [
      [invalid, 'invalid_utf8'],
      [large, 'body_too_large'],
    ] as const) {
      const env = makeEnv({
        startMs: B - 595_000,
        timeframes: ['15m'],
        handler: () => new Response(bytes, { status: 200 }),
      })
      await env.tickAt(B - 595_000)
      const [record] = env.records()
      assert.equal(record!.httpStatus, 200)
      assert.equal(record!.rawBody, null)
      assert.equal(record!.error, error)
      assert.equal(record!.rawSha256, createHash('sha256').update(bytes).digest('hex'))
    }
  })

  it('rotates files by the UTC date of fetchedAtMs', async () => {
    // 2026-10-09T00:00:00Z is B + 30 min; tick so that the Gamma fetch completes after midnight.
    const midnight = B + 1_800_000
    const env = makeEnv({ startMs: midnight, timeframes: ['5m'], latencyMs: 150 })
    await env.tickAt(midnight - 200)
    const files = fs
      .readdirSync(env.outDir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
    assert.deepEqual(files, ['2026-10-08.jsonl', '2026-10-09.jsonl'])
    const day1 = readDayFile(env.outDir, '2026-10-08').records
    const day2 = readDayFile(env.outDir, '2026-10-09').records
    assert.ok(day1.every((r) => r.fetchedAtMs < midnight))
    assert.ok(day2.every((r) => r.fetchedAtMs >= midnight))
    // One market in the window: its Gamma body lands before midnight, its CLOB body after.
    assert.deepEqual([day1.map((r) => r.origin), day2.map((r) => r.origin)], [['gamma'], ['clob']])
  })

  it('moves a torn last line aside before the next append', async () => {
    const env = makeEnv({ startMs: B - 595_000, timeframes: ['15m'] })
    const file = path.join(env.outDir, '2026-10-08.jsonl')
    fs.writeFileSync(file, '{"v":1,"origin":"gamma"}\n{"v":1,"orig')
    await env.tickAt(B - 595_000)
    assert.equal(fs.readFileSync(`${file}.torn`, 'utf8'), '{"v":1,"orig\n')
    const day = readDayFile(env.outDir, '2026-10-08')
    assert.equal(day.tornTail, false)
    assert.equal(day.malformed, 1, 'the earlier, invalid line stays as it was')
    assert.equal(day.records.length, 2)
    assert.equal(repairTornTail(file), 0)
  })
})

describe('status and report', () => {
  it('replaces status.json atomically each tick', async () => {
    const env = makeEnv({ startMs: B - 595_000, timeframes: ['5m', '15m'] })
    await env.tickAt(B - 595_000)
    await env.tickAt(B - 55_000)
    await env.tickAt(B + 5_000)
    const names = fs.readdirSync(env.outDir)
    assert.ok(!names.some((name) => name.includes('.tmp-')))
    const status = JSON.parse(fs.readFileSync(path.join(env.outDir, 'status.json'), 'utf8'))
    assert.equal(status.lastTickAtMs, env.clock.ms)
    assert.equal(status.lastOk.gamma.slug, 'btc-updown-5m-1791502800')
    assert.equal(status.lastOk.clob.slot, 'first')
    // Markets started in the last 24 h: 288 x 5m, 96 x 15m; three were captured before start.
    assert.deepEqual(status.coverage24h.byTimeframe['5m'].gridMarkets, 288)
    assert.deepEqual(status.coverage24h.byTimeframe['5m'].preStart200, {
      gamma: 2,
      clob: 2,
      both: 2,
    })
    assert.deepEqual(status.coverage24h.byTimeframe['15m'].preStart200, {
      gamma: 1,
      clob: 1,
      both: 1,
    })
    assert.equal(status.missedSlugs['5m'].length, 286)
    assert.deepEqual(status.missedSlugs['15m'][0].missing, ['gamma', 'clob'])
  })

  it('counts a 200 received after the start as post_start, not as coverage', () => {
    const outDir = tempDir()
    const slug = 'btc-updown-15m-1791502200'
    const line = (fetchedAtMs: number, origin: string): string =>
      JSON.stringify({
        v: 1,
        origin,
        slot: 'final',
        slug,
        timeframe: '15m',
        marketStartMs: B,
        conditionId: null,
        url: 'x',
        requestedAtMs: fetchedAtMs - 10,
        fetchedAtMs,
        httpStatus: 200,
        error: null,
        rawSha256: 'a',
        rawBody: '{}',
        host: 'h',
        captureCommit: 'c',
      })
    fs.writeFileSync(
      path.join(outDir, '2026-10-08.jsonl'),
      `${line(B - 1, 'gamma')}\n${line(B, 'clob')}\n`,
    )
    const status = buildStatus({
      outDir,
      nowMs: B + 1,
      timeframes: ['15m'],
      host: 'h',
      captureCommit: 'c',
    })
    assert.deepEqual(status.coverage24h.byTimeframe['15m']!.preStart200, {
      gamma: 1,
      clob: 0,
      both: 0,
    })
    assert.deepEqual(status.missedSlugs['15m']!.at(-1), {
      slug,
      marketStartMs: B,
      missing: ['clob'],
    })
  })

  it('--report tolerates a torn last line and reports per UTC day and timeframe', async () => {
    const env = makeEnv({ startMs: B - 595_000, timeframes: ['15m'] })
    await env.tickAt(B - 595_000)
    await env.tickAt(B - 55_000)
    const file = path.join(env.outDir, '2026-10-08.jsonl')
    fs.appendFileSync(file, '{"v":1,"origin":"gamma","slot":"fir')
    const report = buildReport({
      outDir: env.outDir,
      nowMs: B + 60_000,
      timeframes: ['15m'],
      days: 1,
    })
    assert.deepEqual(report.days, ['2026-10-08'])
    const row = report.rows[0]!
    // 2026-10-08 00:00 .. 23:30 UTC: 95 started 15m markets, one captured.
    assert.equal(row.coverage.counts.gridMarkets, 95)
    assert.deepEqual(row.coverage.counts.preStart200, { gamma: 1, clob: 1, both: 1 })
    assert.equal(row.coverage.missed.length, 94)
    assert.deepEqual(report.files, [
      {
        day: '2026-10-08',
        exists: true,
        lines: 4,
        byStatus: { '200': 4 },
        tornTail: true,
        malformed: 0,
      },
    ])
    const text = formatReport(report, env.outDir)
    assert.match(text, /2026-10-08\s+15m\s+95\s+1\s+1\s+1\s+1\.05%/)
    assert.match(
      text,
      /btc-updown-15m-1791417600 \.\. btc-updown-15m-1791501300 \(94 markets\)\s+missing gamma\+clob/,
    )
    assert.match(text, /torn_tail 1\s+malformed 0/)
  })
})

describe('watch', () => {
  it('runs one tick per minute at second 5 until stopped', async () => {
    const env = makeEnv({ startMs: B - 600_000 + 12_345, timeframes: ['15m'] })
    const controller = new AbortController()
    const ticks: number[] = []
    await runWatch(
      env.capture,
      {
        now: env.deps.now,
        sleep: env.deps.sleep,
        onTick: (result) => {
          ticks.push(result.tickMs)
          if (ticks.length === 4) controller.abort()
        },
      },
      controller.signal,
    )
    assert.deepEqual(ticks, [B - 535_000, B - 475_000, B - 415_000, B - 355_000])
    assert.ok(
      env.sleeps.every((ms) => ms <= 10_000),
      'long waits re-read the clock',
    )
  })
})
