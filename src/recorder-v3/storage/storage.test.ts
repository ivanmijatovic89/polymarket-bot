import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import { appendFile, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  appendResolutionHistory,
  ArchiveService,
  downloadMarket,
  downloadResolutions,
} from './archive.js'
import type { BlobStore } from './blobStore.js'
import { exists } from './files.js'
import { DurableMarketStore } from './marketStore.js'
import { readCapturedEvents } from './parquet.js'
import { resolutionFingerprint, RESOLUTION_CONFIRMATION_MS } from './resolutionArtifact.js'
import type {
  CapturedEvent,
  MarketCoverage,
  RecordedMarket,
  ResolutionObservation,
} from '../types.js'

const market: RecordedMarket = {
  slug: 'btc-updown-15m-1700000000',
  symbol: 'btc',
  timeframe: '15m',
  conditionId: 'condition',
  tokenIds: ['up', 'down'],
  outcomes: ['Up', 'Down'],
  startMs: 1_700_000_000_000,
  endMs: 1_700_000_900_000,
  twapEnabled: true,
  twapLookbackSeconds: 60,
  resolutionSource: 'chainlink',
  rawJson: '{"unchanged":"metadata"}',
}
const coverage: MarketCoverage = {
  complete: true,
  startedAtMs: market.startMs,
  endedAtMs: market.endMs,
  missingInitialBook: false,
  gaps: [],
  warnings: [],
}

function event(sequence: number, source: CapturedEvent['source'] = 'binance'): CapturedEvent {
  return {
    schemaVersion: 3,
    captureId: 'recorder-1',
    sessionId: 'session-1',
    sequence: String(sequence),
    eventId: `recorder-1:${sequence}`,
    receivedAtMs: market.startMs + sequence,
    monotonicNs: String(9_000_000_000n + BigInt(sequence)),
    source,
    connectionId: `${source}-1`,
    eventType: 'message',
    sourceTimeMs: null,
    rawJson: '[{"price":"12345.12345678901234567890"},{"value":"different"}]',
    detailsJson: null,
  }
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const item of items) values.push(item)
  return values
}

class MemoryStore implements BlobStore {
  readonly objects = new Map<string, Buffer>()
  readonly puts: string[] = []
  ambiguousSuccess = false
  corruptPut = false
  rejectManifest = false
  async putFile(key: string, file: string): Promise<void> {
    this.puts.push(key)
    if (this.rejectManifest && key.includes('/manifest-'))
      throw new Error('Offline before manifest upload')
    this.objects.set(key, this.corruptPut ? Buffer.from('corrupt') : await readFile(file))
    if (this.ambiguousSuccess) throw new Error('Response lost after commit')
  }
  async get(key: string): Promise<AsyncIterable<Uint8Array> | null> {
    const body = this.objects.get(key)
    return body
      ? (async function* () {
          yield body
        })()
      : null
  }
  async *list(prefix: string): AsyncIterable<string> {
    for (const key of this.objects.keys()) if (key.startsWith(prefix)) yield key
  }
}

