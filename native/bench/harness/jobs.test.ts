import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { checkJob, checkJobInput, checkRunConsistency, JobError, stableStringify } from './jobs.js'
import type { BenchMarket, BenchSet } from './manifest.js'

const SLUG = 'btc-updown-15m-1780925400'
const FILE = `events/telonex/delta-typed/btc/15m/${SLUG}.parquet`
const MARKET: BenchMarket = {
  idx: 3,
  slug: SLUG,
  sha256: 'a'.repeat(64),
  bytes: 1234,
  file: FILE,
  rows: null,
}
const MODEL = { profile: 'ts-compat', compatLatency: { delayMs: 0 } }

const job = (
  over: Record<string, unknown> = {},
  market: Record<string, unknown> = {},
): Record<string, unknown> => ({
  jobSchemaVersion: 1,
  run: {
    strategyId: 'engine-exerciser.v2.rs',
    inputMode: 'telonex-delta',
    modelConfig: MODEL,
    candidates: [{ key: 'k', index: 0, params: { size: 5 }, execution: null }],
    ...over,
  },
  market: {
    slug: SLUG,
    input: { path: `/data/${FILE}`, bytes: 1234, sha256: null },
    ...market,
  },
})

const SET: BenchSet = {
  name: 'smoke-50',
  inputMode: 'telonex-delta',
  strategy: { id: 'engine-exerciser.v2.rs', params: { size: 5 } },
  modelConfig: { compatLatency: { delayMs: 0 }, profile: 'ts-compat' },
  markets: [MARKET],
}

describe('checkJob', () => {
  it('extracts what the driver needs', () => {
    const j = checkJob(job(), MARKET, '/jobs/x.json')
    assert.equal(j.idx, 3)
    assert.deepEqual(j.input, { path: `/data/${FILE}`, bytes: 1234, sha256: null })
    assert.equal(j.runKey, stableStringify(job().run))
  })

  const bad: Array<[string, unknown]> = [
    ['not an object', []],
    ['wrong schema version', { ...job(), jobSchemaVersion: 2 }],
    ['slug mismatch', job({}, { slug: 'btc-updown-15m-1780926300' })],
    ['two candidates', job({ candidates: [{ params: {} }, { params: {} }] })],
    ['candidate without params', job({ candidates: [{ key: 'k' }] })],
    ['no strategy id', job({ strategyId: '' })],
    ['no input mode', job({ inputMode: undefined })],
    ['no model config', job({ modelConfig: null })],
    ['relative input path', job({}, { input: { path: 'data/x.parquet', bytes: 1 } })],
    ['no input bytes', job({}, { input: { path: '/x.parquet', sha256: null } })],
  ]
  for (const [what, doc] of bad) {
    it(`rejects: ${what}`, () => {
      assert.throws(() => checkJob(doc, MARKET, '/jobs/x.json'), JobError)
    })
  }
})

describe('checkJobInput', () => {
  it('requires the manifest file under the data root, its size and sha', () => {
    const ok = checkJob(job(), MARKET, '/jobs/x.json')
    assert.doesNotThrow(() => checkJobInput(ok, MARKET, '/data'))
    assert.throws(() => checkJobInput(ok, MARKET, '/other-root'), /not the manifest file/)
    const big = checkJob(
      job({}, { input: { path: `/data/${FILE}`, bytes: 99, sha256: null } }),
      MARKET,
      '/j',
    )
    assert.throws(() => checkJobInput(big, MARKET, '/data'), /bytes 99/)
    const sha = checkJob(
      job({}, { input: { path: `/data/${FILE}`, bytes: 1234, sha256: 'b'.repeat(64) } }),
      MARKET,
      '/j',
    )
    assert.throws(() => checkJobInput(sha, MARKET, '/data'), /sha256/)
  })

  it('accepts the same file through a symlinked data root', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-jobs-test-'))
    try {
      const real = path.join(tmp, 'real')
      fs.mkdirSync(path.join(real, path.dirname(FILE)), { recursive: true })
      fs.writeFileSync(path.join(real, FILE), 'x')
      fs.symlinkSync(real, path.join(tmp, 'link'))
      const j = checkJob(
        job({}, { input: { path: path.join(real, FILE), bytes: 1234, sha256: null } }),
        MARKET,
        '/j',
      )
      assert.doesNotThrow(() => checkJobInput(j, MARKET, path.join(tmp, 'link')))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('checkRunConsistency (21 §5, 16 §13.1)', () => {
  const a = checkJob(job(), MARKET, '/jobs/a.json')
  const B_SLUG = 'btc-updown-15m-1780926300'
  const b = checkJob(job({}, { slug: B_SLUG }), { ...MARKET, idx: 4, slug: B_SLUG }, '/jobs/b.json')

  it('accepts one shared run section matching the manifest', () => {
    const run = checkRunConsistency(SET, [a, b])
    assert.equal(run.strategyId, 'engine-exerciser.v2.rs')
  })

  const differing: Array<[string, Record<string, unknown>]> = [
    ['params', { candidates: [{ key: 'k', index: 0, params: { size: 6 }, execution: null }] }],
    ['input mode', { inputMode: 'recorder-v4' }],
    ['model config', { modelConfig: { profile: 'realistic' } }],
    ['strategy', { strategyId: 'other' }],
  ]
  for (const [what, over] of differing) {
    it(`rejects jobs whose ${what} differ from each other or from the manifest`, () => {
      const other = checkJob(job(over), MARKET, '/jobs/c.json')
      assert.throws(() => checkRunConsistency(SET, [a, other]), /run section differs/)
      assert.throws(() => checkRunConsistency(SET, [other]), /differ from the manifest/)
    })
  }

  it('rejects an empty job list', () => {
    assert.throws(() => checkRunConsistency(SET, []), JobError)
  })

  it('stableStringify sorts keys at every depth', () => {
    assert.equal(stableStringify({ b: [{ d: 1, c: 2 }], a: 'x' }), '{"a":"x","b":[{"c":2,"d":1}]}')
  })
})
