import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { formatNs, parseCriterionBench, readCriterionHome, summarizeL0, type L0Run } from './l0.js'

const est = (p: number): Record<string, unknown> => ({
  confidence_interval: { confidence_level: 0.95, lower_bound: p - 1, upper_bound: p + 1 },
  point_estimate: p,
  standard_error: 0.1,
})
const BENCH = JSON.stringify({
  group_id: 'book',
  function_id: 'apply_level_top_change',
  value_str: null,
  throughput: { Elements: 1000 },
  full_id: 'book/apply_level_top_change',
  directory_name: 'book/apply_level_top_change',
  title: 'book/apply_level_top_change',
})
const estimates = (median: number): string =>
  JSON.stringify({ mean: est(median + 5), median: est(median) })
const SAMPLE = JSON.stringify({ sampling_mode: 'Flat', iters: [1, 2], times: [100, 210] })
const TARGET = { package: 'pmb-book', bench: 'book' }

describe('criterion results (16 §13.2 L0)', () => {
  it('parses benchmark, estimates and raw samples', () => {
    const r = parseCriterionBench(BENCH, estimates(2000), SAMPLE, 'x')
    assert.equal(r.id, 'book/apply_level_top_change')
    assert.deepEqual(r.throughput, { kind: 'elements', n: 1000 })
    assert.deepEqual(r.median, { point: 2000, lower: 1999, upper: 2001 })
    assert.deepEqual(r.sample, { iters: [1, 2], times: [100, 210] })
    assert.throws(() => parseCriterionBench('{}', estimates(1), SAMPLE, 'x'), /full_id/)
    assert.throws(
      () => parseCriterionBench(BENCH, estimates(1), '{"iters":[1],"times":[]}', 'x'),
      /lengths/,
    )
  })

  it('reads only new/ results under a criterion home', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-l0-test-'))
    try {
      for (const sub of ['new', 'base']) {
        const d = path.join(home, 'book/apply_level_top_change', sub)
        fs.mkdirSync(d, { recursive: true })
        fs.writeFileSync(path.join(d, 'benchmark.json'), BENCH)
        fs.writeFileSync(path.join(d, 'estimates.json'), estimates(sub === 'new' ? 7 : 9))
        fs.writeFileSync(path.join(d, 'sample.json'), SAMPLE)
      }
      const rs = readCriterionHome(home)
      assert.equal(rs.length, 1)
      assert.equal(rs[0]!.median.point, 7)
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  it('summarizes the per-run medians: median, min and max, never the fastest alone', () => {
    const run = (rep: number, median: number): L0Run => ({
      rep,
      target: TARGET,
      startedAt: '',
      wallMs: 1,
      loadBefore: [],
      loadAfter: [],
      results: [parseCriterionBench(BENCH, estimates(median), SAMPLE, 'x')],
    })
    const [s] = summarizeL0([run(1, 3000), run(2, 1000), run(3, 2000)])
    assert.deepEqual(s?.perRunMedianNs, [3000, 1000, 2000])
    assert.deepEqual(s?.ns, { n: 3, median: 2000, min: 1000, max: 3000 })
    assert.deepEqual(s?.nsPerElement, { n: 3, median: 2, min: 1, max: 3 })
    assert.equal(formatNs(2), '2.00 ns')
    assert.equal(formatNs(152_590), '152.59 µs')
    assert.equal(formatNs(145_150_000), '145.15 ms')
  })
})
