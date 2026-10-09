import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { HostFacts } from './hostFacts.js'
import {
  checkDeterminism,
  renderMarkdown,
  summarizeRuns,
  type BenchReport,
  type MarketRecord,
  type RunRecord,
} from './report.js'
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

const market = (idx: number, det: string, cross = det): MarketRecord => ({
  idx,
  slug: `btc-updown-15m-${1780925400 + idx * 900}`,
  exitCode: 0,
  status: 'ok',
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
})

const run = (
  order: number,
  bin: string,
  rep: number,
  digest: string,
  markets: MarketRecord[],
  wallMs = 1000,
): RunRecord => ({
  order,
  bin,
  rep,
  warmup: rep === 0,
  startedAt: '2026-10-09T12:00:00.000Z',
  metrics: runMetrics(
    wallMs,
    markets.map((m) => m.usage),
    10,
  ),
  loadBefore: [3.5, 3.6, 3.7],
  loadAfter: [4.1, 3.8, 3.7],
  digest,
  crossDigest: `x${digest}`,
  failedMarkets: 0,
  inputPaths: { v1: markets.length },
  markets,
})

describe('checkDeterminism (16 §13.7)', () => {
  it('passes when every run agrees', () => {
    const ms = [market(0, 'a'), market(1, 'b')]
    const runs = [run(1, 'A', 0, 'd', ms), run(2, 'A', 1, 'd', ms), run(3, 'A', 2, 'd', ms)]
    const v = checkDeterminism(runs)
    assert.equal(v.ok, true)
    assert.deepEqual(v.perBinary, { A: ['d'] })
    assert.deepEqual(v.differingMarkets, [])
  })

  it('names the market that differs between repetitions', () => {
    const runs = [
      run(1, 'A', 1, 'd1', [market(0, 'a'), market(1, 'b')]),
      run(2, 'A', 2, 'd2', [market(0, 'a'), market(1, 'c')]),
    ]
    const v = checkDeterminism(runs)
    assert.equal(v.ok, false)
    assert.deepEqual(
      v.differingMarkets.map((m) => m.idx),
      [1],
    )
  })

  it('compares two binaries on the cross-binary section only', () => {
    const a = [market(0, 'a1', 'x'), market(1, 'b1', 'y')]
    const b = [market(0, 'a2', 'x'), market(1, 'b2', 'y')]
    const same = { ...run(2, 'B', 1, 'dB', b), crossDigest: 'xdA' }
    assert.equal(checkDeterminism([run(1, 'A', 1, 'dA', a), same]).ok, true)
    const diff = {
      ...run(2, 'B', 1, 'dB', [market(0, 'a2', 'x'), market(1, 'b2', 'z')]),
      crossDigest: 'other',
    }
    const v = checkDeterminism([run(1, 'A', 1, 'dA', a), diff])
    assert.equal(v.ok, false)
    assert.deepEqual(
      v.differingMarkets.map((m) => m.idx),
      [1],
    )
  })
})

describe('summarizeRuns and renderMarkdown', () => {
  const ms = [market(0, 'a'), market(1, 'b')]
  const runs = [
    run(1, 'A', 0, 'd', ms, 5000),
    run(2, 'A', 1, 'd', ms, 1000),
    run(3, 'A', 2, 'd', ms, 2000),
    run(4, 'A', 3, 'd', ms, 4000),
  ]

  it('summarizes measured runs only (warm-up excluded)', () => {
    const [s] = summarizeRuns(runs)
    assert.equal(s?.bin, 'A')
    assert.deepEqual(s?.wallMs, { n: 3, median: 2000, min: 1000, max: 4000 })
    assert.equal(s?.marketsPerS.median, 1)
  })

  it('renders the conditions, the non-idle label and every repetition', () => {
    const report: BenchReport = {
      schemaVersion: 1,
      level: 'L1',
      generatedAt: '2026-10-09T12:00:00.000Z',
      set: {
        name: 'smoke-50',
        path: 'native/bench/sets/smoke-50.json',
        sha256: 'f'.repeat(64),
        markets: 2,
      },
      host: HOST,
      conditions: {
        label: 'non-idle',
        reasons: ['quiet host not confirmed (fleet worker and Global Runtime not paused)'],
        quietHostConfirmed: false,
        fleetProcessCount: 4,
        preStartLoad1: [],
        loadDuring: { n: 2, median: 3.9, min: 3.5, max: 4.3 },
        loadSamples: [],
        psTop: [],
        startedAtLocal: '2026-10-09 14:00:00',
      },
      config: {
        concurrency: 8,
        reps: 3,
        qos: 'utility',
        qosMechanism: 'taskpolicy -c utility per process; effective class not read back',
        profile: 'artifact (declared)',
        cacheBudget: 'none (process per job)',
        inputPaths: { v1: 6 },
        strategyId: 'engine-exerciser',
        modelConfigSha256: 'e'.repeat(64),
        modelConfig: {},
        jobsDir: '/tmp/jobs',
        wrapper: '/usr/bin/time -l -o <file> /usr/sbin/taskpolicy -c utility',
      },
      binaries: [{ label: 'A', path: '/x/bin', sha256: 'c'.repeat(64), canonical: false }],
      runs,
      summary: summarizeRuns(runs),
      determinism: checkDeterminism(runs),
    }
    const md = renderMarkdown(report)
    assert.match(md, /^# L1 benchmark: smoke-50 on worker-1 \(2026-10-09\)/)
    assert.match(md, /\*\*`non-idle`\*\*/)
    assert.match(md, /- quiet host not confirmed/)
    assert.match(md, /Apple M4, 4P \+ 6E \(10 logical\), 16 GiB/)
    assert.match(md, /T \(concurrent `run` processes\): 8/)
    assert.match(md, /\(\*\*not canonical\*\*\)/)
    assert.match(md, /\| A \| 2\.000 \(1\.000–4\.000\) \| 1\.00 \(0\.50–2\.00\) \|/)
    assert.match(md, /\| 1 \| A \| warm-up \| 5\.000 \|/)
    assert.match(md, /Load average \(1 min\) during the run: 3\.90 \(3\.50–4\.30\)/)
    assert.match(md, /OK: every run/)
    assert.match(md, /Input path: v1 6/)
  })
})
