import assert from 'node:assert/strict'
import test from 'node:test'
import { marketSnapshotErrors } from './marketSnapshotVerification.js'

const expected = {
  rows: 7_660,
  wallets: 516,
  sharesVolume: 314_586.180452,
  complete: true,
  volumeGamma: 314_586.180452,
} as const

test('accepts an exactly persisted verified market', () => {
  assert.deepEqual(
    marketSnapshotErrors(expected, {
      tradeRows: 7_660,
      tradeWallets: 516,
      sharesVolume: 314_586.180452,
      orphanWallets: 0,
    }),
    [],
  )
})

test('reports persisted row, wallet, share, and participant mismatches', () => {
  const errors = marketSnapshotErrors(expected, {
    tradeRows: 7_659,
    tradeWallets: 515,
    sharesVolume: 314_585,
    orphanWallets: 1,
  })
  assert.equal(errors.length, 5)
  assert.match(errors[0]!, /persisted rows/)
  assert.match(errors[1]!, /persisted wallets/)
  assert.match(errors[2]!, /missing from market positions/)
  assert.match(errors[3]!, /API shares/)
  assert.match(errors[4]!, /Gamma/)
})

test('does not require an incomplete API snapshot to equal Gamma', () => {
  assert.deepEqual(
    marketSnapshotErrors(
      { ...expected, complete: false, sharesVolume: 300_000 },
      {
        tradeRows: 7_660,
        tradeWallets: 516,
        sharesVolume: 300_000,
        orphanWallets: 0,
      },
    ),
    [],
  )
})
