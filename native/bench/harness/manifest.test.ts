import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ManifestError, parseBenchSet } from './manifest.js'

const SHA = 'a'.repeat(64)

describe('parseBenchSet', () => {
  it('reads markets in order with their source identity', () => {
    const set = parseBenchSet(
      JSON.stringify({
        name: 'smoke-50',
        strategy: { id: 'engine-exerciser', params: { trade: true } },
        modelConfig: { profile: 'ts-compat' },
        markets: [
          {
            slug: 'btc-updown-15m-1780925400',
            sha256: SHA,
            bytes: 6444733,
            file: 'events/x.parquet',
          },
          'btc-updown-5m-1770857100',
        ],
        selection: { note: 'kept, not interpreted' },
      }),
      'smoke-50.json',
      'smoke-50',
    )
    assert.equal(set.name, 'smoke-50')
    assert.equal(set.strategyId, 'engine-exerciser')
    assert.deepEqual(set.params, { trade: true })
    assert.deepEqual(set.modelConfig, { profile: 'ts-compat' })
    assert.deepEqual(set.markets, [
      {
        idx: 0,
        slug: 'btc-updown-15m-1780925400',
        sha256: SHA,
        bytes: 6444733,
        file: 'events/x.parquet',
      },
      { idx: 1, slug: 'btc-updown-5m-1770857100', sha256: null, bytes: null, file: null },
    ])
  })

  it('accepts strategyId + params and takes the name from the file', () => {
    const set = parseBenchSet(
      JSON.stringify({ strategyId: 's', params: {}, markets: ['btc-updown-15m-1780925400'] }),
      'heavy-1.json',
      'heavy-1',
    )
    assert.equal(set.name, 'heavy-1')
    assert.equal(set.strategyId, 's')
    assert.equal(set.modelConfig, null)
  })

  const bad: Array<[string, unknown]> = [
    ['not an object', [1]],
    ['no markets', { name: 'x' }],
    ['empty markets', { name: 'x', markets: [] }],
    ['bad slug', { name: 'x', markets: ['eth-updown-15m-01'] }],
    [
      'duplicate slug',
      { name: 'x', markets: ['btc-updown-15m-1780925400', 'btc-updown-15m-1780925400'] },
    ],
    ['bad sha', { name: 'x', markets: [{ slug: 'btc-updown-15m-1780925400', sha256: 'ABC' }] }],
    ['bad bytes', { name: 'x', markets: [{ slug: 'btc-updown-15m-1780925400', bytes: -1 }] }],
    ['name differs from file', { name: 'other', markets: ['btc-updown-15m-1780925400'] }],
    [
      'strategy and strategyId',
      { name: 'x', strategy: 'a', strategyId: 'b', markets: ['btc-updown-15m-1780925400'] },
    ],
    [
      'params outside strategy object',
      { name: 'x', strategy: { id: 'a' }, params: {}, markets: ['btc-updown-15m-1780925400'] },
    ],
    [
      'modelConfig not an object',
      { name: 'x', modelConfig: 3, markets: ['btc-updown-15m-1780925400'] },
    ],
  ]
  for (const [what, doc] of bad) {
    it(`rejects: ${what}`, () => {
      assert.throws(() => parseBenchSet(JSON.stringify(doc), 'x.json', 'x'), ManifestError)
    })
  }

  it('rejects text that is not JSON', () => {
    assert.throws(() => parseBenchSet('{', 'x.json', 'x'), /not JSON/)
  })
})
