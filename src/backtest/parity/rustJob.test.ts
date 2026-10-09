import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { MarketJobData } from '../jobTypes.js'
import { REPO_ROOT, loadCell } from './cell.js'
import { PARITY_DIR } from './oracle.js'
import {
  assertEngineJobStrategy,
  checkDescribe,
  describeArgs,
  loadEngineJobBuilder,
  nativeJobFor,
  rustRunArgs,
} from './rustJob.js'

const cell = loadCell(path.join(PARITY_DIR, 'cells', 'T15-on.json'))
const params = { tickOnUpdate: true, trade: false, ta: false, chainlink: true }
const feeds = {
  binanceWsSpotPrice: { tickOnUpdate: true },
  rtdsCryptoPrices: { tickOnUpdate: true },
  polymarketPriceToBeat: { enabled: true },
}
const describeDoc = (over: Record<string, unknown> = {}) => ({
  type: 'describe',
  capabilities: {
    traceFormat: 'pmb-parity-trace/2',
    profiles: ['ts-compat', 'realistic'],
    inputModes: ['telonex-delta'],
  },
  strategy: { id: 'feed-exerciser.rs', results: [{ ok: true, params, requiredFeeds: feeds }] },
  ...over,
})

describe('Rust side of a cell (60 HR-1, HR-2; 20 §5.1, §5.4)', () => {
  it('the native job carries the Rust strategy id and the cell ModelConfig (HR-1, 21 §4)', () => {
    const tsJob = { strategyId: 'feed-exerciser', slug: 's' } as unknown as MarketJobData
    const n = nativeJobFor(tsJob, cell)
    assert.equal(n.strategyId, 'feed-exerciser.rs')
    assert.equal(n.modelConfig, cell.modelConfig)
    assert.equal(tsJob.strategyId, 'feed-exerciser')
    assert.doesNotThrow(() =>
      assertEngineJobStrategy({ run: { strategyId: 'feed-exerciser.rs' } }, cell),
    )
    assert.throws(
      () => assertEngineJobStrategy({ run: { strategyId: 'feed-exerciser' } }, cell),
      /strategyId/,
    )
  })

  it('runs the binary as `run --job --trace --trace-level` (HR-2, 20 §5.4)', () => {
    assert.deepEqual(rustRunArgs('/j.json', '/t.jsonl.gz', 'feeds'), [
      'run',
      '--job',
      '/j.json',
      '--trace',
      '/t.jsonl.gz',
      '--trace-level',
      'feeds',
    ])
    assert.deepEqual(describeArgs({ a: 1 }), ['describe', '--params', '{"a":1}'])
  })

  it('describe pre-flight accepts a matching binary and lists every mismatch', () => {
    assert.deepEqual(checkDescribe(describeDoc(), cell, { params, requiredFeeds: feeds }), [])
    const bad = checkDescribe(
      describeDoc({
        capabilities: {
          traceFormat: 'pmb-parity-trace/1',
          profiles: ['realistic'],
          inputModes: [],
        },
        strategy: {
          id: 'feed-exerciser',
          results: [{ ok: true, params: { ...params, ta: true }, requiredFeeds: {} }],
        },
      }),
      cell,
      { params, requiredFeeds: feeds },
    )
    assert.equal(bad.length, 6)
    assert.deepEqual(
      checkDescribe({ type: 'error' }, cell, { params, requiredFeeds: feeds }).length,
      1,
    )
  })

  it('the EngineJob builder comes from src/native or fails loudly; an override must export buildEngineJob', async () => {
    const hasNative = ['src/native/buildEngineJob.ts', 'src/native/index.ts'].some((f) =>
      existsSync(path.join(REPO_ROOT, f)),
    )
    if (!hasNative) await assert.rejects(loadEngineJobBuilder(), /src\/native/)
    const dir = mkdtempSync(path.join(tmpdir(), 'parity-builder-'))
    const good = path.join(dir, 'good.mjs')
    writeFileSync(
      good,
      'export function buildEngineJob(job) { return { run: { strategyId: job.strategyId } } }\n',
    )
    const fn = await loadEngineJobBuilder(good)
    assert.deepEqual(
      await fn(nativeJobFor({ slug: 's' } as unknown as MarketJobData, cell), { dataRoot: '/d' }),
      {
        run: { strategyId: 'feed-exerciser.rs' },
      },
    )
    const bad = path.join(dir, 'bad.mjs')
    writeFileSync(bad, 'export const x = 1\n')
    await assert.rejects(loadEngineJobBuilder(bad), /does not export buildEngineJob/)
  })
})
