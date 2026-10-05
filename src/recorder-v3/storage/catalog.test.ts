import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  downloadRecordedMarkets,
  listRecordedMarkets,
  loadCatalogConfig,
  parseCatalogArgs,
} from './catalog.js'
import type { BlobStore } from './blobStore.js'
import { downloadMarket, readRemoteManifest } from './archive.js'
import type { MarketManifest } from './manifest.js'
import type { RecorderTimeframe } from '../types.js'

class CatalogStore implements BlobStore {
  objects = new Map<string, Buffer>()
  gets: string[] = []
  async putFile(): Promise<void> {
    throw new Error('Catalog/download must never write remote objects')
  }
  async get(key: string): Promise<AsyncIterable<Uint8Array> | null> {
    this.gets.push(key)
    const value = this.objects.get(key)
    return value
      ? (async function* () {
          yield value
        })()
      : null
  }
  async *list(prefix: string): AsyncIterable<string> {
    for (const key of [...this.objects.keys()].sort()) if (key.startsWith(prefix)) yield key
  }
}

function addMarket(
  store: CatalogStore,
  startMs: number,
  timeframe: RecorderTimeframe,
  prefix = 'recorder-v3',
  options: { archiveLayout?: MarketManifest['archiveLayout']; recordingId?: string } = {},
) {
  const slug = `btc-updown-${timeframe}-${startMs / 1000}`
  const recordingId = options.recordingId ?? 'recording-1'
  const directory = `${prefix}/${options.archiveLayout ? `btc/${timeframe}/` : ''}${slug}/${recordingId}`
  const content = Buffer.from(`sample immutable event object for ${slug}`)
  const sha256 = createHash('sha256').update(content).digest('hex')
  const manifest: MarketManifest = {
    schemaVersion: 3,
    ...(options.archiveLayout ? { archiveLayout: options.archiveLayout } : {}),
    recordingId,
    market: {
      slug,
      symbol: 'btc',
      timeframe,
      conditionId: 'condition',
      tokenIds: ['up', 'down'],
      outcomes: ['Up', 'Down'],
      startMs,
      endMs: startMs + (timeframe === '5m' ? 300_000 : 900_000),
      twapEnabled: true,
      twapLookbackSeconds: 60,
      resolutionSource: null,
      rawJson: '{}',
    },
    coverage: {
      complete: true,
      startedAtMs: startMs,
      endedAtMs: startMs + 300_000,
      missingInitialBook: false,
      gaps: [],
      warnings: [],
    },
    createdAtMs: startMs,
    finalizedAtMs: startMs + 300_000,
    events: {
      key: `${directory}/events-${sha256}.parquet`,
      sha256,
      bytes: content.length,
      rows: 1,
      firstSequence: '1',
      lastSequence: '1',
    },
  }
  store.objects.set(manifest.events.key, content)
  return publishManifest(store, manifest)
}

function publishManifest(store: CatalogStore, manifest: MarketManifest) {
  const bytes = Buffer.from(JSON.stringify(manifest))
  const manifestKey = `${path.posix.dirname(manifest.events.key)}/manifest-${createHash('sha256').update(bytes).digest('hex')}.json`
  store.objects.set(manifestKey, bytes)
  return { manifest, manifestKey }
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const item of items) values.push(item)
  return values
}

async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-catalog-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('catalog discovers committed manifests only and filters market opening times in UTC', async () => {
  const store = new CatalogStore()
  const fromMs = Date.parse('2026-10-01T00:00:00Z')
  const desired = addMarket(store, fromMs, '5m')
  addMarket(store, fromMs, '15m')
  addMarket(store, fromMs - 300_000, '5m')
  addMarket(store, fromMs + 300_000, '5m')
  addMarket(store, fromMs, '5m', 'recorder-v3-unrelated')
  store.objects.set('recorder-v3/unfinished/events-deadbeef.parquet', Buffer.from('uncommitted'))
  store.objects.set('recorder-v3/unfinished/resolutions/100-observation.json', Buffer.from('{}'))
  assert.deepEqual(
    await collect(
      listRecordedMarkets(store, {
        prefix: 'recorder-v3',
        timeframe: '5m',
        fromMs,
        toMs: fromMs + 300_000,
      }),
    ),
    [desired],
  )
  assert.deepEqual(store.gets, [desired.manifestKey])
})

