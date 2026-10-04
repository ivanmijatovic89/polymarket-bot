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
) {
  const slug = `btc-updown-${timeframe}-${startMs / 1000}`
  const content = Buffer.from(`sample immutable event object for ${slug}`)
  const sha256 = createHash('sha256').update(content).digest('hex')
  const manifest: MarketManifest = {
    schemaVersion: 3,
    recordingId: 'recording-1',
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
      key: `${prefix}/${slug}/recording-1/events-${sha256}.parquet`,
      sha256,
      bytes: content.length,
      rows: 1,
      firstSequence: '1',
      lastSequence: '1',
    },
  }
  const bytes = Buffer.from(JSON.stringify(manifest))
  const manifestKey = `${prefix}/${slug}/recording-1/manifest-${createHash('sha256').update(bytes).digest('hex')}.json`
  store.objects.set(manifest.events.key, content)
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
