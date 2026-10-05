import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { CaptureClockMonitor, recorderError, runRecorder } from './daemon.js'
import type { RecorderConfig } from './config.js'
import type { FeedCallbacks, RecordedMarket } from './types.js'
import { ingressStamp } from './feeds/transport.js'
import { readCapturedEvents } from './storage/parquet.js'
import { readManifest } from './storage/manifest.js'
import { openCaptureSequence } from './sequence.js'
import type { BlobStore } from './storage/blobStore.js'
import type { RecorderStatus } from './statusTypes.js'
import { exists } from './storage/files.js'

function config(spoolDir: string): RecorderConfig {
  return {
    recorderId: 'test-recorder',
    spoolDir,
    archivePrefix: 'recorder-v3-test',
    timeframes: ['5m', '15m'],
    upload: false,
    durationMs: 50,
    maxSpoolBytes: 1_000_000_000,
    minFreeBytes: 1_000,
    maxPendingBytes: 10_000_000,
    redisUrl: null,
    statusEnabled: false,
    credentials: { apiKey: 'secret-key', secret: 'secret-body', passphrase: 'secret-passphrase' },
    r2: null,
  }
}

function mockFeeds(market: RecordedMarket, stopped: string[], permanent = false) {
  const simple = (name: string) => () => ({
    start() {},
    stop() {
      stopped.push(name)
    },
  })
  return {
    discover: async () => [market],
    disk: async () => ({ bytes: 0, freeBytes: 1_000_000_000 }),
    binance: simple('binance'),
    priceToBeat: simple('price_to_beat'),
    polybolt: (callbacks: FeedCallbacks) => ({
      start() {
        if (permanent)
          callbacks.onStatus({
            source: 'chainlink',
            connectionId: 'mock',
            stamp: ingressStamp(),
            kind: 'error',
            reason: 'authentication_rejected',
            details: { permanent: true },
          })
      },
      stop() {
        stopped.push('chainlink')
      },
    }),
    polymarket: (callbacks: FeedCallbacks) => ({
      setMarkets() {},
      reconnect() {},
      start() {
        callbacks.onFrame({
          source: 'polymarket',
          connectionId: 'mock',
          stamp: ingressStamp(),
          rawJson: JSON.stringify(
            market.tokenIds.map((asset_id) => ({
              event_type: 'book',
              market: market.conditionId,
              asset_id,
              timestamp: String(Date.now()),
              hash: '',
              bids: [{ price: '0.4', size: '20' }],
              asks: [{ price: '0.6', size: '10' }],
            })),
          ),
        })
      },
      stop() {
        stopped.push('polymarket')
      },
    }),
  }
}

function currentMarket(): RecordedMarket {
  const startMs = Math.floor(Date.now() / 1000) * 1000 - 1_000
  return {
    slug: `btc-updown-5m-${startMs / 1000}`,
    symbol: 'btc',
    timeframe: '5m',
    conditionId: 'mock',
    tokenIds: ['up', 'down'],
    outcomes: ['Up', 'Down'],
    startMs,
    endMs: startMs + 300_000,
    twapEnabled: true,
    twapLookbackSeconds: 60,
    resolutionSource: 'chainlink',
    rawJson: '{}',
  }
}

