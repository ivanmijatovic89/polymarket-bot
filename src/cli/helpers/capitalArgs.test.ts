import assert from 'node:assert/strict'
import test from 'node:test'
import { inheritedStartingCapital, resolveStartingCapital } from './capitalArgs.js'
import { parseArgs } from './backtestArgs.js'

test('starting capital has one default and explicit CLI overrides environment', () => {
  assert.equal(resolveStartingCapital([], {}), 500)
  assert.equal(resolveStartingCapital([], { STARTING_CAPITAL: '250.5' }), 250.5)
  assert.equal(resolveStartingCapital(['--starting-capital', '0'], { STARTING_CAPITAL: 'bad' }), 0)
  assert.equal(resolveStartingCapital(['--starting-capital=750']), 750)
  assert.equal(parseArgs(['--starting-capital', '123.5']).startingCapital, 123.5)
  assert.deepEqual(parseArgs(['--starting-capital', '500']).filePaths, [])
})

test('invalid amounts fail instead of silently disabling funding', () => {
  for (const raw of ['', '-1', 'Infinity', 'NaN', '500junk']) {
    assert.throws(() => resolveStartingCapital(['--starting-capital', raw], {}))
  }
  assert.throws(() => resolveStartingCapital(['--starting-capital'], {}))
})

test('extensions inherit recorded capital and reject ambiguous historical runs or overrides', () => {
  assert.equal(
    inheritedStartingCapital('npm run backtest -- --strategy example --starting-capital 250.5'),
    250.5,
  )
  assert.throws(() => inheritedStartingCapital('npm run backtest -- --strategy example'))
  assert.throws(() => parseArgs(['--extend', '1', '--starting-capital=500']), /inherited/)
})
