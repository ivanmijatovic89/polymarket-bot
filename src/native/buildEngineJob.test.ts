/**
 * `buildEngineJob` tests (21 §4, §5, §9, §13; 40 §6.1).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  CANDIDATE_KEY_RE,
  NATIVE_SHIM_VERSION,
  absolutizeJobPaths,
  buildEngineJob,
  candidateKeyOf,
  defaultBudget,
  minShimVersionFor,
  resolveUnderDataRoot,
  verifyJobFiles,
  type BuildEngineJobOptions,
  type NativeMarketJobData,
} from './buildEngineJob.js'
import type { EngineJob } from './contract/generated.js'
import { NativeError } from './errors.js'
import {
  INPUT_BYTES,
  INPUT_REL,
  SLUG,
  makeDataRoot,
  nativeJob,
  scratchDir,
  writeBytes,
} from './testSupport.js'

const quiet: BuildEngineJobOptions = { log: () => {} }

async function built(
  job: NativeMarketJobData,
  dataRoot: string,
  opts: BuildEngineJobOptions = quiet,
): Promise<EngineJob> {
  const b = await buildEngineJob(job, { dataRoot }, opts)
  assert.equal(b.kind, 'job')
  return b.job
}

async function failure(p: Promise<unknown>): Promise<NativeError['info']> {
  try {
    await p
  } catch (err) {
    assert.ok(err instanceof NativeError, String(err))
    return err.info
  }
  assert.fail('expected a NativeError')
}

describe('buildEngineJob: the EngineJob (21 §5, §9)', () => {
  it('builds a schema-valid job with verified local input and feed day files', async () => {
    // spec: 21 §5 (job shape), §5.1 field rules, §9 steps 1-3; 14 §4.1, §5.1
    const root = makeDataRoot()
    const job = await built(nativeJob(), root)
    assert.equal(job.jobSchemaVersion, 1)
    assert.equal(job.run.strategyId, 'feed-exerciser.rs')
    assert.equal(job.run.inputMode, 'telonex-delta')
    assert.deepEqual(job.run.candidates, [
      { key: 'sub-1', index: 0, params: { trade: false }, execution: null },
    ])
    assert.equal(job.market.slug, SLUG)
    assert.equal(job.market.conditionId, '0xabc')
    assert.deepEqual(job.market.window, { startMs: 1_776_556_800_000, endMs: 1_776_557_700_000 })
    assert.deepEqual(job.market.tokenIds, { UP: '111', DOWN: '222' })
    assert.equal(job.market.outcome, 'UP')
    assert.deepEqual(job.market.rules, {
      snapshotParserVersion: null,
      captured: {},
      disagreements: 0,
    })
    assert.deepEqual(job.market.gammaPriceToBeat, {
      priceToBeat: 84123.45,
      syncedAtMs: 1_776_600_000_000,
    })
    assert.deepEqual(job.market.feedAvailability, { priceToBeat: { status: 'fed' } })
    assert.deepEqual(job.market.input, {
      path: path.join(root, INPUT_REL.slice('data/'.length)),
      bytes: INPUT_BYTES,
      sha256: null,
      format: { name: 'telonex-delta-typed', version: 1 },
    })
    assert.deepEqual(
      job.market.feedFiles.map((f) => [f.feed, f.symbol, f.day, f.bytes]),
      [
        ['binance_agg_trades', 'BTCUSDT', '2026-04-18', 100],
        ['binance_agg_trades', 'BTCUSDT', '2026-04-19', 100],
        ['chainlink_crypto_prices', 'btcusd', '2026-04-18', 200],
        ['chainlink_crypto_prices', 'btcusd', '2026-04-19', 200],
      ],
    )
    assert.ok(job.market.feedFiles.every((f) => path.isAbsolute(f.path) && existsSync(f.path)))
    assert.equal(job.market.recorderV4, null)
    assert.equal(job.market.journal, null)
    assert.equal(job.market.ownActivity, null)
    assert.deepEqual(job.outputs, { tracePath: null, traceLevel: 'decisions', ledgerPath: null })
    assert.deepEqual(job.budget, { wallMs: 125_000, threads: 1 })
  })

  it('never carries producer-only fields to the binary', async () => {
    // spec: 21 §2 (batchUid, commitSha, idx, order, timeDriven, marketMeta never reach the binary)
    const text = JSON.stringify(await built(nativeJob(), makeDataRoot()))
    for (const k of [
      'batchUid',
      'commitSha',
      '"idx"',
      'timeDriven',
      'marketMeta',
      'asOfMs',
      'requiredFeeds',
    ]) {
      assert.ok(!text.includes(k), k)
    }
  })

  it('omits feeds the strategy does not request (tri-state price-to-beat)', async () => {
    // spec: 21 §5.1 gammaPriceToBeat tri-state; 14 §6.2; 21 §9 step 3
    const root = makeDataRoot({ days: false })
    const noFeeds = nativeJob({}, { requiredFeeds: null })
    delete noFeeds.gammaPriceToBeat
    const job = await built(noFeeds, root)
    assert.ok(!('gammaPriceToBeat' in job.market))
    assert.deepEqual(job.market.feedAvailability, { priceToBeat: null })
    assert.deepEqual(job.market.feedFiles, [])
  })

  it('applies outputs and budget overrides without touching semantics', async () => {
    // spec: 21 §5 (outputs and budget are non-semantic), 40 §8.2 item 1 default
    const job = await built(nativeJob(), makeDataRoot(), {
      ...quiet,
      outputs: { tracePath: '/t/a.jsonl.gz', traceLevel: 'feeds' },
      budget: { wallMs: 5000, threads: 2 },
    })
    assert.deepEqual(job.outputs, {
      tracePath: '/t/a.jsonl.gz',
      traceLevel: 'feeds',
      ledgerPath: null,
    })
    assert.deepEqual(job.budget, { wallMs: 5000, threads: 2 })
    assert.deepEqual(defaultBudget(3), { wallMs: 135_000, threads: 1 })
  })
})

describe('buildEngineJob: short-circuits (21 §13)', () => {
  it('decides no_slug, no_resolution and unresolved_outcome without a spawn', async () => {
    // spec: 21 §13 rows "slug missing", "marketResolution null", "outcome null"
    const root = makeDataRoot({ input: false, days: false })
    const cases: Array<[Partial<NativeMarketJobData>, string]> = [
      [{ slug: null }, 'no_slug'],
      [{ marketResolution: null }, 'no_resolution'],
      [
        { marketResolution: { tokenMap: { UP: '1', DOWN: '2' }, outcome: null } },
        'unresolved_outcome',
      ],
    ]
    for (const [over, reason] of cases) {
      const b = await buildEngineJob({ ...nativeJob(), ...over }, { dataRoot: root }, quiet)
      assert.equal(b.kind, 'short_circuit', reason)
      if (b.kind === 'short_circuit') assert.equal(b.skipReason, reason)
    }
  })
})

describe('buildEngineJob: input resolution and integrity (21 §9, 40 §6.1)', () => {
  it('fails a missing local input as data_missing: input_missing with the fix command', async () => {
    // spec: 21 §5.1 input path (data_missing: input_missing); 20 §4 fix command
    const info = await failure(
      buildEngineJob(nativeJob(), { dataRoot: makeDataRoot({ input: false }) }, quiet),
    )
    assert.equal(info.class, 'data_missing')
    assert.equal(info.cause, 'input_missing')
    assert.match(info.detail?.fixCommand ?? '', /telonex:download-converted-r2-to-local/)
  })

  it('fails a local copy of the wrong size or sha256 as data_missing: integrity_mismatch', async () => {
    // spec: 21 §9 step 2 (--read-from local cannot re-download); 40 §6.1 item 3
    const root = makeDataRoot()
    const wrongSize = nativeJob({}, { input: { ...nativeJob().input, bytes: INPUT_BYTES + 1 } })
    const a = await failure(buildEngineJob(wrongSize, { dataRoot: root }, quiet))
    assert.deepEqual([a.class, a.cause], ['data_missing', 'integrity_mismatch'])
    const wrongSha = nativeJob({}, { input: { ...nativeJob().input, sha256: '0'.repeat(64) } })
    const b = await failure(buildEngineJob(wrongSha, { dataRoot: root }, quiet))
    assert.deepEqual([b.class, b.cause], ['data_missing', 'integrity_mismatch'])
    const sha = createHash('sha256').update(Buffer.alloc(INPUT_BYTES, 7)).digest('hex')
    const right = nativeJob({}, { input: { ...nativeJob().input, sha256: sha } })
    assert.equal((await built(right, root)).market.input.sha256, sha)
  })

  it('downloads a missing input once and re-downloads a bad copy after quarantine', async () => {
    // spec: 21 §9 steps 1-2; 40 §6.1 items 1 and 3 (quarantine, one re-download)
    const root = makeDataRoot({ input: false })
    const calls: Array<[string, string, number]> = []
    const lines: string[] = []
    const download = async (url: string, to: string, bytes: number) => {
      calls.push([url, to, bytes])
      writeBytes(to, bytes)
    }
    const job = nativeJob({}, { readFrom: 'local-or-download-from-r2-to-local' })
    const first = await built(job, root, { download, log: (l) => lines.push(l) })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]![1], first.market.input.path)
    assert.equal(calls[0]![2], INPUT_BYTES)
    assert.ok(lines.some((l) => l.startsWith('[read-from] R2 download')))
    await built(job, root, { download, log: (l) => lines.push(l) })
    assert.equal(calls.length, 1, 'a present good copy is a LOCAL hit')
    assert.ok(lines.some((l) => l.startsWith('[read-from] LOCAL hit')))
    writeFileSync(first.market.input.path, Buffer.alloc(10))
    await built(job, root, { download, log: () => {} })
    assert.equal(calls.length, 2)
    const dir = path.dirname(first.market.input.path)
    assert.ok(
      readdirSync(dir).some((f) => f.includes('.bad-')),
      'bad copy quarantined',
    )
  })

  it('classifies a bad fresh download as data_defect and a failed one as runtime', async () => {
    // spec: 21 §9 step 2 (fresh copy fails: data_defect: integrity_mismatch); 20 §4 runtime r2_download
    const job = nativeJob({}, { readFrom: 'local-or-download-from-r2-to-local' })
    const short = async (_u: string, to: string) => writeBytes(to, 3)
    const a = await failure(
      buildEngineJob(
        job,
        { dataRoot: makeDataRoot({ input: false }) },
        { download: short, log: () => {} },
      ),
    )
    assert.deepEqual([a.class, a.cause], ['data_defect', 'integrity_mismatch'])
    const broken = async () => {
      throw new Error('503')
    }
    const b = await failure(
      buildEngineJob(
        job,
        { dataRoot: makeDataRoot({ input: false }) },
        { download: broken, log: () => {} },
      ),
    )
    assert.deepEqual([b.class, b.cause], ['runtime', 'r2_download'])
  })

  it('reads --read-from r2 through a per-job temp file removed by cleanup', async () => {
    // spec: 21 §9 step 1 (r2: job temp dir, deleted afterwards); 40 §6.1 item 1
    const tempRoot = scratchDir('tmp')
    const job = nativeJob({}, { readFrom: 'r2' })
    const b = await buildEngineJob(
      job,
      { dataRoot: makeDataRoot({ input: false }) },
      {
        tempRoot,
        download: async (_u, to, bytes) => writeBytes(to, bytes),
        log: () => {},
      },
    )
    assert.equal(b.kind, 'job')
    if (b.kind !== 'job') return
    assert.ok(b.job.market.input.path.startsWith(tempRoot))
    assert.ok(existsSync(b.job.market.input.path))
    await b.cleanup()
    assert.ok(!existsSync(b.job.market.input.path))
    assert.deepEqual(readdirSync(tempRoot), [])
  })

  it('fails a missing feed day file before spawn with the R2-to-local command', async () => {
    // spec: 21 §9 step 3 (data_missing: day_file_missing, message names the command); 40 §6.1 item 4
    const info = await failure(
      buildEngineJob(nativeJob(), { dataRoot: makeDataRoot({ days: false }) }, quiet),
    )
    assert.deepEqual([info.class, info.cause], ['data_missing', 'day_file_missing'])
    assert.match(info.message, /binance:download-aggtrades-r2-to-local -- --pair BTCUSDT/)
  })

  it('resolves canonical paths only under the data root', () => {
    // spec: 00 §5 data roots; 20 G3 (no r2:// or relative paths reach the binary)
    assert.equal(resolveUnderDataRoot('data/events/x.parquet', '/root'), '/root/events/x.parquet')
    assert.equal(resolveUnderDataRoot('/abs/x.parquet', '/root'), '/abs/x.parquet')
    assert.throws(() => resolveUnderDataRoot('r2://b/k', '/root'), /R2/)
    assert.throws(() => resolveUnderDataRoot('events/x.parquet', '/root'))
    assert.throws(() => resolveUnderDataRoot('data/../x', '/root'))
  })
})

describe('buildEngineJob: native MarketJobData invariants (21 §4, §5.1, §8)', () => {
  const root = makeDataRoot()
  const cases: Array<[string, NativeMarketJobData, string]> = [
    ['legacy latency', nativeJob({ latency: { delayMs: 140, jitterMs: 0 } }), 'model_config'],
    ['legacy capital', nativeJob({ startingCapital: 250 }), 'model_config'],
    [
      'missing capital',
      { ...nativeJob(), startingCapital: undefined } as unknown as NativeMarketJobData,
      'model_config',
    ],
    ['exchange_time order', nativeJob({ order: 'exchange_time' }), 'flag'],
    ['time-driven', nativeJob({ timeDriven: true }), 'flag'],
    ['recorder-v4', nativeJob({ inputMode: 'recorder-v4' }), 'input_mode'],
    ['telonex-paired', nativeJob({ inputMode: 'telonex-paired' }), 'input_mode'],
    [
      'nativeProfile',
      { ...nativeJob(), nativeProfile: 'ts-compat' } as NativeMarketJobData,
      'schema',
    ],
    ['eth slug', nativeJob({ slug: 'eth-updown-15m-1776556800', strategyWindow: null }), 'market'],
    ['window mismatch', nativeJob({ strategyWindow: { startMs: 1, endMs: 2 } }), 'window'],
    [
      'same token ids',
      nativeJob({ marketResolution: { tokenMap: { UP: '1', DOWN: '1' }, outcome: 'UP' } }),
      'market',
    ],
    [
      'ptb not resolved',
      { ...nativeJob(), feedAvailability: { priceToBeat: null } },
      'feed_availability',
    ],
    [
      'ptb without request',
      nativeJob({}, { requiredFeeds: { binanceWsSpotPrice: {} } }),
      'feed_availability',
    ],
    [
      'bad model config',
      nativeJob({}, { modelConfig: { ...nativeJob().modelConfig, seed: -1 } }),
      'model_config',
    ],
    ['ledger', { ...nativeJob(), ledger: true }, 'flag'],
    // 21 §4 gate fields (40 §4.1)
    [
      'missing native gate',
      { ...nativeJob(), native: undefined } as unknown as NativeMarketJobData,
      'schema',
    ],
    [
      'foreign protocol',
      { ...nativeJob(), native: { ...nativeJob().native, protocolVersion: 3 } },
      'version',
    ],
    [
      'unknown priority class',
      {
        ...nativeJob(),
        native: { ...nativeJob().native, priorityClass: 'urgent' },
      } as unknown as NativeMarketJobData,
      'schema',
    ],
    [
      'missing strategyArtifact',
      { ...nativeJob(), strategyArtifact: undefined } as unknown as NativeMarketJobData,
      'schema',
    ],
    [
      'non-native artifact',
      {
        ...nativeJob(),
        strategyArtifact: { ...nativeJob().strategyArtifact, kind: 'js' },
      } as unknown as NativeMarketJobData,
      'schema',
    ],
    [
      'artifact without target',
      { ...nativeJob(), strategyArtifact: { ...nativeJob().strategyArtifact, target: '' } },
      'schema',
    ],
  ]
  for (const [name, job, cause] of cases) {
    it(`refuses ${name} as invalid_input: ${cause}`, async () => {
      // spec: 21 §4 (legacy fields asserted; order recorded; nativeProfile absent), §5.1 table, 14 §6.2, R14
      const info = await failure(buildEngineJob(job, { dataRoot: root }, quiet))
      assert.deepEqual([info.class, info.cause], ['invalid_input', cause])
    })
  }

  it('checks candidate keys, indices and ts-compat variants', async () => {
    // spec: 21 §8 C1 (unique keys, indices 0..N-1), C2 (duplicates), C4 (ts-compat cannot vary)
    const c = (key: string, index: number, params: Record<string, unknown> = {}) => ({
      key,
      index,
      params,
      execution: null,
    })
    const ok = await built(
      nativeJob({}, { candidates: [c('a', 0, { x: 1 }), c('b', 1, { x: 2 })] }),
      root,
    )
    assert.deepEqual(
      ok.run.candidates.map((x) => x.key),
      ['a', 'b'],
    )
    assert.equal(ok.budget.wallMs, 130_000)
    const bad: Array<NativeMarketJobData['candidates']> = [
      [],
      [c('a', 1)],
      [c('a', 0, { x: 1 }), c('a', 1, { x: 2 })],
      [c('a', 0, { x: 1, y: 2 }), c('b', 1, { y: 2, x: 1 })],
      [{ ...c('a', 0), execution: nativeJob().modelConfig.execution }],
      // C1 key pattern, checked before the schema so TS and Rust agree on the cause (21 §5.1)
      [c('a/b', 0)],
    ]
    for (const candidates of bad) {
      const info = await failure(
        buildEngineJob(nativeJob({}, { candidates: candidates! }), { dataRoot: root }, quiet),
      )
      assert.deepEqual(
        [info.class, info.cause],
        ['invalid_input', 'params'],
        JSON.stringify(candidates),
      )
    }
  })
})

describe('fixture job rendering (60 §12 FX-1a)', () => {
  it('absolutizes fixture-relative paths and verifies the files', async () => {
    // spec: 60 §12 FX-1a; 21 §5.1 (absolute, local, existing paths); 21 §9 steps 2-3
    const root = makeDataRoot()
    const job = await built(nativeJob(), root)
    const rel: EngineJob = {
      ...job,
      market: {
        ...job.market,
        input: { ...job.market.input, path: path.relative(root, job.market.input.path) },
        feedFiles: job.market.feedFiles.map((f) => ({ ...f, path: path.relative(root, f.path) })),
      },
    }
    const abs = absolutizeJobPaths(rel, root)
    assert.deepEqual(abs, job)
    await verifyJobFiles(abs)
    writeFileSync(abs.market.feedFiles[0]!.path, Buffer.alloc(1))
    const info = await failure(verifyJobFiles(abs))
    assert.deepEqual([info.class, info.cause], ['data_missing', 'integrity_mismatch'])
    assert.equal(readFileSync(abs.market.input.path).length, INPUT_BYTES)
  })
})

describe('single-candidate key (21 §4, §8 C1)', () => {
  it('keys the candidate by submissionUid when it fits the key pattern, else by its sha256', async () => {
    // spec: 21 §4 ("key = submissionUid"), §8 C1; pmb-contract CANDIDATE_KEY_PATTERN
    const root = makeDataRoot()
    const plain = await built(nativeJob({ submissionUid: '3f6c1b9e-6a8f-4f8e' }), root)
    assert.equal(plain.run.candidates[0]!.key, '3f6c1b9e-6a8f-4f8e')
    // A labelled run: `<label>--<uuid>` with spaces, a colon and a slash, 219 characters.
    const uid = `${'nightly sweep: lagsnipe/v15 '.repeat(7).slice(0, 180)}--3f6c1b9e-6a8f-4f8e-9a51-2d1f0c7e5b10`
    assert.equal(CANDIDATE_KEY_RE.test(uid), false)
    const key = candidateKeyOf(uid)
    assert.match(key, /^sub-[0-9a-f]{40}$/)
    assert.equal(key, candidateKeyOf(uid))
    assert.notEqual(key, candidateKeyOf(`${uid}x`))
    const labelled = await built(nativeJob({ submissionUid: uid }), root)
    assert.equal(labelled.run.candidates[0]!.key, key)
  })
})

describe('native gate fields (21 §4, 40 §4.1, §4.2 step 2)', () => {
  it('minShimVersion comes from the (protocol, jobSchema) table; unknown pairs are refused', () => {
    // spec: 40 §4.2 step 2 (compatibility table, not the producer's own shim version)
    assert.equal(minShimVersionFor(2, 1), 1)
    assert.ok(minShimVersionFor(2, 1) <= NATIVE_SHIM_VERSION)
    assert.throws(() => minShimVersionFor(3, 1), /artifact_incompatible/)
    const n = nativeJob()
    assert.deepEqual(n.native, {
      protocolVersion: 2,
      minShimVersion: 1,
      priorityClass: 'user',
      producerDirty: false,
    })
    assert.equal(n.strategyArtifact.kind, 'native')
  })
})
