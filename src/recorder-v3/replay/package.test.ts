import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveCapturePackage } from './package.js'
import { queueResolution } from '../storage/archive.js'
import { parseResolutionObservation } from '../resolutionParser.js'
import type { MarketManifest } from '../storage/manifest.js'
import type { RecordedMarket } from '../types.js'

const market: RecordedMarket = {
  slug: 'btc-updown-5m-1',
  symbol: 'btc',
  timeframe: '5m',
  conditionId: 'condition',
  tokenIds: ['up', 'down'],
  outcomes: ['Up', 'Down'],
  startMs: 1_000,
  endMs: 301_000,
  twapEnabled: true,
  twapLookbackSeconds: 60,
  resolutionSource: null,
  rawJson: '{}',
}
const observed = parseResolutionObservation(
  market,
  JSON.stringify({
    slug: market.slug,
    conditionId: market.conditionId,
    closed: true,
    umaResolutionStatus: 'resolved',
    clobTokenIds: market.tokenIds,
    outcomes: market.outcomes,
    outcomePrices: ['1', '0'],
  }),
  400_000,
)

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-package-resolution-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const manifest: MarketManifest = {
    schemaVersion: 3,
    recordingId: 'fixture',
    market,
    coverage: {
      complete: true,
      startedAtMs: market.startMs,
      endedAtMs: market.endMs,
      missingInitialBook: false,
      gaps: [],
      warnings: [],
    },
    createdAtMs: market.startMs,
    finalizedAtMs: market.endMs,
    events: {
      key: 'fixture/events.parquet',
      sha256: 'a'.repeat(64),
      bytes: 0,
      rows: 0,
      firstSequence: null,
      lastSequence: null,
    },
  }
  const manifestPath = path.join(directory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  return { directory, manifestPath }
}

test('local replay rejects a modified resolution outbox before accepting its changed winner', async (t) => {
  const { directory, manifestPath } = await fixture(t)
  await queueResolution(directory, observed)
  assert.equal((await resolveCapturePackage(manifestPath)).marketResolution.outcome, 'UP')
  const outbox = path.join(directory, 'resolution-outbox')
  const file = path.join(outbox, (await readdir(outbox))[0]!)
  const original = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(
    file,
    JSON.stringify({
      ...original,
      winningOutcome: 'Down',
      winningTokenId: 'down',
      payouts: { up: '0', down: '1' },
    }),
  )
  await assert.rejects(resolveCapturePackage(manifestPath), /Resolution integrity check failed/)
})

test('local resolution history validates market identity, lifecycle and payout mapping', async (t) => {
  const { directory, manifestPath } = await fixture(t)
  const file = path.join(directory, 'resolutions.json')
  for (const invalid of [
    {},
    [null],
    [{ ...observed, schemaVersion: 2 }],
    [{ ...observed, status: 'final' }],
    [{ ...observed, slug: 'another-market' }],
    [{ ...observed, observedAtMs: -1 }],
    [{ ...observed, winningOutcome: 'Down', winningTokenId: 'down' }],
    [{ ...observed, winningOutcome: 1 }],
    [{ ...observed, payouts: null }],
    [{ ...observed, payouts: { up: '1', down: '1' } }],
    [{ ...observed, payouts: { up: '0.5', down: '0.5' } }],
    [{ ...observed, status: 'disputed' }],
  ]) {
    await writeFile(file, JSON.stringify(invalid))
    await assert.rejects(resolveCapturePackage(manifestPath))
  }
  await writeFile(file, JSON.stringify([observed]))
  assert.equal((await resolveCapturePackage(manifestPath)).marketResolution.outcome, 'UP')
  await writeFile(
    file,
    JSON.stringify([
      {
        ...observed,
        winningOutcome: null,
        winningTokenId: null,
        payouts: { up: '0.5', down: '0.5' },
      },
    ]),
  )
  assert.equal((await resolveCapturePackage(manifestPath)).marketResolution.outcome, null)
  await writeFile(
    file,
    JSON.stringify([
      {
        ...observed,
        status: 'disputed',
        winningOutcome: null,
        winningTokenId: null,
        payouts: null,
      },
    ]),
  )
  assert.equal((await resolveCapturePackage(manifestPath)).marketResolution.outcome, null)
})
