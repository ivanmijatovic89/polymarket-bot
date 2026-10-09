import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ManifestError, parseBenchSet } from './manifest.js'

const SHA = 'a'.repeat(64)
const SLUG = 'btc-updown-15m-1780925400'
const FILE = `events/telonex/delta-typed/btc/15m/${SLUG}.parquet`
const MARKET = { slug: SLUG, sha256: SHA, bytes: 6444733, file: FILE }
const VALID = {
  name: 'smoke-50',
  selection: { note: 'provenance, not interpreted' },
  inputMode: 'telonex-delta',
  strategy: { id: 'engine-exerciser.v2.rs', params: { trade: true } },
  modelConfig: { profile: 'ts-compat' },
  markets: [
    { ...MARKET, rows: 449314 },
    {
      slug: 'btc-updown-5m-1770857100',
      sha256: SHA,
      bytes: 8472,
      file: 'events/telonex/delta-typed/btc/5m/btc-updown-5m-1770857100.parquet',
    },
  ],
}

describe('parseBenchSet (16 §13.1)', () => {
  it('reads markets in order with their source identity', () => {
    const set = parseBenchSet(JSON.stringify(VALID), 'smoke-50.json', 'smoke-50')
    assert.equal(set.name, 'smoke-50')
    assert.equal(set.inputMode, 'telonex-delta')
    assert.deepEqual(set.strategy, { id: 'engine-exerciser.v2.rs', params: { trade: true } })
    assert.deepEqual(set.modelConfig, { profile: 'ts-compat' })
    assert.deepEqual(set.markets[0], { idx: 0, ...MARKET, rows: 449314 })
    assert.equal(set.markets[1]!.idx, 1)
    assert.equal(set.markets[1]!.rows, null)
  })

  const without = (k: string): Record<string, unknown> => {
    const o: Record<string, unknown> = { ...VALID }
    delete o[k]
    return o
  }
  const market = (over: Record<string, unknown>, drop?: string): Record<string, unknown> => {
    const m: Record<string, unknown> = { ...MARKET, ...over }
    if (drop !== undefined) delete m[drop]
    return { ...VALID, markets: [m] }
  }
  const bad: Array<[string, unknown]> = [
    ['not an object', [1]],
    ['no name', without('name')],
    ['name differs from file', { ...VALID, name: 'other' }],
    ['no input mode', without('inputMode')],
    ['no strategy', without('strategy')],
    ['strategy as a string', { ...VALID, strategy: 'x' }],
    ['strategy without params', { ...VALID, strategy: { id: 'x' } }],
    ['no model config', without('modelConfig')],
    ['unknown top-level key', { ...VALID, params: {} }],
    ['no markets', without('markets')],
    ['empty markets', { ...VALID, markets: [] }],
    ['bare slug market', { ...VALID, markets: [SLUG] }],
    ['bad slug', market({ slug: 'eth-updown-15m-01' })],
    ['duplicate slug', { ...VALID, markets: [MARKET, MARKET] }],
    ['no sha', market({}, 'sha256')],
    ['bad sha', market({ sha256: 'ABC' })],
    ['no bytes', market({}, 'bytes')],
    ['zero bytes', market({ bytes: 0 })],
    ['no file', market({}, 'file')],
    ['absolute file', market({ file: `/data/${FILE}` })],
    ['dot-dot file', market({ file: `events/../${SLUG}.parquet` })],
    ['file of another slug', market({ file: 'events/btc-updown-15m-1.parquet' })],
    ['unknown market key', market({ size: 1 })],
  ]
  for (const [what, doc] of bad) {
    it(`rejects: ${what}`, () => {
      assert.throws(
        () => parseBenchSet(JSON.stringify(doc), 'smoke-50.json', 'smoke-50'),
        ManifestError,
      )
    })
  }

  it('rejects text that is not JSON', () => {
    assert.throws(() => parseBenchSet('{', 'x.json', 'x'), /not JSON/)
  })
})
