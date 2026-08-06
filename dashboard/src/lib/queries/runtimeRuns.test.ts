import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickResolvedModel, totalUsage } from './runtimeRuns'

// These pure helpers mirror GlobalRuntime.listRuns() semantics
// (src/global-runtime/runtime.ts totalUsage/resolvedModel) — the tests pin
// the DB-read path to the daemon's behavior so the two cannot drift.

const usage = (overrides: Record<string, number | null> = {}) => ({
  inputTokens: null,
  cachedInputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  outputTokens: null,
  reasoningOutputTokens: null,
  estimatedApiCostUsd: null,
  ...overrides,
})

test('totalUsage keeps SQL-SUM null semantics per column', () => {
  const totals = totalUsage([
    usage({ inputTokens: 10, outputTokens: 3 }),
    usage({ inputTokens: 5, estimatedApiCostUsd: 0.25 }),
  ])
  assert.equal(totals.inputTokens, 15)
  assert.equal(totals.outputTokens, 3)
  assert.equal(totals.estimatedApiCostUsd, 0.25)
  // No session reported cache reads → null, NOT 0.
  assert.equal(totals.cacheReadInputTokens, null)
  assert.equal(totals.reasoningOutputTokens, null)
})

test('totalUsage of no sessions is all-null', () => {
  const totals = totalUsage([])
  assert.deepEqual(totals, usage())
})

test('pickResolvedModel takes the newest session that resolved one', () => {
  // Sessions arrive newest-first (session_number DESC), matching the daemon.
  assert.equal(
    pickResolvedModel([
      { resolvedModel: null },
      { resolvedModel: 'claude-opus-5-20260115' },
      { resolvedModel: 'claude-opus-5-20251101' },
    ]),
    'claude-opus-5-20260115',
  )
  assert.equal(pickResolvedModel([{ resolvedModel: null }]), null)
  assert.equal(pickResolvedModel([]), null)
})
