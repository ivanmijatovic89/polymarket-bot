import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseRecorderMarket } from './markets.js'
import { ResolutionTracker } from './resolution.js'
import { ArchiveService } from './storage/archive.js'
import type { BlobStore } from './storage/blobStore.js'
import { exists } from './storage/files.js'
import type { MarketManifest } from './storage/manifest.js'
import type { RecordedMarket, ResolutionObservation } from './types.js'

const DAY = 86_400_000

async function temporary(t: { after(callback: () => Promise<void>): void }) {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'recorder-resolution-'))
  t.after(() => rm(spoolDir, { recursive: true, force: true }))
  return spoolDir
}

async function packageFixture(spoolDir: string, index = 0) {
  const startMs = 1_800_000 + index * 300_000
  const market = parseRecorderMarket({
    slug: `btc-updown-5m-${startMs / 1_000}`,
    conditionId: `condition-${index}`,
    clobTokenIds: '["up-token","down-token"]',
    outcomes: '["Up","Down"]',
    endDate: new Date(startMs + 300_000).toISOString(),
    cryptoMarketConfig: { twapEnabled: true, twapLookbackSeconds: 60 },
  })
  const directory = path.join(spoolDir, `recording-${String(index).padStart(2, '0')}`)
  await mkdir(directory)
  // Archive verification is format-independent; scheduler tests need only stable artifact bytes.
  const bytes = Buffer.from('resolution test recording artifact')
  await writeFile(path.join(directory, 'events.parquet'), bytes)
  const manifest: MarketManifest = {
    schemaVersion: 4,
    archiveLayout: 'symbol-timeframe',
    recordingId: `recording-${index}`,
    market,
    createdAtMs: startMs,
    finalizedAtMs: market.endMs,
    coverage: {
      complete: true,
      startedAtMs: startMs,
      endedAtMs: market.endMs,
      missingInitialBook: false,
      gaps: [],
      warnings: [],
    },
    events: {
      key: `recorder-v4/btc/${market.timeframe}/${market.slug}/recording-${index}/events-${createHash('sha256').update(bytes).digest('hex')}.parquet`,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rows: 0,
      firstSequence: null,
      lastSequence: null,
    },
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
  return { directory, market }
}

function gamma(market: RecordedMarket, lifecycle = '', winner = 'Up') {
  return {
    ...(JSON.parse(market.rawJson) as Record<string, unknown>),
    active: true,
    closed: lifecycle === 'resolved',
    umaResolutionStatus: lifecycle,
    outcomePrices: winner === 'Up' ? '["1","0"]' : '["0","1"]',
    events: [
      {
        eventMetadata: {
          priceToBeat: '85000.1234567890123456789',
          finalPrice: winner === 'Up' ? '85001.12' : '84999.12',
        },
      },
    ],
  }
}

async function history(directory: string): Promise<ResolutionObservation[]> {
  return JSON.parse(
    await readFile(path.join(directory, 'resolutions.json'), 'utf8'),
  ) as ResolutionObservation[]
}

async function task(directory: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(directory, 'resolution.pending.json'), 'utf8'),
  ) as Record<string, unknown>
}

test('scheduler preserves exact Gamma response bytes and body receipt time, including local-only history', async (t) => {
  const spoolDir = await temporary(t)
  const { directory, market } = await packageFixture(spoolDir)
  let now = market.endMs + 1_000
  const body = `${JSON.stringify(gamma(market), null, 2)}\n`
  const receipt = now + 7
  const tracker = new ResolutionTracker({
    spoolDir,
    now: () => now,
    fetchRaw: async (slug, options) => {
      now = receipt
      options?.onResponse?.({
        slug,
        rawJson: body,
        status: 200,
        url: `https://gamma-api.polymarket.com/markets/slug/${slug}`,
      })
      now += 50 // Parsing/dispatch after receipt must not shift availability.
      return JSON.parse(body) as Record<string, unknown>
    },
  })
  await tracker.runOnce()
  const observations = await history(directory)
  assert.equal(observations.length, 1)
  assert.equal(observations[0]?.rawJson, body)
  assert.equal(observations[0]?.observedAtMs, receipt)
  assert.equal(observations[0]?.priceToBeat, '85000.1234567890123456789')
  assert.equal((await readdir(path.join(directory, 'resolution-outbox'))).length, 1)
  assert.equal(await exists(path.join(directory, 'events.parquet')), true)
  assert.equal(tracker.pending, 1)
})

