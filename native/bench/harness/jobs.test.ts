import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkJob, checkRunConsistency, JobError, stableStringify } from './jobs.js'
import type { BenchMarket, BenchSet } from './manifest.js'

const MARKET: BenchMarket = {
  idx: 3,
  slug: 'btc-updown-15m-1780925400',
  sha256: null,
  bytes: null,
  file: null,
}

const job = (
  over: Record<string, unknown> = {},
  market: Record<string, unknown> = {},
): Record<string, unknown> => ({
  jobSchemaVersion: 1,
  run: {
    strategyId: 'engine-exerciser',
    inputMode: 'telonex-delta',
    modelConfig: { profile: 'ts-compat', latency: { delayMs: 0 } },
    candidates: [{ key: 'k', index: 0, params: {} }],
    ...over,
  },
  market: {
    slug: MARKET.slug,
    input: { path: '/abs/btc-updown-15m-1780925400.parquet', bytes: 1 },
    ...market,
  },
})

describe('checkJob', () => {
  it('extracts what the driver needs', () => {
    const j = checkJob(job(), MARKET, '/jobs/x.json')
    assert.equal(j.idx, 3)
    assert.equal(j.strategyId, 'engine-exerciser')
    assert.equal(j.inputPath, '/abs/btc-updown-15m-1780925400.parquet')
    assert.equal(j.modelConfigKey, '{"latency":{"delayMs":0},"profile":"ts-compat"}')
  })

  const bad: Array<[string, unknown]> = [
    ['not an object', []],
    ['wrong schema version', { ...job(), jobSchemaVersion: 2 }],
    ['slug mismatch', job({}, { slug: 'btc-updown-15m-1780926300' })],
    ['two candidates', job({ candidates: [{}, {}] })],
    ['no strategy id', job({ strategyId: '' })],
    ['no model config', job({ modelConfig: null })],
    ['relative input path', job({}, { input: { path: 'data/x.parquet' } })],
  ]
  for (const [what, doc] of bad) {
    it(`rejects: ${what}`, () => {
      assert.throws(() => checkJob(doc, MARKET, '/jobs/x.json'), JobError)
    })
  }
})

describe('checkRunConsistency', () => {
  const set = (over: Partial<BenchSet> = {}): BenchSet => ({
    name: 'smoke-50',
    strategyId: null,
    params: null,
    modelConfig: null,
    markets: [MARKET],
    ...over,
  })
  const a = checkJob(job(), MARKET, '/jobs/a.json')
  const b = checkJob(
    job(),
    { ...MARKET, idx: 4, slug: 'btc-updown-15m-1780926300' },
    '/jobs/b.json',
  )

  it('accepts one shared run section matching the manifest', () => {
    const r = checkRunConsistency(
      set({
        strategyId: 'engine-exerciser',
        modelConfig: { latency: { delayMs: 0 }, profile: 'ts-compat' },
      }),
      [a],
    )
    assert.equal(r.strategyId, 'engine-exerciser')
  })

  it('rejects differing jobs and a manifest mismatch', () => {
    const other = checkJob(job({ modelConfig: { profile: 'realistic' } }), MARKET, '/jobs/c.json')
    assert.throws(() => checkRunConsistency(set(), [a, other]), /modelConfig differs/)
    assert.throws(() => checkRunConsistency(set({ strategyId: 'other' }), [a]), /pins other/)
    assert.throws(
      () => checkRunConsistency(set({ modelConfig: { profile: 'realistic' } }), [a]),
      /ModelConfig/,
    )
    assert.throws(() => checkRunConsistency(set(), []), JobError)
    assert.doesNotThrow(() => checkRunConsistency(set(), [a, b]))
  })

  it('stableStringify sorts keys at every depth', () => {
    assert.equal(stableStringify({ b: [{ d: 1, c: 2 }], a: 'x' }), '{"a":"x","b":[{"c":2,"d":1}]}')
  })
})
