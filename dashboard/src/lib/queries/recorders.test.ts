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