test('retries survive restart and history/outbox recovery does not duplicate unchanged observations', async (t) => {
  const spoolDir = await temporary(t)
  const { directory, market } = await packageFixture(spoolDir)
  let now = market.endMs + 1_000
  let calls = 0
  let offline = true
  const options = {
    spoolDir,
    now: () => now,
    fetchRaw: async () => {
      calls++
      if (offline) throw new Error('Gamma unavailable')
      return gamma(market)
    },
  }
  const first = new ResolutionTracker(options)
  await first.runOnce()
  const retry = await task(directory)
  assert.equal(retry.attempts, 1)
  assert.equal(retry.lastError, 'Gamma unavailable')
  const restarted = new ResolutionTracker(options)
  await restarted.runOnce()
  assert.equal(calls, 1)
  assert.equal(restarted.lastError, 'Gamma unavailable')
  offline = false
  now = Number(retry.nextAttemptAtMs)
  await restarted.runOnce()
  const firstObservation = (await history(directory))[0]!
  assert.equal(restarted.lastError, null)
  now += 15_000
  await restarted.runOnce()
  assert.equal((await history(directory)).length, 1)
  assert.equal((await readdir(path.join(directory, 'resolution-outbox'))).length, 1)

  // Simulate a crash between history and task progress persistence.
  const lostProgress = await task(directory)
  delete lostProgress.fingerprint
  lostProgress.nextAttemptAtMs = now
  await writeFile(path.join(directory, 'resolution.pending.json'), JSON.stringify(lostProgress))
  await new ResolutionTracker(options).runOnce()
  assert.equal((await history(directory)).length, 1)

  // Simulate a crash between the outbox write and local history persistence.
  await rm(path.join(directory, 'resolutions.json'))
  now += 15_000
  await new ResolutionTracker(options).runOnce()
  assert.deepEqual(await history(directory), [firstObservation])
})

test('proposed/disputed/terminal revisions survive and a changed terminal result restarts its 24h confirmation', async (t) => {
  const spoolDir = await temporary(t)
  const { directory, market } = await packageFixture(spoolDir)
  let now = market.endMs + 1_000
  let lifecycle = 'proposed'
  let winner = 'Up'
  const tracker = new ResolutionTracker({
    spoolDir,
    now: () => now,
    fetchRaw: async () => gamma(market, lifecycle, winner),
  })
  await tracker.runOnce()
  lifecycle = 'disputed'
  now += 15_000
  await tracker.runOnce()
  lifecycle = 'resolved'
  now += 15_000
  await tracker.runOnce()
  const firstResolved = now
  assert.equal((await task(directory)).nextAttemptAtMs, firstResolved + DAY)
  now += DAY
  winner = 'Down'
  await tracker.runOnce()
  assert.equal(await exists(path.join(directory, 'resolution.complete.json')), false)
  assert.equal((await task(directory)).firstResolvedAtMs, now)
  assert.equal((await task(directory)).nextAttemptAtMs, now + DAY)
  now += DAY
  await tracker.runOnce()
  assert.equal(await exists(path.join(directory, 'resolution.complete.json')), true)
  assert.equal(await exists(path.join(directory, 'resolution.pending.json')), false)
  const observations = await history(directory)
  assert.deepEqual(
    observations.map((value) => value.status),
    ['proposed', 'disputed', 'resolved', 'resolved'],
  )
  assert.deepEqual(
    observations.slice(2).map((value) => value.winningOutcome),
    ['Up', 'Down'],
  )
  assert.equal(tracker.pending, 0)
  assert.equal(
    await exists(path.join(directory, 'events.parquet')),
    true,
    'local-only recordings are never deleted',
  )
})

