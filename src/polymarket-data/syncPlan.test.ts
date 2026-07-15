import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, plan } from './syncPlan.js'

function activityStep(argv: string[]) {
  return plan(parseArgs(argv)).find((s) => s.script === 'sync-activity.ts')
}
function verifyStep(argv: string[]) {
  return plan(parseArgs(argv)).find((s) => s.script === 'verify.ts')
}

test('--stale-after 0 is preserved and passed through to sync-activity', () => {
  const step = activityStep(['--stale-after', '0'])
  assert.ok(step)
  const i = step.args.indexOf('--stale-after')
  assert.equal(step.args[i + 1], '0') // NOT the default 120
})

test('--resample 0 is preserved and passed through to verify', () => {
  const step = verifyStep(['--resample', '0'])
  assert.ok(step)
  const i = step.args.indexOf('--resample')
  assert.equal(step.args[i + 1], '0') // NOT the default 10
})

test('omitting the flags uses the documented defaults', () => {
  const a = activityStep([])!
  assert.equal(a.args[a.args.indexOf('--stale-after') + 1], '120')
  const v = verifyStep([])!
  assert.equal(v.args[v.args.indexOf('--resample') + 1], '10')
})

test('invalid concurrency values fail clearly', () => {
  assert.throws(() => parseArgs(['--concurrency', '-3']), /concurrency requires an integer >= 1/)
  assert.throws(() => parseArgs(['--concurrency', 'abc']), /concurrency requires an integer >= 1/)
  assert.throws(() => parseArgs(['--concurrency', '0']), /concurrency requires an integer >= 1/)
  assert.throws(() => parseArgs(['--concurrency']), /concurrency requires an integer >= 1/)
})

test('negative stale-after / resample are rejected (but 0 is allowed)', () => {
  assert.throws(() => parseArgs(['--stale-after', '-1']), /stale-after requires an integer >= 0/)
  assert.throws(() => parseArgs(['--resample', '-1']), /resample requires an integer >= 0/)
  assert.doesNotThrow(() => parseArgs(['--stale-after', '0', '--resample', '0']))
})

test('plan: --symbol btc --timeframe 5m,15m fans market stages per selector, activity once', () => {
  const steps = plan(parseArgs(['--symbol', 'btc', '--timeframe', '5m,15m']))
  const markets = steps.filter((s) => s.script === 'sync-markets.ts')
  assert.equal(markets.length, 2) // one per timeframe
  assert.equal(steps.filter((s) => s.script === 'sync-activity.ts').length, 1)
})

test('plan: --skip omits stages', () => {
  const steps = plan(parseArgs(['--skip', 'backfill,verify']))
  assert.equal(
    steps.some((s) => s.stage === 'backfill' || s.stage === 'verify'),
    false,
  )
})
