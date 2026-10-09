import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { MarketJobData } from '../jobTypes.js'
import { loadCell } from './cell.js'
import { PARITY_DIR } from './oracle.js'
import { buildEngineJob } from '../../native/index.js'
import {
  assertEngineJobStrategy,
  checkDescribe,
  describeArgs,
  describedScheduleVersion,
  engineJobFor,
  loadEngineJobBuilder,
  nativeJobFor,
  nativeJobWithGate,
  parityGate,
  rustOnlyJobProblems,
  rustRunArgs,
} from './rustJob.js'
import { modelConfigSha256 } from './cell.js'

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

const gate = parityGate(
  { protocolVersion: 2, binary: { target: 'aarch64-apple-darwin' } as never },
  { path: '/bin/pmb-engine', sha256: 'b'.repeat(64) },
  false,
)

describe('Rust side of a cell (60 HR-1, HR-2; 20 §5.1, §5.4)', () => {
  it('the gate fields come from the binary that runs the market (21 §4, 40 §4.1, 60 §4.5)', () => {
    // spec: 21 §4 native + strategyArtifact rows; 40 §4.1, §4.2 step 2; 40 §10 (agent)
    const tsJob = {
      strategyId: 'feed-exerciser',
      slug: 'btc-updown-15m-1776556800',
      filePath: '/d/events/x.parquet',
      gammaPriceToBeat: { priceToBeat: 84000, syncedAtMs: 1 },
      strategyArtifact: { sha256: 'c'.repeat(64), r2Url: 'r2://x' },
    } as unknown as MarketJobData
    const t = nativeJobFor(tsJob, cell, {
      conditionId: '0xabc',
      bytes: 1,
      requiredFeeds: feeds,
      asOfMs: 0,
    })
    // The template carries no gate and drops the TS artifact ref.
    assert.equal('native' in t, false)
    assert.equal('strategyArtifact' in t, false)
    const n = nativeJobWithGate(t, gate)
    assert.deepEqual(n.native, {
      protocolVersion: 2,
      minShimVersion: 1,
      priorityClass: 'agent',
      producerDirty: false,
    })
    assert.deepEqual(n.strategyArtifact, {
      sha256: 'b'.repeat(64),
      r2Url: 'file:///bin/pmb-engine',
      kind: 'native',
      target: 'aarch64-apple-darwin',
    })
  })

  it('the native job carries the Rust strategy id, the cell ModelConfig and the local input (HR-1, 21 §4)', () => {
    const tsJob = {
      strategyId: 'feed-exerciser',
      slug: 'btc-updown-15m-1776556800',
      filePath: '/d/events/x.parquet',
      gammaPriceToBeat: { priceToBeat: 84000, syncedAtMs: 1 },
    } as unknown as MarketJobData
    const n = nativeJobFor(tsJob, cell, {
      conditionId: '0xabc',
      bytes: 123,
      requiredFeeds: feeds,
      asOfMs: 1_791_500_000_000,
    })
    assert.equal(n.strategyId, 'feed-exerciser.rs')
    assert.deepEqual(n.modelConfig, cell.modelConfig)
    assert.equal(tsJob.strategyId, 'feed-exerciser')
    assert.deepEqual(n.input, {
      path: '/d/events/x.parquet',
      r2Url: null,
      bytes: 123,
      sha256: null,
      format: { name: 'telonex-delta-typed', version: 1 },
    })
    assert.equal(n.readFrom, 'local')
    assert.equal(n.conditionId, '0xabc')
    assert.deepEqual(n.feedAvailability, { priceToBeat: { status: 'fed' } })
    assert.deepEqual(n.rules, { snapshotParserVersion: null, captured: {}, disagreements: 0 })
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
    // 60 §5.7: the twins' exerciser schedule versions must match when both are known.
    const withSchedule = (v: unknown) => {
      const d = describeDoc()
      return { ...d, strategy: { ...d.strategy, scheduleVersion: v } }
    }
    assert.deepEqual(
      checkDescribe(withSchedule(2), cell, { params, requiredFeeds: feeds, scheduleVersion: 2 }),
      [],
    )
    assert.match(
      checkDescribe(withSchedule(1), cell, {
        params,
        requiredFeeds: feeds,
        scheduleVersion: 2,
      }).join(),
      /schedule version 1 != TS EXERCISER_SCHEDULE_VERSION 2/,
    )
    assert.equal(describedScheduleVersion(withSchedule(2)), 2)
    assert.equal(describedScheduleVersion(describeDoc()), null)
    assert.equal(describedScheduleVersion(withSchedule('2')), null)
  })

  it('the EngineJob builder is src/native buildEngineJob; an override must export buildEngineJob', async () => {
    assert.equal(await loadEngineJobBuilder(), buildEngineJob)
    const dir = mkdtempSync(path.join(tmpdir(), 'parity-builder-'))
    const good = path.join(dir, 'good.mjs')
    writeFileSync(
      good,
      "export function buildEngineJob(job) { return { kind: 'job', job: { run: { strategyId: job.strategyId } } } }\n",
    )
    const fn = await loadEngineJobBuilder(good)
    const noSlug = {
      slug: null,
      filePath: '/x',
      submissionUid: 'u',
      strategyParams: {},
      inputMode: 'telonex-delta',
      order: 'recorded',
      timeDriven: false,
      latency: { delayMs: 0, jitterMs: 0 },
      startingCapital: 500,
      marketResolution: null,
      strategyWindow: null,
    } as unknown as MarketJobData
    const native = nativeJobWithGate(
      nativeJobFor(noSlug, cell, {
        conditionId: null,
        bytes: 1,
        requiredFeeds: null,
        asOfMs: 0,
      }),
      gate,
    )
    assert.deepEqual(
      await engineJobFor(fn, native, '/d', { tracePath: '/t', traceLevel: 'feeds' }),
      {
        run: { strategyId: 'feed-exerciser.rs' },
      },
    )
    const bad = path.join(dir, 'bad.mjs')
    writeFileSync(bad, 'export const x = 1\n')
    await assert.rejects(loadEngineJobBuilder(bad), /does not export buildEngineJob/)
    // A parity market is resolved: a 21 §13 short-circuit is an error (R14).
    await assert.rejects(
      engineJobFor(buildEngineJob, native, '/d', { tracePath: '/t', traceLevel: 'feeds' }),
      /short-circuited \(no_slug/,
    )
  })

  it('--rust-only refuses a reused native job whose ModelConfig, feeds or read mode differ from the cell', () => {
    // spec: 60 VP-2, HR-7 (the manifest identifies the evidence); R14
    const tsJob = {
      strategyId: 'feed-exerciser',
      slug: 'btc-updown-15m-1776556800',
      filePath: '/d/events/x.parquet',
      gammaPriceToBeat: { priceToBeat: 84000, syncedAtMs: 1 },
    } as unknown as MarketJobData
    const n = nativeJobFor(tsJob, cell, {
      conditionId: '0xabc',
      bytes: 123,
      requiredFeeds: feeds,
      asOfMs: 1_791_500_000_000,
    })
    const current = { modelConfigSha256: modelConfigSha256(cell.modelConfig), requiredFeeds: feeds }
    assert.deepEqual(rustOnlyJobProblems(n, cell, current), [])
    const edited = {
      ...n,
      modelConfig: {
        ...n.modelConfig,
        capital: { ...n.modelConfig.capital, startingCapitalUsdc: '600' },
      },
    }
    assert.match(rustOnlyJobProblems(edited, cell, current).join(), /modelConfigSha256/)
    assert.match(
      rustOnlyJobProblems(n, cell, { ...current, requiredFeeds: null }).join(),
      /requiredFeeds/,
    )
    assert.match(rustOnlyJobProblems({ ...n, readFrom: 'r2' }, cell, current).join(), /readFrom/)
  })
})