async function temporary(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-storage-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function finalized(spoolDir: string) {
  const store = new DurableMarketStore({ spoolDir, rowGroupSize: 2 })
  const directory = await store.openMarket(market)
  const rows = [event(1), event(2, 'polymarket'), event(3, 'chainlink')]
  await Promise.all(rows.map((row) => store.append(market.slug, row)))
  const ready = await store.finalize(market.slug, coverage)
  return { ...ready, directory, rows }
}

test('combined Parquet preserves shared receipt sequence, exact raw values and source timestamps', async (t) => {
  const ready = await finalized(await temporary(t))
  assert.deepEqual(
    await collect(readCapturedEvents(path.join(ready.directory, 'events.parquet'))),
    ready.rows,
  )
  assert.equal(ready.manifest.events.rows, 3)
  assert.equal(ready.manifest.events.firstSequence, '1')
  assert.equal(ready.manifest.events.lastSequence, '3')
  assert.equal(ready.manifest.coverage.complete, true)
  assert.equal(ready.manifest.archiveLayout, 'symbol-timeframe')
  assert.equal(
    ready.manifest.events.key,
    `recorder-v3/btc/15m/${market.slug}/${ready.manifest.recordingId}/events-${ready.manifest.events.sha256}.parquet`,
  )
})

test('new five-minute archives place events, manifests and resolutions under the same typed hierarchy', async (t) => {
  const spoolDir = await temporary(t)
  const five: RecordedMarket = {
    ...market,
    timeframe: '5m',
    slug: market.slug.replace('-15m-', '-5m-'),
    endMs: market.startMs + 300_000,
  }
  const store = new DurableMarketStore({ spoolDir, prefix: 'validation/nested' })
  await store.openMarket(five)
  await store.append(five.slug, event(1))
  const ready = await store.finalize(five.slug, { ...coverage, endedAtMs: five.endMs })
  const cloud = new MemoryStore()
  const archive = new ArchiveService({ spoolDir, blobStore: cloud })
  await archive.queueResolution(ready.directory, {
    schemaVersion: 3,
    slug: five.slug,
    conditionId: five.conditionId,
    observedAtMs: five.endMs + 1_000,
    status: 'pending',
    winningOutcome: null,
    winningTokenId: null,
    payouts: null,
    priceToBeat: null,
    finalPrice: null,
    source: 'gamma',
    rawJson: '{}',
  })
  const result = await archive.runOnce()
  assert.deepEqual(result.failures, [])
  assert.equal(ready.manifest.archiveLayout, 'symbol-timeframe')
  const directory = `validation/nested/btc/5m/${five.slug}/${ready.manifest.recordingId}/`
  assert.equal(cloud.puts.length, 3)
  assert(cloud.puts.every((key) => key.startsWith(directory)))
  assert(cloud.puts.some((key) => key.startsWith(`${directory}resolutions/`)))
  const downloaded = await downloadMarket(
    cloud,
    result.uploaded[0]!.manifestKey,
    path.join(spoolDir, 'cache'),
  )
  assert.deepEqual(await collect(readCapturedEvents(downloaded.parquetPath)), [event(1)])
})

test('archiving an already finalized legacy package preserves its original key and manifest bytes', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  delete ready.manifest.archiveLayout
  ready.manifest.events.key = ready.manifest.events.key.replace('/btc/15m/', '/')
  const original = `${JSON.stringify(ready.manifest, null, 2)}\n`
  await writeFile(path.join(ready.directory, 'manifest.json'), original)
  const cloud = new MemoryStore()
  const result = await new ArchiveService({ spoolDir, blobStore: cloud }).runOnce()
  assert.deepEqual(result.failures, [])
  assert.equal(cloud.puts[0], ready.manifest.events.key)
  assert.equal(cloud.objects.get(result.uploaded[0]!.manifestKey)!.toString(), original)
  assert.equal(await readFile(path.join(ready.directory, 'manifest.json'), 'utf8'), original)
})

test('SIGKILL plus a torn tail recovers the same market into one Parquet with an explicit gap', async (t) => {
  const spoolDir = await temporary(t)
  const script = `
    import { DurableMarketStore } from ${JSON.stringify(new URL('./marketStore.ts', import.meta.url).href)};
    const store = new DurableMarketStore({spoolDir:${JSON.stringify(spoolDir)}});
    await store.openMarket(${JSON.stringify(market)});
    await store.append(${JSON.stringify(market.slug)},${JSON.stringify(event(1))});
    console.log('durable');
    setInterval(() => {}, 1000);
  `
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (bytes: Buffer) => {
    stderr += bytes.toString()
  })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000)
  t.after(async () => {
    clearTimeout(timeout)
    if (child.exitCode === null) child.kill('SIGKILL')
  })
  const [bytes] = (await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(() => {
      throw new Error(`Crash-test child exited before writing: ${stderr}`)
    }),
  ])) as [Buffer]
  assert.match(bytes.toString(), /durable/, stderr)
  const finished = once(child, 'exit')
  child.kill('SIGKILL')
  await finished
  clearTimeout(timeout)
  const [name] = await readdir(spoolDir)
  assert.ok(name)
  const directory = path.join(spoolDir, name)
  await appendFile(path.join(directory, 'wal-000000.jsonl'), '{"sha256":"torn')
  const resumed = new DurableMarketStore({ spoolDir })
  const recovery = await resumed.recover(market.startMs + 500)
  assert.deepEqual(recovery.active, [market])
  assert.equal(await resumed.openMarket(market), directory)
  await resumed.append(market.slug, { ...event(100), sessionId: 'session-2' })
  const ready = await resumed.finalize(market.slug, coverage)
  const rows = await collect(readCapturedEvents(path.join(directory, 'events.parquet')))
  assert.deepEqual(
    rows.map((row) => row.sequence),
    ['1', '100'],
  )
  assert.equal(ready.manifest.coverage.complete, false)
  assert.equal(ready.manifest.coverage.gaps.length, 6)
  assert.match(await readFile(path.join(directory, 'wal-000000.jsonl'), 'utf8'), /torn$/)
})

