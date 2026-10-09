import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { MarketJobData } from '../jobTypes.js'
import { jobKeySha256, restoreFromCache, storeInCache, traceCacheKey } from './traceCache.js'

const job = (over: Partial<MarketJobData> = {}): MarketJobData =>
  ({
    submissionUid: 'parity-s',
    batchUid: 'parity-s',
    idx: 0,
    filePath: '/d/x.parquet',
    slug: 'btc-updown-15m-1775417400',
    marketMeta: undefined,
    marketResolution: { tokenMap: { UP: 'a', DOWN: 'b' }, outcome: 'UP' },
    strategyId: 'feed-exerciser',
    strategyParams: { tickOnUpdate: true },
    inputMode: 'telonex-delta',
    order: 'recorded',
    timeDriven: false,
    latency: { delayMs: 0, jitterMs: 0 },
    strategyWindow: { startMs: 1, endMs: 2 },
    gammaPriceToBeat: { priceToBeat: 68110.02906982866, syncedAtMs: 5 },
    commitSha: 'aaa',
    ...over,
  }) as MarketJobData

const base = {
  trees: { 'src/trading': 't1' },
  job: job(),
  inputs: { market: { path: '/d/x.parquet', bytes: 10, sha256: 'h' }, feedFiles: [] },
  oracleEnv: { PATH: '/bin', TZ: 'UTC', MAX_EVENTS_PER_DRAIN: '4200' },
  traceLevel: 'feeds',
  patchSetSha256: null,
  oracleTree: 'head' as const,
}

describe('TS trace cache (60 OR-12)', () => {
  it('the key ignores provenance (commitSha) and host variables (PATH, HOME)', () => {
    const k = traceCacheKey(base)
    assert.equal(traceCacheKey({ ...base, job: job({ commitSha: 'bbb' }) }), k)
    assert.equal(
      traceCacheKey({ ...base, oracleEnv: { ...base.oracleEnv, PATH: '/usr/bin', HOME: '/h' } }),
      k,
    )
    assert.equal(jobKeySha256(job({ commitSha: 'x' })), jobKeySha256(job({ commitSha: 'y' })))
  })

  it('the key changes with trees, job, inputs, oracle env, trace level and patch set', () => {
    const k = traceCacheKey(base)
    const variants = [
      { ...base, trees: { 'src/trading': 't2' } },
      { ...base, job: job({ strategyParams: { tickOnUpdate: false } }) },
      { ...base, inputs: { ...base.inputs, market: { ...base.inputs.market, sha256: 'h2' } } },
      { ...base, oracleEnv: { ...base.oracleEnv, MAX_EVENTS_PER_DRAIN: '1' } },
      { ...base, traceLevel: 'decisions' },
      { ...base, patchSetSha256: 'p' },
      { ...base, oracleTree: 'pin' as const },
    ]
    for (const v of variants) assert.notEqual(traceCacheKey(v), k)
  })

  it('stores and restores traces by key', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'parity-cache-'))
    const src = path.join(dir, 'src.jsonl')
    writeFileSync(src, 'x\n')
    const key = traceCacheKey(base)
    const dest = path.join(dir, 'dest.jsonl')
    assert.equal(restoreFromCache(path.join(dir, 'c'), key, '.jsonl', dest), false)
    storeInCache(path.join(dir, 'c'), key, '.jsonl', src)
    assert.equal(restoreFromCache(path.join(dir, 'c'), key, '.jsonl', dest), true)
    assert.equal(readFileSync(dest, 'utf8'), 'x\n')
  })
})
