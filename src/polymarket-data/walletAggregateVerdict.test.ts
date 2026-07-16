import test from 'node:test'
import assert from 'node:assert/strict'
import { walletAggregateVerdict } from './walletAggregateVerdict.js'

test('wallet rows and aggregate economics match exactly', () => {
  const verdict = walletAggregateVerdict(
    { rows: 3, size: 10, usdcSize: 4.25 },
    { rows: 3, size: 10, usdcSize: 4.25 },
  )
  assert.equal(verdict.ok, true)
})

test('a row count, material size, or USDC mismatch fails', () => {
  assert.equal(
    walletAggregateVerdict(
      { rows: 3, size: 10, usdcSize: 4.25 },
      { rows: 1, size: 10, usdcSize: 4.25 },
    ).ok,
    false,
  )
  assert.equal(
    walletAggregateVerdict(
      { rows: 3, size: 10, usdcSize: 4.25 },
      { rows: 1, size: 9.8, usdcSize: 4.25 },
    ).ok,
    false,
  )
  assert.equal(
    walletAggregateVerdict(
      { rows: 3, size: 10, usdcSize: 4.25 },
      { rows: 1, size: 10, usdcSize: 4.1 },
    ).ok,
    false,
  )
})