test('archive accepts ambiguous successful uploads only after read-back and publishes manifest last', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  const cloud = new MemoryStore()
  cloud.ambiguousSuccess = true
  const archive = new ArchiveService({ spoolDir, blobStore: cloud })
  const result = await archive.runOnce()
  assert.deepEqual(result.failures, [])
  assert.equal(result.uploaded.length, 1)
  assert.match(cloud.puts[0]!, /events-[a-f0-9]{64}\.parquet$/)
  assert.match(cloud.puts[1]!, /manifest-[a-f0-9]{64}\.json$/)
  assert.equal(await exists(path.join(ready.directory, 'events.parquet')), false)
  assert.equal(
    (await readdir(ready.directory)).some((name) => name.startsWith('wal-')),
    false,
  )
  assert.equal(await exists(path.join(ready.directory, 'resolution.pending.json')), true)
  assert.equal((await archive.runOnce()).uploaded.length, 0)
  const cached = await downloadMarket(
    cloud,
    result.uploaded[0]!.manifestKey,
    path.join(spoolDir, 'cache'),
  )
  assert.deepEqual(await collect(readCapturedEvents(cached.parquetPath)), ready.rows)
  await writeFile(cached.parquetPath, 'damaged worker cache')
  assert.equal(
    (await downloadMarket(cloud, result.uploaded[0]!.manifestKey, path.join(spoolDir, 'cache')))
      .parquetPath,
    cached.parquetPath,
  )
  assert.deepEqual(await collect(readCapturedEvents(cached.parquetPath)), ready.rows)
})

test('corrupt remote data never permits manifest publication or local deletion', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  const cloud = new MemoryStore()
  cloud.corruptPut = true
  const archive = new ArchiveService({ spoolDir, blobStore: cloud })
  const result = await archive.runOnce()
  assert.match(result.failures[0]!.message, /integrity verification/)
  assert.equal(await exists(path.join(ready.directory, 'events.parquet')), true)
  assert.equal(await exists(path.join(ready.directory, 'wal-000000.jsonl')), true)
  assert.equal(await exists(path.join(ready.directory, 'archived.json')), false)
  assert.equal(
    [...cloud.objects.keys()].some((key) => key.includes('/manifest-')),
    false,
  )
  cloud.corruptPut = false
  assert.match(
    (await new ArchiveService({ spoolDir, blobStore: cloud }).runOnce()).failures[0]!.message,
    /Existing archive object failed/,
  )
})

test('corrupt or mismatched archive receipts never authorize event deletion or recovery skips', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  const cloud = new MemoryStore()
  for (const receipt of [
    '{broken',
    JSON.stringify({ manifestKey: 'other/manifest.json', verifiedAtMs: Date.now() }),
  ]) {
    await writeFile(path.join(ready.directory, 'archived.json'), receipt)
    const result = await new ArchiveService({ spoolDir, blobStore: cloud }).runOnce()
    assert.equal(result.failures.length, 1)
    assert.deepEqual(result.attemptedDirectories, [ready.directory])
    assert.equal(await exists(path.join(ready.directory, 'events.parquet')), true)
    assert.equal(await exists(path.join(ready.directory, 'wal-000000.jsonl')), true)
    assert.equal(cloud.objects.size, 0)
    await assert.rejects(new DurableMarketStore({ spoolDir }).recover())
  }
})