test('a confirmed marker plus a stale pending task is recoverable after a crash', async (t) => {
  const spoolDir = await temporary(t)
  const { directory, market } = await packageFixture(spoolDir)
  let now = market.endMs + 1_000
  const options = { spoolDir, now: () => now, fetchRaw: async () => gamma(market, 'resolved') }
  const tracker = new ResolutionTracker(options)
  await tracker.runOnce()
  const beforeConfirmation = await readFile(path.join(directory, 'resolution.pending.json'))
  now += DAY
  await tracker.runOnce()
  await writeFile(path.join(directory, 'resolution.pending.json'), beforeConfirmation)
  await new ResolutionTracker(options).runOnce()
  assert.equal(await exists(path.join(directory, 'resolution.pending.json')), false)
  assert.equal(await exists(path.join(directory, 'resolution.complete.json')), true)
  assert.equal(await exists(path.join(directory, 'events.parquet')), true)
})

test('a crash after recording a terminal revision cannot reuse the prior result confirmation time', async (t) => {
  const spoolDir = await temporary(t)
  const { directory, market } = await packageFixture(spoolDir)
  let now = market.endMs + 1_000
  let winner = 'Up'
  const options = {
    spoolDir,
    now: () => now,
    fetchRaw: async () => gamma(market, 'resolved', winner),
  }
  const tracker = new ResolutionTracker(options)
  await tracker.runOnce()
  const priorTask = await readFile(path.join(directory, 'resolution.pending.json'))
  now += DAY
  winner = 'Down'
  await tracker.runOnce()
  const revisedAtMs = now
  // The revised outbox/history committed, but SIGKILL interrupted task replacement.
  await writeFile(path.join(directory, 'resolution.pending.json'), priorTask)
  now += 1_000
  const restarted = new ResolutionTracker(options)
  await restarted.runOnce()
  assert.equal(await exists(path.join(directory, 'resolution.complete.json')), false)
  assert.equal((await task(directory)).firstResolvedAtMs, revisedAtMs)
  assert.equal((await task(directory)).nextAttemptAtMs, revisedAtMs + DAY)
  now = revisedAtMs + DAY
  await restarted.runOnce()
  assert.equal(await exists(path.join(directory, 'resolution.complete.json')), true)
})

test('a corrupt completion marker cannot delete a pending resolution task', async (t) => {
  const spoolDir = await temporary(t)
  const { directory, market } = await packageFixture(spoolDir)
  const tracker = new ResolutionTracker({
    spoolDir,
    now: () => market.endMs + 1_000,
    fetchRaw: async () => gamma(market, 'resolved'),
  })
  await tracker.runOnce()
  const retryTask = await readFile(path.join(directory, 'resolution.pending.json'))
  for (const marker of ['{broken', JSON.stringify({ observedAtMs: 0, fingerprint: 'wrong' })]) {
    await writeFile(path.join(directory, 'resolution.complete.json'), marker)
    await tracker.runOnce()
    assert.ok(tracker.lastError)
    assert.deepEqual(await readFile(path.join(directory, 'resolution.pending.json')), retryTask)
  }
})

test('bounded resolution passes rotate overdue markets even when every prior task is due again', async (t) => {
  const spoolDir = await temporary(t)
  const fixtures = await Promise.all(
    Array.from({ length: 9 }, (_, index) => packageFixture(spoolDir, index)),
  )
  let now = fixtures.at(-1)!.market.endMs + 3_600_001
  const visited: string[] = []
  const tracker = new ResolutionTracker({
    spoolDir,
    now: () => now,
    fetchRaw: async (slug) => {
      visited.push(slug)
      return gamma(fixtures.find(({ market }) => market.slug === slug)!.market)
    },
  })
  await tracker.runOnce()
  assert.equal(visited.length, 8)
  now += 300_000 // Slow archival between maintenance passes makes all earlier tasks due again.
  await tracker.runOnce()
  assert.equal(visited.length, 16)
  assert.equal(new Set(visited).size, 9)
})

