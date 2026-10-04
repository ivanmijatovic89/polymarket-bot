import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRecorderStatus, readRecorderReports, recorderIsOnline } from './recorders.js'
import type { RecorderStatus } from '../../../../src/recorder-v3/statusTypes.js'

const status: RecorderStatus = {
  schemaVersion: 3,
  recorderId: 'worker-2',
  captureId: 'capture',
  sessionId: 'session',
  host: 'worker-2',
  pid: 123,
  startedAtMs: 1_000,
  updatedAtMs: 10_000,
  state: 'recording',
  reason: null,
  feeds: [
    {
      feed: 'polymarket',
      state: 'connected',
      lastReceivedAtMs: 9_000,
      messages: 100,
      reconnects: 0,
    },
  ],
  markets: [],
  spool: {
    bytes: 1_000,
    maxBytes: 20_000,
    freeBytes: 100_000,
    minFreeBytes: 20_000,
    pendingWrites: 0,
  },
  archive: {
    enabled: true,
    pendingMarkets: 0,
    uploadedMarkets: 1,
    lastSuccessAtMs: 9_000,
    lastError: null,
  },
  resolution: { pending: 1, lastError: null },
  metrics: { rssBytes: 100, eventLoopLagMs: 2, cpuPercent: 1 },
  recentMarkets: [],
}

test('a stale recorder stays listed and never looks online from its last recording state', async () => {
  const reader = { smembers: async () => ['worker-2'], mget: async () => [JSON.stringify(status)] }
  const report = await readRecorderReports(reader, 50_000)
  assert.equal(report.recorders.length, 1)
  assert.equal(report.recorders[0]?.online, false)
  assert.equal(report.recorders[0]?.status?.state, 'recording')
  assert.equal(report.error, null)
  assert.equal(recorderIsOnline(status, 40_000), true)
  assert.equal(recorderIsOnline({ ...status, state: 'stopped' }, 10_000), false)
  assert.equal(recorderIsOnline(status, 1_000), false)
})

test('missing, malformed, mismatched and wrong-version reports remain visible as invalid entries', () => {
  for (const raw of [
    null,
    '{',
    JSON.stringify({ schemaVersion: 2 }),
    JSON.stringify({ ...status, recorderId: 'wrong' }),
    JSON.stringify({ ...status, feeds: [null] }),
  ]) {
    const result = parseRecorderStatus('worker-2', raw, 10_000)
    assert.equal(result.recorderId, 'worker-2')
    assert.equal(result.online, false)
    assert.equal(result.status, null)
    assert.ok(result.error)
  }
  assert.equal(
    parseRecorderStatus(
      'worker-2',
      JSON.stringify({ ...status, credentials: 'not allowed' }),
      10_000,
    ).status &&
      'credentials' in
        parseRecorderStatus(
          'worker-2',
          JSON.stringify({ ...status, credentials: 'not allowed' }),
          10_000,
        ).status!,
    false,
  )
})

test('Redis failure and stalled queries return an unavailable report within a bounded deadline', async () => {
  const failed = await readRecorderReports({
    smembers: async () => {
      throw new Error('offline')
    },
    mget: async () => [],
  })
  assert.ok(failed.error)
  const start = Date.now()
  const stalled = await readRecorderReports(
    { smembers: () => new Promise(() => undefined), mget: async () => [] },
    10_000,
    10,
  )
  assert.ok(stalled.error)
  assert.ok(Date.now() - start < 1_000)
})

test('opening-reference status preserves provenance and strips unexpected fields', () => {
  const openingReference = {
    comparison: 'match',
    observation: {
      source: 'chainlink-opening-twap',
      symbol: 'BTC',
      sourceTimestampMs: 5_000,
      windowSeconds: 60,
      openPrice: 85_412.32,
      fullAccuracyValue: '85412320000000000000000',
      receivedAtMs: 6_000,
      eventId: 'twap-event',
      sessionId: 'session',
      connectionId: 'connection',
    },
    website: { openPrice: 85_412.32, receivedAtMs: 7_000, eventId: 'website-event' },
  }
  const market = {
    slug: 'btc-updown-5m-1791144900',
    timeframe: '5m',
    active: true,
    rows: 100,
    gaps: 0,
    booksReady: true,
  }
  const parseMarket = (reference: unknown) =>
    parseRecorderStatus(
      'worker-2',
      JSON.stringify({ ...status, markets: [{ ...market, openingReference: reference }] }),
      10_000,
    )
  const parsed = parseMarket({
    ...openingReference,
    raw: 'must be stripped',
    observation: { ...openingReference.observation, credentials: 'must be stripped' },
  })
  assert.equal(parsed.error, null)
  assert.deepEqual(parsed.status?.markets[0]?.openingReference, openingReference)

  const conflict = {
    ...openingReference,
    comparison: 'conflicting-twap',
    conflict: {
      fullAccuracyValue: '85413320000000000000000',
      receivedAtMs: 8_000,
      eventId: 'later-event',
    },
  }
  assert.deepEqual(parseMarket(conflict).status?.markets[0]?.openingReference, conflict)
  const recovered = { ...openingReference, conflictCount: 2 }
  assert.deepEqual(parseMarket(recovered).status?.markets[0]?.openingReference, recovered)
  assert.equal(
    parseMarket({ ...openingReference, conflictCount: 0 }).status?.markets[0]?.openingReference
      ?.conflictCount,
    0,
  )
  assert.equal(parseMarket(undefined).error, null)
  assert.equal(parseMarket({ comparison: 'unavailable' }).error, null)
  assert.equal(parseMarket({ ...openingReference, comparison: 'mismatch' }).error, null)
  for (const invalid of [
    { ...openingReference, comparison: 'approved' },
    { ...openingReference, conflictCount: -1 },
    { ...openingReference, conflictCount: 0.5 },
    { ...openingReference, conflictCount: '1' },
    { ...openingReference, observation: { ...openingReference.observation, windowSeconds: 30 } },
    { ...openingReference, observation: { ...openingReference.observation, source: 'website' } },
    { ...openingReference, observation: { ...openingReference.observation, receivedAtMs: '6000' } },
    { ...openingReference, observation: { ...openingReference.observation, receivedAtMs: 1e99 } },
    { ...openingReference, website: { openPrice: -1, receivedAtMs: 7_000, eventId: 'invalid' } },
    null,
  ]) {
    assert.equal(parseMarket(invalid).status, null)
  }
})
