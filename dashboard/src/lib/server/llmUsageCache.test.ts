import assert from 'node:assert/strict'
import test from 'node:test'
import { createLastGoodUsageMerger } from './llmUsageCache'

const goodUsage = {
  account: 'Claude',
  windows: [{ label: '5h window', percentUsed: 12, resetsAt: '2026-08-03T01:00:00Z' }],
}

test('keeps the last successful account value when a refresh fails', () => {
  const merge = createLastGoodUsageMerger()

  assert.deepEqual(merge([goodUsage]), [goodUsage])
  assert.deepEqual(
    merge([{ account: 'Claude', windows: [], error: 'rate-limited by provider' }]),
    [{ ...goodUsage, staleError: 'rate-limited by provider' }],
  )
})

test('returns an error when an account has no successful value yet', () => {
  const merge = createLastGoodUsageMerger()
  const error = { account: 'Claude', windows: [], error: 'not authenticated' }

  assert.deepEqual(merge([error]), [error])
})

test('replaces the last-good value after a successful refresh', () => {
  const merge = createLastGoodUsageMerger()
  const updated = {
    ...goodUsage,
    windows: [{ ...goodUsage.windows[0]!, percentUsed: 25 }],
  }

  merge([goodUsage])
  merge([updated])
  assert.deepEqual(
    merge([{ account: 'Claude', windows: [], error: 'temporary failure' }]),
    [{ ...updated, staleError: 'temporary failure' }],
  )
})