test('catalog rejects corrupted committed metadata instead of silently listing a false package', async () => {
  const store = new CatalogStore()
  const entry = addMarket(store, Date.parse('2026-10-01T00:00:00Z'), '15m')
  store.objects.set(entry.manifestKey, Buffer.from('{}'))
  await assert.rejects(
    collect(listRecordedMarkets(store, { prefix: 'recorder-v3' })),
    /integrity check failed/,
  )
})

test('mixed archive layouts list, filter and download without changing immutable legacy objects', async (t) => {
  const cache = await temporary(t)
  const store = new CatalogStore()
  const prefix = 'validation/nested-prefix'
  const start = Date.parse('2026-10-01T00:00:00Z')
  const legacy = addMarket(store, start, '5m', prefix)
  const current = addMarket(store, start, '5m', prefix, {
    archiveLayout: 'symbol-timeframe',
    recordingId: 'recording-2',
  })
  const fifteen = addMarket(store, start, '15m', prefix, { archiveLayout: 'symbol-timeframe' })
  const next = addMarket(store, start + 300_000, '5m', prefix, {
    archiveLayout: 'symbol-timeframe',
  })
  const original = new Map([...store.objects].map(([key, body]) => [key, Buffer.from(body)]))
  const all = await collect(listRecordedMarkets(store, { prefix }))
  assert.deepEqual(
    new Set(all.map((entry) => entry.manifestKey)),
    new Set([legacy, current, fifteen, next].map((entry) => entry.manifestKey)),
  )
  store.gets = []
  const selected = await collect(
    listRecordedMarkets(store, { prefix, timeframe: '5m', fromMs: start, toMs: start + 300_000 }),
  )
  assert.deepEqual(
    new Set(selected.map((entry) => entry.manifestKey)),
    new Set([legacy.manifestKey, current.manifestKey]),
  )
  assert.deepEqual(new Set(store.gets), new Set([legacy.manifestKey, current.manifestKey]))
  assert.deepEqual(
    await downloadRecordedMarkets(store, listRecordedMarkets(store, { prefix }), cache),
    { downloaded: 4, failed: 0 },
  )
  for (const entry of all) {
    const direct = await readRemoteManifest(store, entry.manifestKey)
    assert.deepEqual(direct.manifest, entry.manifest)
    const downloaded = await downloadMarket(store, entry.manifestKey, cache)
    assert.equal(
      downloaded.manifestPath,
      path.join(cache, entry.manifest.market.slug, entry.manifest.recordingId, 'manifest.json'),
    )
    assert.equal(
      await readFile(downloaded.manifestPath, 'utf8'),
      original.get(entry.manifestKey)!.toString(),
    )
  }
  assert.deepEqual(store.objects, original)
})

test('legacy prefixes containing symbol and duration names keep their exact-manifest meaning', async (t) => {
  const cache = await temporary(t)
  const store = new CatalogStore()
  const prefix = 'legacy/btc/5m'
  const entry = addMarket(store, Date.parse('2026-10-01T00:00:00Z'), '15m', prefix)
  assert.deepEqual(await collect(listRecordedMarkets(store, { prefix })), [entry])
  assert.equal(
    (await readRemoteManifest(store, entry.manifestKey)).manifest.archiveLayout,
    undefined,
  )
  const downloaded = await downloadMarket(store, entry.manifestKey, cache)
  assert.equal(downloaded.manifest.market.timeframe, '15m')
})

