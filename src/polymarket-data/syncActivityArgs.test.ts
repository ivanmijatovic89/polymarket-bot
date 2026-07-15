import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from './syncActivityArgs.js'

test('--min-trades rejects non-numeric / fractional / negative / missing', () => {
  assert.throws(() => parseArgs(['--min-trades', 'abc']), /--min-trades requires an integer >= 0/)
  assert.throws(() => parseArgs(['--min-trades', '2.5']), /--min-trades requires an integer >= 0/)
  assert.throws(() => parseArgs(['--min-trades', '-1']), /--min-trades requires an integer >= 0/)
  assert.throws(() => parseArgs(['--min-trades']), /--min-trades requires an integer >= 0/)
})

test('--min-trades accepts a valid integer, including 0', () => {
  assert.equal(parseArgs(['--min-trades', '0']).minTrades, 0)
  assert.equal(parseArgs(['--min-trades', '25']).minTrades, 25)
})

test('--concurrency rejects <1 / fractional / non-numeric / missing', () => {
  assert.throws(() => parseArgs(['--concurrency', '0']), /--concurrency requires an integer >= 1/)
  assert.throws(() => parseArgs(['--concurrency', '-3']), /--concurrency requires an integer >= 1/)
  assert.throws(() => parseArgs(['--concurrency', '1.5']), /--concurrency requires an integer >= 1/)
  assert.throws(() => parseArgs(['--concurrency', 'xx']), /--concurrency requires an integer >= 1/)
  assert.throws(() => parseArgs(['--concurrency']), /--concurrency requires an integer >= 1/)
})

test('defaults hold when the flags are omitted (no silent garbage default)', () => {
  const a = parseArgs([])
  assert.equal(a.minTrades, 0)
  assert.equal(a.concurrency, 4)
})

test('--limit still preserves 0 and rejects invalid values', () => {
  assert.equal(parseArgs(['--limit', '0']).limit, 0)
  assert.throws(() => parseArgs(['--limit', '-1']), /--limit requires an integer >= 0/)
  assert.throws(() => parseArgs(['--limit', '3.2']), /--limit requires an integer >= 0/)
})
