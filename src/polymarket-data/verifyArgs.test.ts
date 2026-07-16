import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from './verifyArgs.js'

test('--limit requires an integer >= 1', () => {
  assert.equal(parseArgs(['--limit', '5']).limit, 5)
  assert.throws(() => parseArgs(['--limit', '0']), /--limit requires an integer >= 1/)
  assert.throws(() => parseArgs(['--limit', '-2']), /--limit requires an integer >= 1/)
  assert.throws(() => parseArgs(['--limit', '3.5']), /--limit requires an integer >= 1/)
  assert.throws(() => parseArgs(['--limit', 'abc']), /--limit requires an integer >= 1/)
  assert.throws(() => parseArgs(['--limit']), /--limit requires an integer >= 1/)
})

test('--resample requires an integer >= 0 and preserves 0', () => {
  assert.equal(parseArgs(['--resample', '0']).resample, 0, '--resample 0 is kept, not defaulted')
  assert.equal(parseArgs(['--resample', '20']).resample, 20)
  assert.throws(() => parseArgs(['--resample', '-1']), /--resample requires an integer >= 0/)
  assert.throws(() => parseArgs(['--resample', '2.5']), /--resample requires an integer >= 0/)
  assert.throws(() => parseArgs(['--resample', 'xx']), /--resample requires an integer >= 0/)
  assert.throws(() => parseArgs(['--resample']), /--resample requires an integer >= 0/)
})

test('defaults hold when the flags are omitted', () => {
  const a = parseArgs([])
  assert.equal(a.limit, null)
  assert.equal(a.resample, 0)
  assert.equal(a.walletResample, 3)
  assert.equal(a.requeue, false)
})

test('--wallet-resample requires an integer >= 0', () => {
  assert.equal(parseArgs(['--wallet-resample', '0']).walletResample, 0)
  assert.equal(parseArgs(['--wallet-resample', '5']).walletResample, 5)
  assert.throws(
    () => parseArgs(['--wallet-resample', '-1']),
    /--wallet-resample requires an integer >= 0/,
  )
})

test('other flags still parse', () => {
  const a = parseArgs(['--symbol', 'BTC', '--timeframe', '15m', '--slug', 'x, y', '--requeue'])
  assert.equal(a.symbol, 'btc')
  assert.equal(a.timeframe, '15m')
  assert.deepEqual(a.slugs, ['x', 'y'])
  assert.equal(a.requeue, true)
})

test('an unknown timeframe is rejected', () => {
  assert.throws(() => parseArgs(['--timeframe', '7m']), /unknown --timeframe: 7m/)
})