test('a corrupt resolution outbox fails before upload and retains the original diagnostic artifact', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  const cloud = new MemoryStore()
  const archive = new ArchiveService({ spoolDir, blobStore: cloud })
  await archive.runOnce()
  await archive.queueResolution(ready.directory, {
    schemaVersion: 3,
    slug: market.slug,
    conditionId: market.conditionId,
    observedAtMs: market.endMs + 1_000,
    status: 'resolved',
    winningOutcome: 'Up',
    winningTokenId: 'up',
    payouts: { up: '1', down: '0' },
    priceToBeat: '85000',
    finalPrice: '85001',
    source: 'gamma',
    rawJson: '{}',
  })
  const outbox = path.join(ready.directory, 'resolution-outbox')
  const [name] = await readdir(outbox)
  const file = path.join(outbox, name!)
  const original = await readFile(file, 'utf8')
  await writeFile(file, original.replace('85001', '95001'))
  const result = await archive.runOnce()
  assert.match(result.failures[0]!.message, /Resolution integrity check failed/)
  assert.equal(await exists(file), true)
  assert.equal(
    cloud.puts.some((key) => key.includes('/resolutions/')),
    false,
  )
  assert.equal(await exists(path.join(ready.directory, 'resolutions.json')), false)
})

test('restart retries a failed manifest publication without re-uploading verified events', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  const cloud = new MemoryStore()
  cloud.rejectManifest = true
  assert.equal(
    (await new ArchiveService({ spoolDir, blobStore: cloud }).runOnce()).failures.length,
    1,
  )
  assert.equal(await exists(path.join(ready.directory, 'events.parquet')), true)
  cloud.rejectManifest = false
  const result = await new ArchiveService({ spoolDir, blobStore: cloud }).runOnce()
  assert.equal(result.uploaded.length, 1)
  assert.equal(cloud.puts.filter((key) => key.endsWith('.parquet')).length, 1)
  assert.equal(await exists(path.join(ready.directory, 'events.parquet')), false)
})

test('later resolution revisions remain discoverable and verified after event data deletion', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  const cloud = new MemoryStore()
  const archive = new ArchiveService({ spoolDir, blobStore: cloud })
  const result = await archive.runOnce()
  const observation: ResolutionObservation = {
    schemaVersion: 3,
    slug: market.slug,
    conditionId: market.conditionId,
    observedAtMs: market.endMs + 1000,
    status: 'resolved',
    winningOutcome: 'Up',
    winningTokenId: 'up',
    payouts: { up: '1', down: '0' },
    priceToBeat: '85300.123',
    finalPrice: '85400.456',
    source: 'gamma',
    rawJson: '{"closed":true}',
  }
  await archive.queueResolution(ready.directory, observation)
  assert.deepEqual((await archive.runOnce()).failures, [])
  const disputed = {
    ...observation,
    observedAtMs: observation.observedAtMs + 1000,
    status: 'disputed' as const,
    winningOutcome: null,
    winningTokenId: null,
    payouts: null,
  }
  await archive.queueResolution(ready.directory, disputed)
  await new ArchiveService({ spoolDir, blobStore: cloud }).runOnce()
  assert.deepEqual(await downloadResolutions(cloud, ready.manifest), [observation, disputed])
  const cached = await downloadMarket(
    cloud,
    result.uploaded[0]!.manifestKey,
    path.join(spoolDir, 'cache'),
  )
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(path.dirname(cached.manifestPath), 'resolutions.json'), 'utf8'),
    ),
    [observation, disputed],
  )
  assert.deepEqual(
    JSON.parse(await readFile(path.join(ready.directory, 'resolutions.json'), 'utf8')),
    [observation, disputed],
  )
})

test('bounded journal rejects overload instead of accepting an unbounded queue', async (t) => {
  const spoolDir = await temporary(t)
  const store = new DurableMarketStore({ spoolDir, maxPendingBytes: 64 })
  const directory = await store.openMarket(market)
  await assert.rejects(store.append(market.slug, event(1)), /backpressure/)
  await assert.rejects(store.finalize(market.slug, coverage), /backpressure/)
  assert.equal(await exists(path.join(directory, 'manifest.json')), false)
  assert.equal(await exists(path.join(directory, 'wal-000000.jsonl')), true)
})

test(
  'awaited append continuations cannot strand a row between drain completion and queue release',
  { timeout: 5000 },
  async (t) => {
    const spoolDir = await temporary(t)
    const store = new DurableMarketStore({ spoolDir })
    t.after(() => store.close())
    const directory = await store.openMarket(market)
    for (let sequence = 1; sequence <= 20; sequence++)
      await store.append(market.slug, event(sequence))
    await store.finalize(market.slug, coverage)
    assert.equal(
      (await collect(readCapturedEvents(path.join(directory, 'events.parquet')))).length,
      20,
    )
  },
)

