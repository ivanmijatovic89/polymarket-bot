import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCoverageScope } from './backtestCoverageScope.js'

const btc = ['btc-updown-15m-1780272000', 'btc-updown-15m-1780272900']

test('slug-selected BTC 15m runs get coverage scope without changing saved metadata', () => {
  const run = { symbol: null, timeframe: '15m', slugs: btc }
  assert.deepEqual(resolveCoverageScope(run), {
    symbol: 'btc',
    timeframe: '15m',
  })
  assert.equal(run.symbol, null)
  assert.deepEqual(run.slugs, btc)
})

test('explicit symbol selections retain existing coverage behavior', () => {
  assert.deepEqual(resolveCoverageScope({ symbol: 'btc', timeframe: '15m', slugs: null }), {
    symbol: 'btc',
    timeframe: '15m',
  })
})

test('coverage rejects mixed assets, mixed timeframes, malformed or absent selections', () => {
  for (const slugs of [
    null,
    [],
    {},
    'btc',
    [null],
    [...btc, 'eth-updown-15m-1780273800'],
    [...btc, 'btc-updown-5m-1780273800'],
    [...btc, 'btc-updown-0m-1780273800'],
    [...btc, 'btc-updown-15m-invalid'],
  ]) {
    assert.equal(resolveCoverageScope({ symbol: null, timeframe: '15m', slugs }), null)
  }
})

test('slug inference replaces the historical default timeframe as one coherent scope', () => {
  assert.deepEqual(
    resolveCoverageScope({
      symbol: null,
      timeframe: '15m',
      slugs: ['btc-updown-5m-1780272000'],
    }),
    {
      symbol: 'btc',
      timeframe: '5m',
    },
  )
})

test('partial explicit metadata must agree with the selected slugs', () => {
  assert.equal(resolveCoverageScope({ symbol: 'eth', timeframe: null, slugs: btc }), null)
  assert.deepEqual(resolveCoverageScope({ symbol: 'btc', timeframe: null, slugs: btc }), {
    symbol: 'btc',
    timeframe: '15m',
  })
})
