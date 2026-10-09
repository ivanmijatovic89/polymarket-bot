import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { parseJsonPreserving } from './canonicalJson.js'
import type { HostFacts } from './hostFacts.js'
import {
  checkDeterminism,
  marketDiagnostics,
  rowFailures,
  runDiagnostics,
  summarizeRuns,
  type ArmInfo,
  type L1Row,
  type MarketRecord,
  type RunRecord,
} from './report.js'
import { appendRow, loadReport, reportBase, ReportFileError } from './reportFile.js'
import { runMetrics } from './stats.js'

const HOST: HostFacts = {
  host: 'worker-1',
  hostname: 'Worker-1s-Mac-mini.local',
  chip: 'Apple M4',
  model: 'Mac16,10',
  perfLevels: [
    {
      level: 0,
      name: 'Performance',
      physicalCpu: 4,
      logicalCpu: 4,
      l1iBytes: 1,
      l1dBytes: 1,
      l2Bytes: 1,
      cpusPerL2: 4,
    },
    {
      level: 1,
      name: 'Efficiency',
      physicalCpu: 6,
      logicalCpu: 6,
      l1iBytes: 1,
      l1dBytes: 1,
      l2Bytes: 1,
      cpusPerL2: 6,
    },
  ],
  logicalCpu: 10,
  physicalCpu: 10,
  memBytes: 17179869184,
  cacheLineBytes: 128,
  pageBytes: 16384,
  macos: { productVersion: '26.2', build: '25C56' },
  rustc: 'rustc 1.89.0',
  cargo: 'cargo 1.89.0',
  node: '20.20.2',
  powerSource: 'AC Power',
  lowPowerMode: false,
}

const NO_DIAG = {
  cacheHits: null,
  cacheMisses: null,
  strategyTicksSkipped: null,
  phases: null,
  bytesDecoded: null,
}

const market = (idx: number, det: string, cross = det, ok = true): MarketRecord => ({
  idx,
  slug: `btc-updown-15m-${1780925400 + idx * 900}`,
  exitCode: ok ? 0 : 5,
  status: ok ? 'ok' : 'error',
  candidateStatus: ok ? 'ok' : null,
  errorClass: ok ? null : 'invalid_input',
  ok,
  wallMs: 100,
  usage: {
    realMs: 100,
    userMs: 90,
    sysMs: 5,
    maxRssBytes: 40 << 20,
    peakFootprintBytes: null,
    instructions: null,
    cycles: null,
  },
  detSha256: det,
  crossSha256: cross,
  inputPath: 'v1',
  diagnostics: NO_DIAG,
})

const run = (
  order: number,
  arm: string,
  rep: number,
  digest: string,
  markets: MarketRecord[],
  wallMs = 1000,
  crossDigest = `x${digest}`,
): RunRecord => ({
  order,
  arm,
  rep,
  warmup: rep === 0,
  startedAt: '2026-10-09T12:00:00.000Z',
  metrics: runMetrics(
    wallMs,
    markets.map((m) => ({ usage: m.usage, ok: m.ok, candidates: 1 })),
    10,
  ),
  loadBefore: [3.5, 3.6, 3.7],
  loadAfter: [4.1, 3.8, 3.7],
  digest,
  crossDigest,
  inputPaths: { v1: markets.length },
  diagnostics: runDiagnostics(markets),
  markets,
})