test('finalization interrupted before manifest publication rebuilds without losing the earlier file', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  await unlink(path.join(ready.directory, 'manifest.json'))
  const recovered = await new DurableMarketStore({ spoolDir }).recover(market.endMs + 1000)
  assert.equal(recovered.ready.length, 1)
  assert.equal(recovered.ready[0]!.manifest.coverage.complete, true)
  assert.deepEqual(
    await collect(readCapturedEvents(path.join(ready.directory, 'events.parquet'))),
    ready.rows,
  )
  assert.ok((await readdir(ready.directory)).some((name) => name.startsWith('unpublished-')))
  assert.deepEqual(
    (await new ArchiveService({ spoolDir, blobStore: new MemoryStore() }).runOnce()).failures,
    [],
  )
  assert.equal(
    (await readdir(ready.directory)).some((name) => name.endsWith('.parquet')),
    false,
  )
})

test('journal checksum rejects a complete corrupted row and preserves its source', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  await unlink(path.join(ready.directory, 'manifest.json'))
  const wal = path.join(ready.directory, 'wal-000000.jsonl')
  const original = await readFile(wal, 'utf8')
  await writeFile(wal, original.replace('12345.12345678901234567890', '12346.12345678901234567890'))
  await assert.rejects(new DurableMarketStore({ spoolDir }).recover(), /checksum mismatch/)
  assert.equal(await exists(wal), true)
})

test('metadata cleanup requires durable resolution upload and the caller completing resolution tracking', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  const cloud = new MemoryStore()
  const archive = new ArchiveService({ spoolDir, blobStore: cloud })
  await archive.runOnce()
  assert.equal(await archive.cleanupCompleted(ready.directory), false)
  await archive.queueResolution(ready.directory, {
    schemaVersion: 3,
    slug: market.slug,
    conditionId: market.conditionId,
    observedAtMs: market.endMs + 1000,
    status: 'resolved',
    winningOutcome: 'Down',
    winningTokenId: 'down',
    payouts: { up: '0', down: '1' },
    priceToBeat: null,
    finalPrice: null,
    source: 'gamma',
    rawJson: '{}',
  })
  await archive.runOnce()
  assert.equal(await archive.cleanupCompleted(ready.directory), false)
  await unlink(path.join(ready.directory, 'resolution.pending.json'))
  assert.equal(await archive.cleanupCompleted(ready.directory), false)
  const history = JSON.parse(
    await readFile(path.join(ready.directory, 'resolutions.json'), 'utf8'),
  ) as ResolutionObservation[]
  const last = history.at(-1)!
  await writeFile(
    path.join(ready.directory, 'resolution.complete.json'),
    JSON.stringify({
      observedAtMs: last.observedAtMs + RESOLUTION_CONFIRMATION_MS,
      fingerprint: resolutionFingerprint(last),
    }),
  )
  const outbox = path.join(ready.directory, 'resolution-outbox')
  const temporaryName = `${last.observedAtMs}-${'a'.repeat(64)}.json.12345678-1234-4123-8123-123456789abc.tmp`
  await writeFile(path.join(outbox, temporaryName), 'interrupted uncommitted replacement')
  const unknown = path.join(outbox, 'unknown.tmp')
  await writeFile(unknown, 'preserve unknown files')
  assert.equal(await archive.cleanupCompleted(ready.directory), false)
  assert.equal(await exists(path.join(outbox, temporaryName)), true)
  await unlink(unknown)
  const committed = path.join(outbox, `${last.observedAtMs}-${'b'.repeat(64)}.json`)
  await writeFile(committed, 'preserve every committed sidecar')
  assert.equal(await archive.cleanupCompleted(ready.directory), false)
  await unlink(committed)
  assert.equal(await archive.cleanupCompleted(ready.directory), true)
  assert.equal(await exists(ready.directory), false)
})

test('corrupted archive download cannot replace a valid local file or leave growing temporary files', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  const cloud = new MemoryStore()
  const result = await new ArchiveService({ spoolDir, blobStore: cloud }).runOnce()
  cloud.objects.set(ready.manifest.events.key, Buffer.alloc(ready.manifest.events.bytes + 1))
  const cache = path.join(spoolDir, 'cache')
  await assert.rejects(
    downloadMarket(cloud, result.uploaded[0]!.manifestKey, cache),
    /exceeds manifest size/,
  )
  const files = await readdir(path.join(cache, market.slug, ready.manifest.recordingId))
  assert.equal(
    files.some((name) => name.endsWith('.tmp')),
    false,
  )
  assert.equal(files.includes('events.parquet'), false)
})

