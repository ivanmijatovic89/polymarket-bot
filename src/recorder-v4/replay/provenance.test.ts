import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createCaptureReference,
  parseCaptureReference,
  resolveCaptureReference,
} from './provenance.js'
import type { MarketManifest } from '../storage/manifest.js'

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'v4-provenance-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bytes = Buffer.from('verified bytes of exactly one recording')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const manifest: MarketManifest = {
    schemaVersion: 4,
    archiveLayout: 'symbol-timeframe',
    recordingId: 'original',
    market: {
      slug: 'btc-updown-5m-1',
      symbol: 'btc',
      timeframe: '5m',
      conditionId: 'condition',
      tokenIds: ['up', 'down'],
      outcomes: ['Up', 'Down'],
      startMs: 1000,
      endMs: 301000,
      twapEnabled: true,
      twapLookbackSeconds: 60,
      resolutionSource: null,
      rawJson: '{}',
    },
    coverage: {
      complete: true,
      startedAtMs: 1000,
      endedAtMs: 301000,
      missingInitialBook: false,
      gaps: [],
      warnings: [],
    },
    createdAtMs: 1000,
    finalizedAtMs: 301000,
    events: {
      key: `recorder-v4/btc/5m/btc-updown-5m-1/original/events-${sha256}.parquet`,
      sha256,
      bytes: bytes.length,
      rows: 1,
      firstSequence: '1',
      lastSequence: '1',
    },
  }
  const input = path.join(dir, 'events.parquet')
  await writeFile(input, bytes)
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  const reference = createCaptureReference({
    manifest,
    input,
    marketResolution: { outcome: 'UP', tokenMap: { UP: 'up', DOWN: 'down' } },
    requiredFeeds: {},
  })
  return { dir, input, reference }
}

test('saved reference survives database JSON key reordering and freezes settlement', async (t) => {
  const { dir, reference } = await fixture(t)
  const reordered = JSON.parse(JSON.stringify(reference), (_key, value) => {
    return value && !Array.isArray(value) && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse())
      : value
  })
  assert.equal(parseCaptureReference(reordered).manifestSha256, reference.manifestSha256)
  await writeFile(
    path.join(dir, 'resolutions.json'),
    'not consulted: later corrections cannot rewrite saved results',
  )
  const resolved = await resolveCaptureReference(reordered)
  assert.equal(resolved.marketResolution.outcome, 'UP')
  assert.deepEqual(resolved.marketResolution.tokenMap, { UP: 'up', DOWN: 'down' })
})

test('modified metadata, different recording and corrupt event bytes are rejected', async (t) => {
  const { dir, input, reference } = await fixture(t)
  const changed = structuredClone(reference)
  changed.manifest.market.conditionId = 'other-condition'
  assert.throws(() => parseCaptureReference(changed), /checksum/)
  const changedResolution = structuredClone(reference)
  changedResolution.marketResolution.tokenMap.UP = 'foreign-token'
  assert.throws(() => parseCaptureReference(changedResolution), /token map/)
  await writeFile(input, 'corrupt bytes')
  await assert.rejects(resolveCaptureReference(reference), /integrity/)
  await writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ ...reference.manifest, finalizedAtMs: 301001 }),
  )
  await assert.rejects(resolveCaptureReference(reference), /differs/)
})