describe('checkDeterminism (16 §13.7)', () => {
  it('passes when every run agrees', () => {
    const ms = [market(0, 'a'), market(1, 'b')]
    const runs = [run(1, 'A', 0, 'd', ms), run(2, 'A', 1, 'd', ms), run(3, 'A', 2, 'd', ms)]
    const v = checkDeterminism(runs, { A: 'sha1' })
    assert.equal(v.ok, true)
    assert.equal(v.crossArmForm, 'full')
    assert.deepEqual(v.fullPerBinary, { sha1: ['d'] })
    assert.deepEqual(v.differingMarkets, [])
  })

  it('names the market that differs between repetitions', () => {
    const runs = [
      run(1, 'A', 1, 'd1', [market(0, 'a'), market(1, 'b')]),
      run(2, 'A', 2, 'd2', [market(0, 'a'), market(1, 'c')]),
    ]
    const v = checkDeterminism(runs, { A: 'sha1' })
    assert.equal(v.ok, false)
    assert.deepEqual(
      v.differingMarkets.map((m) => m.idx),
      [1],
    )
  })

  it('requires one full digest across arms of the same binary (T, QoS, tape dir)', () => {
    const ms = [market(0, 'a'), market(1, 'b')]
    const ms2 = [market(0, 'a'), market(1, 'z', 'b')]
    const v = checkDeterminism(
      [run(1, 'A', 1, 'd', ms, 1000, 'x'), run(2, 'B', 1, 'e', ms2, 1000, 'x')],
      {
        A: 'sha1',
        B: 'sha1',
      },
    )
    assert.equal(v.ok, false)
    assert.deepEqual(
      v.differingMarkets.map((m) => m.idx),
      [1],
    )
  })

  it('compares two binaries on the reduced section and reports both forms', () => {
    const a = [market(0, 'a1', 'x'), market(1, 'b1', 'y')]
    const b = [market(0, 'a2', 'x'), market(1, 'b2', 'y')]
    const ok = checkDeterminism(
      [run(1, 'A', 1, 'dA', a, 1000, 'r'), run(2, 'B', 1, 'dB', b, 1000, 'r')],
      { A: 'sha1', B: 'sha2' },
    )
    assert.equal(ok.ok, true)
    assert.equal(ok.crossArmForm, 'reduced')
    assert.deepEqual(ok.fullAcrossArms, ['dA', 'dB'])
    assert.deepEqual(ok.reducedAcrossArms, ['r'])
    const diff = checkDeterminism(
      [
        run(1, 'A', 1, 'dA', a, 1000, 'r'),
        run(2, 'B', 1, 'dB', [market(0, 'a2', 'x'), market(1, 'b2', 'z')], 1000, 'other'),
      ],
      { A: 'sha1', B: 'sha2' },
    )
    assert.equal(diff.ok, false)
    assert.deepEqual(
      diff.differingMarkets.map((m) => m.idx),
      [1],
    )
  })
})

describe('failures (R14, 20 §5.4)', () => {
  it('counts failed markets out of throughput and fails the row', () => {
    const ms = [market(0, 'a'), market(1, 'b', 'b', false)]
    const runs = [run(1, 'A', 0, 'd', ms), run(2, 'A', 1, 'd', ms)]
    const [s] = summarizeRuns(runs)
    assert.equal(s?.failedMarkets, 2)
    assert.equal(s?.marketsPerS.median, 1)
    const reasons = rowFailures(runs, checkDeterminism(runs, { A: 'sha' }))
    assert.equal(reasons.length, 1)
    assert.match(reasons[0]!, /2 failed market run\(s\), e\.g\. .*invalid_input/)
  })
})

describe('marketDiagnostics (21 §10)', () => {
  it('reads cache, strategyTicksSkipped and phases when present', () => {
    const root = parseJsonPreserving(
      JSON.stringify({
        status: 'ok',
        diagnostics: {
          cache: { hits: 2, misses: 1 },
          counters: [{ strategyTicksSkipped: 4 }, { strategyTicksSkipped: 1 }],
          phases: { decode: 12.5, strategy: 3 },
        },
      }),
    )
    assert.deepEqual(marketDiagnostics(root), {
      cacheHits: 2,
      cacheMisses: 1,
      strategyTicksSkipped: 5,
      phases: { decode: 12.5, strategy: 3 },
      bytesDecoded: null,
    })
    assert.deepEqual(marketDiagnostics(parseJsonPreserving('{"diagnostics":{}}')), NO_DIAG)
  })
})

const ARM: ArmInfo = {
  label: 'A',
  binary: {
    path: '/x/bin',
    sha256: 'c'.repeat(64),
    canonical: false,
    canonicalReasons: ['not data/strategy-artifacts/native/<its sha256>'],
    buildManifestSha256: null,
    describe: null,
  },
  concurrency: 8,
  qos: 'utility',
  effectiveQos: { className: 'utility', raw: 0x11, method: 'probe' },
  tapeDir: null,
  runArgs: [],
  cacheBudget: 'none (process per job)',
}

