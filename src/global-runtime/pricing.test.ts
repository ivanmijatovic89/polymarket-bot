import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimateCodexApiCost, resolveCodexModel } from './pricing.js'

test('estimates GPT-5.6 API-equivalent token cost', () => {
  assert.equal(resolveCodexModel('gpt-5.6'), 'gpt-5.6-sol')
  const cost = estimateCodexApiCost('gpt-5.6', {
    inputTokens: 1_000_000,
    cachedInputTokens: 2_000_000,
    cacheReadInputTokens: 1_000_000,
    cacheCreationInputTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningOutputTokens: 100_000,
    estimatedApiCostUsd: null,
  })
  assert.equal(cost, 41.75)
})

test('does not invent pricing for an unknown Codex model', () => {
  const cost = estimateCodexApiCost('unknown-model', {
    inputTokens: 1,
    cachedInputTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    outputTokens: 1,
    reasoningOutputTokens: null,
    estimatedApiCostUsd: null,
  })
  assert.equal(cost, null)
})
