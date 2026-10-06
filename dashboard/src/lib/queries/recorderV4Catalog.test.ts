import { inspectRecorderV4Metadata } from '../../../../src/recorder-v4/replay/catalogMetadata.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { recorderV4DatasetRange } from './recorderV4Catalog.js'
import type { ResolvedCapturePackage } from '../../../../src/recorder-v4/replay/package.js'

function pkg(id: string): ResolvedCapturePackage {
  return {
    filePath: '/intentionally-missing/events.parquet',
    marketResolution: { tokenMap: { UP: 'up', DOWN: 'down' }, outcome: 'UP' },
    marketMeta: {} as ResolvedCapturePackage['marketMeta'],
    manifest: {
      schemaVersion: 4,
      archiveLayout: 'symbol-timeframe',
      recordingId: id,
      market: {
        slug: 'btc-updown-5m-1000',
        symbol: 'btc',
        timeframe: '5m',
        conditionId: 'm',
        tokenIds: ['up', 'down'],
        outcomes: ['Up', 'Down'],
        startMs: 1_000_000,
        endMs: 1_300_000,
        twapEnabled: true,
        twapLookbackSeconds: 60,
        resolutionSource: 'chainlink',
        rawJson: '{}',
      },
      createdAtMs: 1_000_000,
      finalizedAtMs: 1_300_000,
      coverage: {
        complete: true,
        startedAtMs: 1_000_000,
        endedAtMs: 1_300_000,
        missingInitialBook: false,
        gaps: [],
        warnings: [],
      },
      events: {
        key: 'unused',
        sha256: '0'.repeat(64),
        bytes: 1234,
        rows: 50,
        firstSequence: '1',
        lastSequence: '50',
      },
    },
  }
}

test('metadata overview neither reads Parquet nor claims unverified PTB is eligible', async () => {
  const package1 = pkg('first')
  const available = await inspectRecorderV4Metadata([package1], {})
  assert.equal(available.summary.eligible, 1)
  const ptb = await inspectRecorderV4Metadata([package1], {
    polymarketPriceToBeat: { enabled: true, source: 'chainlink-opening-twap' },
  })
  assert.equal(ptb.summary.eligible, 0)
  assert.equal(ptb.summary.exclusions.ptb_unverified, 1)
  const duplicate = await inspectRecorderV4Metadata([package1, pkg('second')], {})
  assert.equal(duplicate.summary.eligible, 0)
  assert.equal(duplicate.summary.exclusions.ambiguous_recording, 2)
  const unresolved = await inspectRecorderV4Metadata(
    [{ ...package1, marketResolution: { ...package1.marketResolution, outcome: null } }],
    {},
  )
  assert.equal(unresolved.summary.exclusions.unresolved_outcome, 1)
})

test('interactive ranges are UTC, bounded and stable within the cache interval', () => {
  const now = Date.parse('2026-10-06T14:02:00Z')
  assert.deepEqual(
    recorderV4DatasetRange(undefined, undefined, now),
    recorderV4DatasetRange(undefined, undefined, now + 1000),
  )
  const day = recorderV4DatasetRange('2026-10-06', '2026-10-06')
  assert.equal(day.fromMs, Date.parse('2026-10-06T00:00:00Z'))
  assert.equal(day.toMs, Date.parse('2026-10-06T23:59:59.999Z'))
  for (const range of [
    ['2026-02-30', '2026-03-01'],
    ['invalid', '2026-10-01'],
    ['2026-01-01', '2026-10-01'],
    ['2026-10-02', '2026-10-01'],
  ])
    assert.throws(() => recorderV4DatasetRange(range[0], range[1]))
})