function row(runs: RunRecord[]): L1Row {
  const determinism = checkDeterminism(runs, { A: ARM.binary.sha256 })
  const failureReasons = rowFailures(runs, determinism)
  return {
    level: 'L1',
    generatedAt: '2026-10-09T12:00:00.000Z',
    set: {
      name: 'smoke-50',
      path: 'native/bench/sets/smoke-50.json',
      sha256: 'f'.repeat(64),
      inputMode: 'telonex-delta',
      strategy: { id: 'engine-exerciser.v2.rs', params: {} },
      modelConfigSha256: 'e'.repeat(64),
      modelConfig: {},
      markets: [],
    },
    dataRoot: '/repo/data',
    jobsDir: '/tmp/jobs',
    host: HOST,
    conditions: {
      label: 'non-idle',
      reasons: ['quiet host not confirmed (fleet worker and Global Runtime not paused)'],
      quietHostConfirmed: false,
      psChecks: [
        {
          tMs: 0,
          phase: 'start',
          work: [
            { pid: 7, kind: 'fleet-worker', args: 'bash ./scripts/run-worker.sh', cwd: '/fleet' },
          ],
        },
      ],
      preStartLoad1: [],
      loadDuring: { n: 2, median: 3.9, min: 3.5, max: 4.3 },
      loadSamples: [],
      services: [
        { name: 'redis-server', pid: 313, cpuMs: 1500, coresAvg: 0.05, pcpuSamples: [2, 4] },
      ],
      psTop: [],
      startedAtLocal: '2026-10-09 14:00:00',
      endedAtLocal: '2026-10-09 14:05:00',
    },
    reps: 3,
    wrapper: '/usr/bin/time -l -o <file>',
    arms: [ARM],
    coldRead: { files: 2, bytes: 2 << 20, elapsedMs: 40, note: 'first read' },
    runs,
    summary: summarizeRuns(runs),
    determinism,
    failed: failureReasons.length > 0,
    failureReasons,
  }
}

describe('report file (16 §13.8)', () => {
  const ms = [market(0, 'a'), market(1, 'b')]
  const runs = [
    run(1, 'A', 0, 'd', ms, 5000),
    run(2, 'A', 1, 'd', ms, 1000),
    run(3, 'A', 2, 'd', ms, 2000),
    run(4, 'A', 3, 'd', ms, 4000),
  ]

  it('summarizes measured runs only (warm-up excluded)', () => {
    const [s] = summarizeRuns(runs)
    assert.equal(s?.arm, 'A')
    assert.deepEqual(s?.wallMs, { n: 3, median: 2000, min: 1000, max: 4000 })
    assert.equal(s?.marketsPerS.median, 1)
  })

  it('names files bench-<milestone>-<date>-<host> and appends rows', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-report-test-'))
    try {
      const meta = { milestone: 'M1', date: '20261009', host: 'worker-1' }
      const base = reportBase(path.join(tmp, 'native/reports'), 'M1', '20261009', 'worker-1')
      assert.ok(base.endsWith('native/reports/bench-M1-20261009-worker-1'))
      assert.throws(() => reportBase(tmp, 'm1', '20261009', 'worker-1'), ReportFileError)
      appendRow(base, meta, row(runs))
      const f = appendRow(
        base,
        meta,
        row([
          ...runs.slice(0, 2),
          run(3, 'A', 2, 'd', [market(0, 'a'), market(1, 'b', 'b', false)]),
        ]),
      )
      assert.equal(f.rows.length, 2)
      assert.equal(loadReport(base, meta).rows.length, 2)
      assert.throws(() => loadReport(base, { ...meta, host: 'worker-2' }), /differ/)
      const md = fs.readFileSync(`${base}.md`, 'utf8')
      assert.match(md, /^# Benchmark report M1: worker-1 \(2026-10-09\)/)
      assert.match(md, /## Row 1: L1 `smoke-50`, A \(2026-10-09 14:00:00 – 14:05:00\)/)
      assert.match(md, /## Row 2: L1/)
      assert.match(md, /\*\*FAILED\*\*: these numbers are not valid evidence/)
      assert.match(md, /\*\*`non-idle`\*\*/)
      assert.match(md, /pid 7 fleet-worker \(cwd \/fleet\)/)
      assert.match(
        md,
        /- ps checks: 1 \(start, 0 during, end\); other work seen in 1\n {2}- fleet-worker: 1 distinct/,
      )
      assert.match(md, /redis-server \(pid 313\): 1\.500 s CPU/)
      assert.match(md, /no: not data\/strategy-artifacts/)
      assert.match(md, /\| A \| 2\.000 \(1\.000–4\.000\) \| 1\.00 \(0\.50–2\.00\) \|/)
      assert.match(md, /\| 1 \| A \| warm-up \| 5\.000 \|/)
      assert.match(md, /Cache .*: not reported/)
      assert.match(md, /verdict uses the full form/)
      assert.match(md, /Input path \(measured runs\): v1 /)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite a Markdown report without its JSON', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-report-test-'))
    try {
      const base = path.join(tmp, 'bench-M1-20261009-worker-1')
      fs.writeFileSync(`${base}.md`, '# old')
      assert.throws(
        () => loadReport(base, { milestone: 'M1', date: '20261009', host: 'worker-1' }),
        /without its \.json/,
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