test('a duplicate recording identity in another layout cannot replace an existing immutable cache', async (t) => {
  const cache = await temporary(t)
  const store = new CatalogStore()
  const start = Date.parse('2026-10-01T00:00:00Z')
  const legacy = addMarket(store, start, '5m')
  const structured = addMarket(store, start, '5m', 'recorder-v3', {
    archiveLayout: 'symbol-timeframe',
  })
  const cached = await downloadMarket(store, legacy.manifestKey, cache)
  const original = await readFile(cached.manifestPath, 'utf8')
  await assert.rejects(
    downloadMarket(store, structured.manifestKey, cache),
    /different immutable manifest/,
  )
  assert.equal(await readFile(cached.manifestPath, 'utf8'), original)
  assert.deepEqual(
    await readFile(cached.parquetPath),
    store.objects.get(legacy.manifest.events.key),
  )
})

test('catalog requires the layout discriminator for structured keys and rejects unknown discriminators', async () => {
  for (const archiveLayout of [undefined, 'unknown' as MarketManifest['archiveLayout']]) {
    const store = new CatalogStore()
    const entry = addMarket(store, Date.parse('2026-10-01T00:00:00Z'), '5m', 'recorder-v3', {
      archiveLayout: 'symbol-timeframe',
    })
    store.objects.delete(entry.manifestKey)
    const invalid = publishManifest(store, { ...entry.manifest, archiveLayout })
    await assert.rejects(
      collect(listRecordedMarkets(store, { prefix: 'recorder-v3' })),
      /archiveLayout/,
    )
    if (archiveLayout !== undefined)
      await assert.rejects(readRemoteManifest(store, invalid.manifestKey), /archiveLayout/)
  }
})

test('catalog and exact downloads reject structured symbol, duration and recording mismatches', async (t) => {
  const cache = await temporary(t)
  for (const mutation of [
    'symbol',
    'duration',
    'recording',
    'slug',
    'market-duration',
    'window-duration',
  ] as const) {
    const store = new CatalogStore()
    const original = addMarket(store, Date.parse('2026-10-01T00:00:00Z'), '5m', 'recorder-v3', {
      archiveLayout: 'symbol-timeframe',
    })
    store.objects.delete(original.manifestKey)
    const manifest = structuredClone(original.manifest)
    if (mutation === 'symbol') manifest.events.key = manifest.events.key.replace('/btc/', '/eth/')
    if (mutation === 'duration') manifest.events.key = manifest.events.key.replace('/5m/', '/15m/')
    if (mutation === 'recording')
      manifest.events.key = manifest.events.key.replace('/recording-1/', '/recording-2/')
    if (mutation === 'slug')
      manifest.events.key = manifest.events.key.replace('/btc-updown-5m-', '/btc-updown-15m-')
    if (mutation === 'market-duration') manifest.market.timeframe = '15m'
    if (mutation === 'window-duration') manifest.market.endMs += 600_000
    const invalid = publishManifest(store, manifest)
    await assert.rejects(collect(listRecordedMarkets(store, { prefix: 'recorder-v3' })), /match/)
    await assert.rejects(readRemoteManifest(store, invalid.manifestKey), /match/)
    await assert.rejects(downloadMarket(store, invalid.manifestKey, cache), /match/)
  }
})

test('legacy exact reads reject package directories that disagree with manifest identity', async () => {
  for (const field of ['slug', 'recordingId'] as const) {
    const store = new CatalogStore()
    const entry = addMarket(store, Date.parse('2026-10-01T00:00:00Z'), '5m')
    store.objects.delete(entry.manifestKey)
    const manifest = structuredClone(entry.manifest)
    const component = field === 'slug' ? manifest.market.slug : manifest.recordingId
    manifest.events.key = manifest.events.key.replace(`/${component}/`, '/wrong-identity/')
    const invalid = publishManifest(store, manifest)
    await assert.rejects(readRemoteManifest(store, invalid.manifestKey), /identity does not match/)
  }
})

