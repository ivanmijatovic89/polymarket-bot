import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTimeL, type ChildUsage } from './rusage.js'
import { abbaSchedule, loadSummary, runMetrics, summarize } from './stats.js'

// Captured from `/usr/bin/time -l -o f /usr/bin/true` on worker-1 (macOS 26.2).
const TIME_L = `        0.05 real         0.03 user         0.01 sys
            41123840  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                 201  page reclaims
                   0  page faults
                   0  swaps
                   1  voluntary context switches
                   3  involuntary context switches
             8075410  instructions retired
             2706118  cycles elapsed
              901336  peak memory footprint
`

describe('parseTimeL', () => {
  it('reads times, max RSS and counters', () => {
    assert.deepEqual(parseTimeL(TIME_L), {
      realMs: 50,
      userMs: 30,
      sysMs: 10,
      maxRssBytes: 41123840,
      peakFootprintBytes: 901336,
      instructions: 8075410,
      cycles: 2706118,
    })
  })

  it('tolerates a missing optional counter and rejects a missing RSS', () => {
    const noFootprint = TIME_L.split('\n')
      .filter((l) => !l.includes('peak memory footprint'))
      .join('\n')
    assert.equal(parseTimeL(noFootprint).peakFootprintBytes, null)
    const noRss = TIME_L.split('\n')
      .filter((l) => !l.includes('maximum resident'))
      .join('\n')
    assert.throws(() => parseTimeL(noRss), /maximum resident/)
    assert.throws(() => parseTimeL('Command terminated abnormally.'), /real\/user\/sys/)
  })
})

describe('summarize', () => {
  it('gives median, min and max', () => {
    assert.deepEqual(summarize([3, 1, 2]), { n: 3, median: 2, min: 1, max: 3 })
    assert.deepEqual(summarize([4, 1, 3, 2]), { n: 4, median: 2.5, min: 1, max: 4 })
  })
  it('rejects empty and non-finite input', () => {
    assert.throws(() => summarize([]))
    assert.throws(() => summarize([1, Number.NaN]))
  })
})

describe('abbaSchedule', () => {
  const show = (b: number, r: number): string =>
    abbaSchedule(b, r)
      .map((s) => `${'ABC'[s.arm]}${s.warmup ? 'w' : s.rep}`)
      .join(' ')
  it('one arm: warm-up then repetitions', () => {
    assert.equal(show(1, 3), 'Aw A1 A2 A3')
  })
  it('two arms: warm-ups then ABBA interleaving', () => {
    assert.equal(show(2, 3), 'Aw Bw A1 B1 B2 A2 A3 B3')
    assert.equal(show(2, 4), 'Aw Bw A1 B1 B2 A2 A3 B3 B4 A4')
  })
  it('three arms: forward and reverse in turn', () => {
    assert.equal(show(3, 2), 'Aw Bw Cw A1 B1 C1 C2 B2 A2')
  })
  it('rejects other shapes', () => {
    assert.throws(() => abbaSchedule(0, 3))
    assert.throws(() => abbaSchedule(1, 0))
  })
})

describe('runMetrics', () => {
  const child = (
    realMs: number,
    userMs: number,
    sysMs: number,
    maxRssBytes: number,
  ): ChildUsage => ({
    realMs,
    userMs,
    sysMs,
    maxRssBytes,
    peakFootprintBytes: null,
    instructions: null,
    cycles: null,
  })
  it('derives throughput, CPU utilization and peak RSS (16 §13.4)', () => {
    const ok = (usage: ChildUsage): { usage: ChildUsage; ok: boolean; candidates: number } => ({
      usage,
      ok: true,
      candidates: 1,
    })
    const m = runMetrics(
      2000,
      [ok(child(900, 800, 100, 50)), ok(child(1100, 1000, 100, 70)), ok(child(1000, 900, 100, 60))],
      10,
    )
    assert.equal(m.markets, 3)
    assert.equal(m.okMarkets, 3)
    assert.equal(m.marketsPerS, 1.5)
    assert.equal(m.marketCandidatesPerS, 1.5)
    assert.equal(m.userMs, 2700)
    assert.equal(m.sysMs, 300)
    assert.equal(m.cpuMs, 3000)
    assert.equal(m.cpuUtilization, 3000 / (2000 * 10))
    assert.equal(m.peakRssBytes, 70)
    assert.equal(m.childWallMedianMs, 1000)
  })
  it('counts failed markets out of throughput', () => {
    const m = runMetrics(
      1000,
      [
        { usage: child(10, 5, 1, 1), ok: true, candidates: 1 },
        { usage: child(1, 1, 0, 1), ok: false, candidates: 1 },
      ],
      10,
    )
    assert.equal(m.failedMarkets, 1)
    assert.equal(m.marketsPerS, 1)
  })
  it('rejects empty runs and zero wall time', () => {
    assert.throws(() => runMetrics(1, [], 10))
    assert.throws(() => runMetrics(0, [{ usage: child(1, 1, 1, 1), ok: true, candidates: 1 }], 10))
  })
})

describe('loadSummary', () => {
  it('is null without samples', () => {
    assert.equal(loadSummary([]), null)
    assert.equal(loadSummary([{ tMs: 0, load1: 2 }])?.median, 2)
  })
})
