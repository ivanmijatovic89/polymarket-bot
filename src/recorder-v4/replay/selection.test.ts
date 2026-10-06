import assert from 'node:assert/strict'
import test from 'node:test'
import { eligibleManifest } from './selectionFixtures.js'
import { captureMarketMetadata, type ResolvedCapturePackage } from './package.js'
import {
  selectEligibleCapturePackages,
  requireCaptureSelectionSize,
  matchesCaptureFilters,
} from './selection.js'

function capture(startMs: number, recordingId = 'capture'): ResolvedCapturePackage {
  const manifest = eligibleManifest(startMs, recordingId)
  return {
    manifest,
    filePath: `/unused/${startMs}/${recordingId}/events.parquet`,
    marketMeta: captureMarketMetadata(manifest),
    marketResolution: { tokenMap: { UP: 'up', DOWN: 'down' }, outcome: 'UP' },
  }
}

test('required-feed filtering precedes latest and limit; no historical 10-second tolerance is used', async () => {
  const oldest = capture(1_000)
  const middle = capture(301_000)
  const latest = capture(601_000)
  latest.manifest.coverage.complete = false
  latest.manifest.coverage.gaps = [
    {
      feed: 'chainlink_spot',
      startMs: 602_000,
      endMs: 602_001,
      reason: 'disconnected',
      certainty: 'confirmed',
    },
  ]
  const selected = await selectEligibleCapturePackages({
    packages: [oldest, latest, middle],
    requiredFeeds: { rtdsCryptoPrices: { chainlinkSymbols: ['btc/usd'] } },
    latest: true,
    limit: 2,
  })
  assert.deepEqual(
    selected.packages.map((pkg) => pkg.manifest.market.startMs),
    [301_000, 1_000],
  )
  assert.deepEqual(selected.summary, {
    candidates: 3,
    eligible: 2,
    selected: 2,
    excluded: 1,
    exclusions: { chainlink_spot: 1 },
  })
  assert.doesNotThrow(() => requireCaptureSelectionSize(2, selected.summary.eligible))
  assert.throws(
    () => requireCaptureSelectionSize(3, selected.summary.eligible),
    /requested 3 eligible markets, found 2/,
  )
})

test('duplicate recordings are excluded before limits and never silently replaced or combined', async () => {
  const selected = await selectEligibleCapturePackages({
    packages: [capture(301_000, 'one'), capture(1_000), capture(301_000, 'two')],
    requiredFeeds: {},
    latest: true,
    limit: 1,
  })
  assert.equal(selected.packages[0]!.manifest.market.startMs, 1_000)
  assert.equal(selected.summary.exclusions.ambiguous_recording, 2)
  const exact = await selectEligibleCapturePackages({
    packages: [capture(301_000, 'two')],
    requiredFeeds: {},
  })
  assert.equal(exact.packages[0]!.manifest.recordingId, 'two')
})

test('unresolved markets never enter ordinary or outage selections', async () => {
  const unresolved = capture(1_000)
  unresolved.marketResolution.outcome = null
  for (const allowGaps of [false, true]) {
    const selection = await selectEligibleCapturePackages({
      packages: [unresolved],
      requiredFeeds: {},
      allowGaps,
    })
    assert.equal(selection.summary.eligible, 0)
    assert.equal(selection.summary.exclusions.unresolved_outcome, 1)
  }
})

test('date bounds, slug filters and covered exclusions define the universe before inspection and random sampling', async () => {
  const captures = [capture(1_000), capture(301_000), capture(601_000), capture(901_000)]
  const inspected: number[] = []
  const selected = await selectEligibleCapturePackages({
    packages: captures,
    requiredFeeds: {},
    fromMs: 301_000,
    toMs: 901_000,
    excludeSlugs: [captures[3]!.manifest.market.slug],
    random: true,
    limit: 1,
    randomValue: () => 0,
    inspect: async (pkg) => {
      inspected.push(pkg.manifest.market.startMs)
      return []
    },
  })
  assert.deepEqual(inspected, [301_000, 601_000])
  assert.equal(selected.packages[0]!.manifest.market.startMs, 601_000)
  assert.equal(
    matchesCaptureFilters(captures[0]!.manifest.market, {
      slugs: [captures[1]!.manifest.market.slug],
    }),
    false,
  )
})

test('a corrupt package is reported as an exclusion before dispatch', async () => {
  const selection = await selectEligibleCapturePackages({
    packages: [capture(1_000)],
    requiredFeeds: {},
    inspect: async () => {
      throw new Error('Checksum mismatch')
    },
  })
  assert.equal(selection.packages.length, 0)
  assert.deepEqual(selection.excluded[0]!.reasons, ['invalid_package: Checksum mismatch'])
})