test('sequential downloads retain successful packages and report partial integrity failures', async (t) => {
  const directory = await temporary(t)
  const store = new CatalogStore()
  const first = addMarket(store, Date.parse('2026-10-01T00:00:00Z'), '5m')
  const second = addMarket(store, Date.parse('2026-10-01T00:05:00Z'), '5m')
  store.objects.set(first.manifest.events.key, Buffer.from('corruption'))
  const failed: string[] = []
  const result = await downloadRecordedMarkets(
    store,
    listRecordedMarkets(store, { prefix: 'recorder-v3' }),
    directory,
    { onError: (entry) => failed.push(entry.manifestKey) },
  )
  assert.deepEqual(result, { downloaded: 1, failed: 1 })
  assert.deepEqual(failed, [first.manifestKey])
  const cache = path.join(directory, second.manifest.market.slug, second.manifest.recordingId)
  assert.deepEqual(
    await readFile(path.join(cache, 'events.parquet')),
    store.objects.get(second.manifest.events.key),
  )
  assert.deepEqual(JSON.parse(await readFile(path.join(cache, 'resolutions.json'), 'utf8')), [])
})

test('catalog argument validation makes date bounds and cache destination explicit', () => {
  const parsed = parseCatalogArgs([
    'download',
    '--output',
    './cache',
    '--timeframe',
    '5m',
    '--from',
    '2026-10-01',
    '--to',
    '2026-11-01',
  ])
  assert.equal(parsed.fromMs, Date.parse('2026-10-01T00:00:00Z'))
  assert.equal(parsed.toMs, Date.parse('2026-11-01T00:00:00Z'))
  assert.equal(parsed.output, path.resolve('./cache'))
  assert.throws(() => parseCatalogArgs(['download']), /explicit --output/)
  assert.throws(() => parseCatalogArgs(['list', '--from', '2026-02-31']), /Invalid/)
  assert.throws(() => parseCatalogArgs(['list', '--from', '2026-10-01T12:00:00']), /ending in Z/)
  assert.throws(
    () => parseCatalogArgs(['list', '--from', '2026-11-01', '--to', '2026-10-01']),
    /before/,
  )
  assert.throws(() => parseCatalogArgs(['list', '--prefix', '../existing']), /prefix/)
  assert.throws(() => parseCatalogArgs(['list', '--timeframe', '1h']), /Timeframe/)
  assert.throws(
    () => parseCatalogArgs(['list', '--manifest', 'key', '--timeframe', '5m']),
    /cannot be combined/,
  )
})

test('catalog loads only explicit R2 settings without CLOB credentials or environment mutation', async (t) => {
  const directory = await temporary(t)
  const file = path.join(directory, 'archive.env')
  await writeFile(
    file,
    'R2_ENDPOINT=https://example.r2.cloudflarestorage.com\nR2_BUCKET=recorder-test\nR2_ACCESS_KEY_ID=test-key\nR2_SECRET_ACCESS_KEY=test-secret\nPRIVATE_KEY=unused-wallet-sentinel\nRECORDER_R2_PREFIX=recorder-v3-tests\n',
  )
  const before = JSON.stringify({ ...process.env })
  const args = parseCatalogArgs(['list', '--env-file', file])
  const config = await loadCatalogConfig(args, {})
  assert.equal(config.filter.prefix, 'recorder-v3-tests')
  assert.doesNotMatch(JSON.stringify(config), /unused-wallet-sentinel/)
  assert.ok(JSON.stringify({ ...process.env }) === before, 'Catalog must not mutate process.env')
  const manifestKey = `recorder-v3-tests/market/recording/manifest-${'a'.repeat(64)}.json`
  const exact = await loadCatalogConfig(
    parseCatalogArgs([
      'list',
      '--env-file',
      file,
      '--manifest',
      `r2://recorder-test/${manifestKey}`,
    ]),
    {},
  )
  assert.equal(exact.manifestKey, manifestKey)
  await assert.rejects(
    loadCatalogConfig(
      parseCatalogArgs([
        'list',
        '--env-file',
        file,
        '--manifest',
        `r2://wrong-bucket/${manifestKey}`,
      ]),
      {},
    ),
    /configured R2 bucket/,
  )
})