test('failed resolution refresh cannot publish a fresh cache or alter a previously verified cache', async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  const cloud = new MemoryStore()
  const result = await new ArchiveService({ spoolDir, blobStore: cloud }).runOnce()
  const manifestKey = result.uploaded[0]!.manifestKey
  const cacheDir = path.join(spoolDir, 'cache')
  const cached = await downloadMarket(cloud, manifestKey, cacheDir)
  const oldManifest = await readFile(cached.manifestPath)
  const oldEvents = await readFile(cached.parquetPath)
  const resolutionsFile = path.join(path.dirname(cached.manifestPath), 'resolutions.json')
  const oldResolutions = await readFile(resolutionsFile)
  const conflictingManifest = Buffer.from(
    JSON.stringify({ ...ready.manifest, finalizedAtMs: ready.manifest.finalizedAtMs + 1 }),
  )
  const conflictingKey = `${path.posix.dirname(manifestKey)}/manifest-${createHash('sha256').update(conflictingManifest).digest('hex')}.json`
  cloud.objects.set(conflictingKey, conflictingManifest)
  await assert.rejects(
    downloadMarket(cloud, conflictingKey, cacheDir),
    /different immutable manifest/,
  )
  assert.deepEqual(await readFile(cached.manifestPath), oldManifest)
  assert.deepEqual(await readFile(cached.parquetPath), oldEvents)
  assert.deepEqual(await readFile(resolutionsFile), oldResolutions)
  const corruptKey = `${path.posix.dirname(ready.manifest.events.key)}/resolutions/${market.endMs + 1_000}-${'a'.repeat(64)}.json`
  cloud.objects.set(corruptKey, Buffer.from('{}'))
  await assert.rejects(downloadMarket(cloud, manifestKey, cacheDir), /Resolution integrity/)
  assert.deepEqual(await readFile(cached.manifestPath), oldManifest)
  assert.deepEqual(await readFile(cached.parquetPath), oldEvents)
  assert.deepEqual(await readFile(resolutionsFile), oldResolutions)
  const fresh = path.join(spoolDir, 'fresh')
  await assert.rejects(downloadMarket(cloud, manifestKey, fresh), /Resolution integrity/)
  assert.equal(
    await exists(path.join(fresh, market.slug, ready.manifest.recordingId, 'manifest.json')),
    false,
  )
})

test('pre-opened future market survives a clean stop without a false recovery gap', async (t) => {
  const spoolDir = await temporary(t)
  const first = new DurableMarketStore({ spoolDir })
  const directory = await first.openMarket(market)
  await first.append(market.slug, {
    ...event(1, 'market_metadata'),
    receivedAtMs: market.startMs - 10_000,
  })
  await first.close()
  const resumed = new DurableMarketStore({ spoolDir })
  assert.deepEqual((await resumed.recover(market.startMs - 1000)).active, [market])
  await resumed.append(market.slug, event(2))
  const ready = await resumed.finalize(market.slug, coverage)
  assert.equal(ready.directory, directory)
  assert.equal(ready.manifest.coverage.complete, true)
  assert.deepEqual(ready.manifest.coverage.gaps, [])
})

test('concurrent tracker and archive history appends cannot lose or duplicate observations', async (t) => {
  const directory = await temporary(t)
  const observations = Array.from(
    { length: 10 },
    (_, index): ResolutionObservation => ({
      schemaVersion: 3,
      slug: market.slug,
      conditionId: market.conditionId,
      observedAtMs: market.endMs + index,
      status: 'pending',
      winningOutcome: null,
      winningTokenId: null,
      payouts: null,
      priceToBeat: null,
      finalPrice: null,
      source: 'gamma',
      rawJson: JSON.stringify({ index }),
    }),
  )
  await Promise.all(
    [...observations]
      .reverse()
      .flatMap((observation) => [
        appendResolutionHistory(directory, observation),
        appendResolutionHistory(directory, observation),
      ]),
  )
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, 'resolutions.json'), 'utf8')),
    observations,
  )
})