test('local daemon drains journals, finalizes mixed parquet, stops feeds, publishes stopped status, and releases its lock', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-daemon-'))
  try {
    const market = currentMarket()
    const stopped: string[] = []
    const result = await runRecorder(config(directory), {
      dependencies: mockFeeds(market, stopped),
      log: () => undefined,
    })
    assert.equal(result.state, 'stopped')
    assert.equal(result.reason, 'duration_complete')
    assert.deepEqual(stopped.sort(), ['binance', 'chainlink', 'polymarket', 'price_to_beat'])
    const packageName = (await readdir(directory)).find((name) => name.startsWith(market.slug))!
    const manifest = await readManifest(path.join(directory, packageName, 'manifest.json'))
    assert.equal(manifest.coverage.complete, false)
    assert.ok(manifest.coverage.gaps.some((gap) => gap.reason === 'duration_complete'))
    const rows = []
    for await (const event of readCapturedEvents(
      path.join(directory, packageName, 'events.parquet'),
    ))
      rows.push(event)
    assert.deepEqual(
      rows.map((row) => row.source),
      ['bootstrap', 'polymarket', 'control'],
    )
    assert.equal(
      JSON.parse(await readFile(path.join(directory, 'status.json'), 'utf8')).state,
      'stopped',
    )
    const restarted = await openCaptureSequence(directory)
    await restarted.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('permanent authentication failure produces a controlled error stop', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-daemon-auth-'))
  try {
    const result = await runRecorder(config(directory), {
      dependencies: mockFeeds(currentMarket(), [], true),
      log: () => undefined,
    })
    assert.equal(result.state, 'error')
    assert.equal(result.reason, 'authentication_rejected')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('invalid market input reconnects the feed and records recovery only after fresh books', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-daemon-rewarm-'))
  try {
    const market = currentMarket()
    const dependencies = mockFeeds(market, [])
    const reconnects: string[] = []
    const failedConnections: Array<string | undefined> = []
    dependencies.polymarket = (callbacks: FeedCallbacks) => {
      const send = (raw: unknown) =>
        callbacks.onFrame({
          source: 'polymarket',
          connectionId: 'mock',
          stamp: ingressStamp(),
          rawJson: JSON.stringify(raw),
        })
      const books = () =>
        send(
          market.tokenIds.map((asset_id) => ({
            event_type: 'book',
            market: market.conditionId,
            asset_id,
            timestamp: String(Date.now()),
            bids: [{ price: '0.4', size: '10' }],
            asks: [{ price: '0.6', size: '10' }],
          })),
        )
      return {
        setMarkets() {},
        stop() {},
        start() {
          books()
          send({ event_type: 'price_change', market: market.conditionId, price_changes: null })
        },
        reconnect(reason?: string, connectionId?: string) {
          failedConnections.push(connectionId)
          reconnects.push(reason ?? '')
          books()
        },
      }
    }
    const result = await runRecorder(config(directory), { dependencies, log: () => undefined })
    assert.equal(result.state, 'stopped')
    assert.deepEqual(reconnects, ['invalid_market_payload'])
    assert.deepEqual(failedConnections, ['mock'])
    const packageName = (await readdir(directory)).find((name) => name.startsWith(market.slug))!
    const manifest = await readManifest(path.join(directory, packageName, 'manifest.json'))
    const gap = manifest.coverage.gaps.find((item) => item.reason === 'invalid_market_payload')
    assert.ok(gap && gap.endMs !== null && gap.endMs < market.endMs)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('disk guard failure stops capture and retains its local recording', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-daemon-disk-'))
  try {
    let scans = 0
    const dependencies = {
      ...mockFeeds(currentMarket(), []),
      disk: async () => {
        if (++scans > 4) throw new Error('disk permission failure')
        return { bytes: 0, freeBytes: 1_000_000_000 }
      },
    }
    const result = await runRecorder(config(directory), { dependencies, log: () => undefined })
    assert.equal(result.state, 'error')
    assert.match(result.reason!, /cannot verify disk allowance/)
    assert.ok((await readdir(directory)).some((name) => name.startsWith('btc-updown')))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a full spool drains verified packages before opening feeds on restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-daemon-retry-'))
  try {
    const market = currentMarket()
    await runRecorder(config(directory), {
      dependencies: mockFeeds(market, []),
      log: () => undefined,
    })
    const packageName = (await readdir(directory)).find((name) => name.startsWith(market.slug))!
    const originalParquet = path.join(directory, packageName, 'events.parquet')
    const objects = new Map<string, Buffer>()
    const cloud: BlobStore & { close(): void } = {
      async putFile(key, file) {
        objects.set(key, await readFile(file))
      },
      async get(key) {
        const value = objects.get(key)
        return value
          ? (async function* () {
              yield value
            })()
          : null
      },
      async *list(prefix) {
        for (const key of objects.keys()) if (key.startsWith(prefix)) yield key
      },
      close() {},
    }
    let discoveryCalls = 0
    const result = await runRecorder(
      {
        ...config(directory),
        upload: true,
        r2: {
          endpoint: 'https://unused.invalid',
          bucket: 'test',
          accessKeyId: 'key',
          secretAccessKey: 'secret',
          prefix: 'recorder-v3-test',
        },
      },
      {
        dependencies: {
          ...mockFeeds(market, []),
          blobStore: () => cloud,
          disk: async () => ({
            bytes: (await exists(originalParquet)) ? 2_000_000_000 : 0,
            freeBytes: 1_000_000_000,
          }),
          discover: async () => {
            discoveryCalls++
            assert.equal(await exists(originalParquet), false)
            return [market]
          },
        },
        log: () => undefined,
      },
    )
    assert.equal(discoveryCalls, 1)
    assert.equal(result.state, 'stopped')
    assert.equal(result.archive.uploadedMarkets, 1)
    assert.ok([...objects.keys()].some((key) => key.includes('/manifest-')))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a spool that remains full preserves an error status without opening live feeds', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-daemon-full-'))
  try {
    const result = await runRecorder(config(directory), {
      dependencies: {
        ...mockFeeds(currentMarket(), []),
        discover: async () => {
          assert.fail('Discovery must not run while the spool is full')
        },
        disk: async () => ({ bytes: 2_000_000_000, freeBytes: 0 }),
      },
      log: () => undefined,
    })
    assert.equal(result.state, 'error')
    assert.match(result.reason!, /disk allowance exhausted/)
    const status = JSON.parse(await readFile(path.join(directory, 'status.json'), 'utf8'))
    assert.equal(status.state, 'error')
    const sequence = await openCaptureSequence(directory)
    await sequence.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

for (const healthyLastPackage of [true, false])
  test(`full-spool startup visits later archive batches and ${healthyLastPackage ? 'recovers after eight failures' : 'stops after one bounded sweep without progress'}`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-daemon-archive-sweep-'))
    try {
      const market = currentMarket()
      await runRecorder(config(directory), {
        dependencies: mockFeeds(market, []),
        log: () => undefined,
      })
      const packageName = (await readdir(directory)).find((name) => name.startsWith(market.slug))!
      const originalParquet = path.join(directory, packageName, 'events.parquet')
      const manifest = await readManifest(path.join(directory, packageName, 'manifest.json'))
      for (let index = 0; index < 8; index++) {
        const failedDirectory = path.join(directory, `aaa-failed-${index}`)
        await mkdir(failedDirectory)
        await copyFile(originalParquet, path.join(failedDirectory, 'events.parquet'))
        await writeFile(
          path.join(failedDirectory, 'manifest.json'),
          JSON.stringify({
            ...manifest,
            events: { ...manifest.events, key: `recorder-v3-test/failed/${index}/events.parquet` },
          }),
        )
      }
      const objects = new Map<string, Buffer>()
      const attemptedKeys: string[] = []
      const cloud: BlobStore & { close(): void } = {
        async putFile(key, file) {
          attemptedKeys.push(key)
          if (!healthyLastPackage || key.includes('/failed/'))
            throw new Error('Fixture upload failure')
          objects.set(key, await readFile(file))
        },
        async get(key) {
          const value = objects.get(key)
          return value
            ? (async function* () {
                yield value
              })()
            : null
        },
        async *list(prefix) {
          for (const key of objects.keys()) if (key.startsWith(prefix)) yield key
        },
        close() {},
      }
      let discoveryCalls = 0
      const result = await runRecorder(
        {
          ...config(directory),
          upload: true,
          r2: {
            endpoint: 'https://unused.invalid',
            bucket: 'test',
            accessKeyId: 'key',
            secretAccessKey: 'secret',
            prefix: 'recorder-v3-test',
          },
        },
        {
          dependencies: {
            ...mockFeeds(market, []),
            blobStore: () => cloud,
            disk: async () => ({
              bytes: (await exists(originalParquet)) ? 2_000_000_000 : 0,
              freeBytes: 1_000_000_000,
            }),
            discover: async () => {
              discoveryCalls++
              return [market]
            },
          },
          log: () => undefined,
        },
      )
      assert.ok(attemptedKeys.includes(manifest.events.key), 'the ninth package must be visited')
      assert.ok(attemptedKeys.length <= 25, 'a complete outage must not spin forever')
      assert.equal(discoveryCalls, healthyLastPackage ? 1 : 0)
      assert.equal(result.state, healthyLastPackage ? 'stopped' : 'error')
      assert.equal(result.archive.uploadedMarkets, healthyLastPackage ? 1 : 0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

test('missing a configured current timeframe remains visible as degraded with discovery context', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-daemon-discovery-'))
  const abort = new AbortController()
  try {
    const running = runRecorder(
      { ...config(directory), durationMs: null },
      {
        dependencies: mockFeeds(currentMarket(), []),
        signal: abort.signal,
        statusIntervalMs: 5,
        log: () => undefined,
      },
    )
    try {
      const deadline = Date.now() + 2000
      let status: { state: string; reason: string | null } | undefined
      while (Date.now() < deadline) {
        if (await exists(path.join(directory, 'status.json'))) {
          status = JSON.parse(await readFile(path.join(directory, 'status.json'), 'utf8'))
          if (status?.state === 'degraded') break
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      assert.equal(status?.state, 'degraded')
      assert.match(status?.reason ?? '', /Missing current 15m market; last discovery \d+ms ago/)
    } finally {
      abort.abort()
      await running
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('dashboard preserves partial socket failure and counts reconnects independently', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-daemon-sockets-'))
  const abort = new AbortController()
  const five = currentMarket()
  const fifteen: RecordedMarket = {
    ...five,
    timeframe: '15m',
    slug: 'btc-updown-15m-test',
    conditionId: 'fifteen',
    tokenIds: ['up-fifteen', 'down-fifteen'],
  }
  let callbacks: FeedCallbacks | undefined
  const status = (
    timeframe: '5m' | '15m',
    kind: Parameters<FeedCallbacks['onStatus']>[0]['kind'],
  ) =>
    callbacks!.onStatus({
      source: 'polymarket',
      connectionId: timeframe,
      channelId: `polymarket:${timeframe}`,
      marketSlugs: [timeframe === '5m' ? five.slug : fifteen.slug],
      stamp: ingressStamp(),
      kind,
    })
  const frame = (m: RecordedMarket) =>
    callbacks!.onFrame({
      source: 'polymarket',
      connectionId: m.timeframe,
      channelId: `polymarket:${m.timeframe}`,
      marketSlugs: [m.slug],
      stamp: ingressStamp(),
      rawJson: 'PONG',
    })
  const readStatus = async (expected: string, reconnects: number) => {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      if (await exists(path.join(directory, 'status.json'))) {
        const value = JSON.parse(
          await readFile(path.join(directory, 'status.json'), 'utf8'),
        ) as RecorderStatus
        const feed = value.feeds.find((f) => f.feed === 'polymarket')!
        if (feed.state === expected && feed.reconnects === reconnects) return value
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`Did not observe ${expected} with ${reconnects} reconnects`)
  }
  const running = runRecorder(
    { ...config(directory), durationMs: null },
    {
      dependencies: {
        ...mockFeeds(five, []),
        discover: async () => [five, fifteen],
        polymarket: (options) => {
          callbacks = options
          return {
            setMarkets() {},
            reconnect() {},
            stop() {},
            start() {
              for (const m of [five, fifteen]) {
                status(m.timeframe, 'connecting')
                status(m.timeframe, 'connected')
                frame(m)
              }
            },
          }
        },
      },
      signal: abort.signal,
      statusIntervalMs: 5,
      log: () => undefined,
    },
  )
  try {
    await readStatus('receiving', 0)
    status('5m', 'disconnected')
    frame(fifteen)
    assert.equal((await readStatus('disconnected', 0)).state, 'degraded')
    status('5m', 'connecting')
    frame(fifteen)
    await readStatus('connecting', 1)
    status('5m', 'connected')
    frame(five)
    await readStatus('receiving', 1)
    status('5m', 'stopped')
    await readStatus('receiving', 1)
  } finally {
    abort.abort()
    await running
    await rm(directory, { recursive: true, force: true })
  }
})

test('clock monitor distinguishes process pauses from clock steps before another market boundary is routed', () => {
  const monitor = new CaptureClockMonitor({ receivedAtMs: 10_000, monotonicNs: '0' })
  assert.equal(monitor.observe({ receivedAtMs: 10_100, monotonicNs: '100000000' }), null)
  assert.deepEqual(monitor.observe({ receivedAtMs: 14_000, monotonicNs: '4000000000' }), {
    startMs: 10_100,
    endMs: 14_000,
    reason: 'capture_event_loop_gap',
    fatal: false,
  })
  assert.equal(monitor.observe({ receivedAtMs: 9_000, monotonicNs: '4100000000' })?.fatal, true)
})

test('configured credentials and Redis URL never appear in diagnostics', () => {
  const cfg = { ...config('/tmp/unused'), redisUrl: 'redis://private-password@host:6379' }
  const output = recorderError(
    new Error(
      `${cfg.credentials.apiKey} ${cfg.credentials.secret} ${cfg.credentials.passphrase} ${cfg.redisUrl}`,
    ),
    cfg,
  )
  assert.equal(output, '[redacted] [redacted] [redacted] [redacted]')
})
