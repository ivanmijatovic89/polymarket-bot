import test from 'node:test'
import assert from 'node:assert/strict'
import { eligibilityPlan } from './marketQueue.js'

test('a --slug target still requires closed + settled (an open market is not eligible)', () => {
  // The regression: --slug bypassed EVERYTHING, so a just-cataloged OPEN market
  // (pending) could be position/trade-synced from an in-progress snapshot and
  // marked done. The slug path must keep the closed + settlement guards.
  const plan = eligibilityPlan({ slugs: ['btc-updown-15m-1783742400'] })
  assert.equal(plan.requireClosed, true, 'closed guard retained for --slug')
  assert.equal(plan.requireSettled, true, 'min-close-age (settlement) guard retained for --slug')
  // ...but it DOES bypass symbol/timeframe and the backfill floor, so a named
  // market outside the floor can still be re-run by name.
  assert.equal(plan.requireBackfillFloor, false, '--slug bypasses the backfill floor')
  assert.deepEqual(plan.slugs, ['btc-updown-15m-1783742400'])
  assert.equal(plan.symbol, undefined)
  assert.equal(plan.timeframe, undefined)
})

test('the non-slug path keeps all guards including the backfill floor', () => {
  const plan = eligibilityPlan({ symbol: 'btc', timeframe: '15m' })
  assert.equal(plan.requireClosed, true)
  assert.equal(plan.requireSettled, true)
  assert.equal(plan.requireBackfillFloor, true)
  assert.equal(plan.symbol, 'btc')
  assert.equal(plan.timeframe, '15m')
  assert.equal(plan.slugs, undefined)
})

test('an empty slug list is treated as no slug filter (guards + floor apply)', () => {
  const plan = eligibilityPlan({ slugs: [] })
  assert.equal(plan.requireBackfillFloor, true)
  assert.equal(plan.slugs, undefined)
})