test('low-disk seal defers compression while preserving complete recovery metadata', async (t) => {
  const spoolDir = await temporary(t)
  const store = new DurableMarketStore({ spoolDir })
  const directory = await store.openMarket(market)
  const currentMetadata = {
    ...market,
    rawJson: '{"feeSchedule":{"rate":0.07},"orderPriceMinTickSize":0.001}',
  }
  await store.freezeInitialMarket(currentMetadata)
  await store.append(market.slug, event(1))
  await store.seal(market.slug, coverage)
  assert.equal(await exists(path.join(directory, 'events.parquet')), false)
  assert.equal(await exists(path.join(directory, 'closing.json')), true)
  const recovered = await new DurableMarketStore({ spoolDir }).recover(market.endMs + 1000)
  assert.equal(recovered.ready[0]!.manifest.market.rawJson, currentMetadata.rawJson)
  assert.equal(recovered.ready[0]!.manifest.coverage.complete, true)
})

test('archive cancellation retains a stalled upload for retry', { timeout: 5000 }, async (t) => {
  const spoolDir = await temporary(t)
  const ready = await finalized(spoolDir)
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const controller = new AbortController()
  const stalled: BlobStore = {
    async get(_key, signal) {
      entered()
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('Canceled stalled GET')), {
          once: true,
        })
      })
    },
    async putFile() {
      throw new Error('Unreachable')
    },
    async *list() {
      /* no objects */
    },
  }
  const pending = new ArchiveService({ spoolDir, blobStore: stalled }).runOnce({
    signal: controller.signal,
  })
  await started
  controller.abort()
  const stopped = await pending
  assert.equal(stopped.failures.length, 1)
  assert.equal(await exists(path.join(ready.directory, 'events.parquet')), true)
  assert.equal(await exists(path.join(ready.directory, 'wal-000000.jsonl')), true)
  assert.equal(
    (await new ArchiveService({ spoolDir, blobStore: new MemoryStore() }).runOnce()).uploaded
      .length,
    1,
  )
})

test('bounded archive passes advance past a failing package without starving later packages', async (t) => {
  const spoolDir = await temporary(t)
  const first = await finalized(spoolDir)
  const second = await finalized(spoolDir)
  const third = await finalized(spoolDir)
  const packages = [first, second, third].sort((a, b) => a.directory.localeCompare(b.directory))
  class OneBadStore extends MemoryStore {
    override async get(key: string) {
      if (key.includes(packages[0]!.manifest.recordingId))
        throw new Error('First package temporarily inaccessible')
      return super.get(key)
    }
  }
  const archive = new ArchiveService({ spoolDir, blobStore: new OneBadStore() })
  assert.equal((await archive.runOnce({ maxMarkets: 1 })).failures.length, 1)
  assert.equal((await archive.runOnce({ maxMarkets: 1 })).uploaded.length, 1)
  assert.equal((await archive.runOnce({ maxMarkets: 1 })).uploaded.length, 1)
})

test(
  'conversion child stops on parent disconnect and the durable closing marker permits retry',
  { timeout: 10_000 },
  async (t) => {
    const spoolDir = await temporary(t)
    const ready = await finalized(spoolDir)
    await unlink(path.join(ready.directory, 'manifest.json'))
    await unlink(path.join(ready.directory, 'events.parquet'))
    const state = JSON.parse(await readFile(path.join(ready.directory, 'state.json'), 'utf8'))
    const worker = fork(new URL('./parquetWorker.ts', import.meta.url), [], {
      execArgv: ['--import', import.meta.resolve('tsx')],
      env: { NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    t.after(async () => {
      if (worker.exitCode === null) worker.kill('SIGKILL')
    })
    const exited = once(worker, 'exit')
    await new Promise<void>((resolve, reject) =>
      worker.send(
        {
          directory: ready.directory,
          state,
          coverage,
          prefix: 'recorder-v3',
          rowGroupSize: 512,
          rowGroupBytes: 4 * 1024 * 1024,
        },
        (error) => (error ? reject(error) : resolve()),
      ),
    )
    worker.disconnect()
    const [code] = await exited
    assert.equal(code, 1)
    assert.equal(await exists(path.join(ready.directory, 'wal-000000.jsonl')), true)
    const recovery = await new DurableMarketStore({ spoolDir }).recover(market.endMs + 1000)
    assert.equal(recovery.ready.length, 1)
    assert.deepEqual(
      await collect(readCapturedEvents(path.join(ready.directory, 'events.parquet'))),
      ready.rows,
    )
  },
)