class MemoryStore implements BlobStore {
  readonly objects = new Map<string, Buffer>()
  offline = true
  async putFile(key: string, file: string) {
    if (this.offline) throw new Error('R2 unavailable')
    this.objects.set(key, await readFile(file))
  }
  async get(key: string) {
    const body = this.objects.get(key)
    return body
      ? (async function* () {
          yield body
        })()
      : null
  }
  async *list(prefix: string) {
    for (const key of this.objects.keys()) if (key.startsWith(prefix)) yield key
  }
}

test('completed resolution never deletes a package until its recording and outbox uploads are verified', async (t) => {
  const spoolDir = await temporary(t)
  const { directory, market } = await packageFixture(spoolDir)
  const blobStore = new MemoryStore()
  const archive = new ArchiveService({ spoolDir, blobStore })
  let now = market.endMs + 1_000
  const tracker = new ResolutionTracker({
    spoolDir,
    archive,
    now: () => now,
    fetchRaw: async () => gamma(market, 'resolved'),
  })
  await tracker.runOnce()
  now += DAY
  await tracker.runOnce()
  await tracker.runOnce() // cleanup attempt without an archive receipt
  assert.equal(await exists(path.join(directory, 'events.parquet')), true)
  assert.equal((await archive.runOnce()).failures.length, 1)
  await tracker.runOnce()
  assert.equal(await exists(directory), true)
  blobStore.offline = false
  const uploaded = await archive.runOnce()
  assert.equal(uploaded.uploaded.length, 1)
  assert.equal(uploaded.failures.length, 0)
  assert.ok([...blobStore.objects.keys()].some((key) => key.includes('/resolutions/')))
  assert.equal((await readdir(path.join(directory, 'resolution-outbox'))).length, 0)
  await tracker.runOnce()
  assert.equal(await exists(directory), false)
})

test('one corrupt retry task does not prevent another market from getting its resolution', async (t) => {
  const spoolDir = await temporary(t)
  const bad = await packageFixture(spoolDir, 0)
  const good = await packageFixture(spoolDir, 1)
  await writeFile(path.join(bad.directory, 'resolution.pending.json'), '{incomplete')
  const tracker = new ResolutionTracker({
    spoolDir,
    now: () => good.market.endMs + 1_000,
    fetchRaw: async () => gamma(good.market),
  })
  await tracker.runOnce()
  assert.ok(tracker.lastError)
  assert.equal((await history(good.directory)).length, 1)
  assert.equal(
    await readFile(path.join(bad.directory, 'resolution.pending.json'), 'utf8'),
    '{incomplete',
  )
})

test('shutdown aborts a resolution request and preserves its retry task without a fabricated provider error', async (t) => {
  const spoolDir = await temporary(t)
  const { directory, market } = await packageFixture(spoolDir)
  const controller = new AbortController()
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const tracker = new ResolutionTracker({
    spoolDir,
    now: () => market.endMs + 1_000,
    fetchRaw: async (_slug, options) => {
      entered()
      return await new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        })
      })
    },
  })
  const running = tracker.runOnce({ signal: controller.signal })
  await started
  controller.abort()
  await running
  assert.equal(tracker.lastError, null)
  assert.equal((await task(directory)).attempts, undefined)
  assert.equal(await exists(path.join(directory, 'resolutions.json')), false)
  await new ResolutionTracker({
    spoolDir,
    now: () => market.endMs + 1_000,
    fetchRaw: async () => gamma(market),
  }).runOnce()
  assert.equal((await history(directory)).length, 1)
})
