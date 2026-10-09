import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import {
  localInputProblem,
  resolveDatasetPath,
  seededShuffle,
  stageArtifact,
  stratifiedByMonth,
  type StratifiedCandidate,
} from './marketJob.js'
import { FEEDS_ALL, INPUT_BYTES, INPUT_REL, SLUG, makeDataRoot } from '../../native/testSupport.js'

const cand = (iso: string, i: number): StratifiedCandidate => ({
  slug: `btc-updown-15m-${Date.parse(iso) / 1000 + i * 900}`,
  marketStartMs: Date.parse(iso) + i * 900_000,
  localPath: `/d/${i}`,
})

describe('parity job building and set selection', () => {
  it('dataset paths resolve under --data-root; r2 and non-data paths are errors (MS-5, 00 §5)', () => {
    assert.equal(
      resolveDatasetPath('data/events/telonex/delta-typed/btc/15m/x.parquet', '/root/data'),
      '/root/data/events/telonex/delta-typed/btc/15m/x.parquet',
    )
    assert.throws(() => resolveDatasetPath('r2://bucket/x', '/root/data'), /local inputs only/)
    assert.throws(() => resolveDatasetPath('events/x.parquet', '/root/data'), /not under data/)
  })

  it('seeded shuffles are deterministic and seed-dependent (MS-2)', () => {
    const xs = Array.from({ length: 50 }, (_, i) => i)
    assert.deepEqual(seededShuffle(xs, 7), seededShuffle(xs, 7))
    assert.notDeepEqual(seededShuffle(xs, 7), seededShuffle(xs, 8))
    assert.deepEqual(
      [...seededShuffle(xs, 7)].sort((a, b) => a - b),
      xs,
    )
  })

  it('selection is stratified by month and replaces markets without local inputs (MS-2, MS-5)', () => {
    const cands = [
      ...Array.from({ length: 10 }, (_, i) => cand('2026-04-02T00:00:00Z', i)),
      ...Array.from({ length: 10 }, (_, i) => cand('2026-05-02T00:00:00Z', i)),
    ]
    const missing = new Set([cands[3]!.slug, cands[14]!.slug])
    const res = stratifiedByMonth(cands, 4, 1, (c) => !missing.has(c.slug))
    assert.deepEqual(res.months, { '2026-04': 4, '2026-05': 4 })
    assert.equal(res.selected.length, 8)
    assert.ok(res.selected.every((c) => !missing.has(c.slug)))
    for (let i = 1; i < res.selected.length; i++)
      assert.ok(res.selected[i]!.marketStartMs > res.selected[i - 1]!.marketStartMs)
    assert.deepEqual(
      stratifiedByMonth(cands, 4, 1, (c) => !missing.has(c.slug)),
      res,
    )
  })

  it('MS-5 / D64: a missing input, a size that differs from the catalog or a missing day file is not a local input', () => {
    // spec: 60 MS-5; 02 D64 (local size != telonex_market_conversions.size_bytes); 14 F-12, F-20 (the shim's day set)
    const root = makeDataRoot()
    const c: StratifiedCandidate = {
      slug: SLUG,
      marketStartMs: 1_776_556_800_000,
      localPath: path.join(root, INPUT_REL.slice('data/'.length)),
      conversionSizeBytes: INPUT_BYTES,
    }
    assert.equal(localInputProblem(c, FEEDS_ALL, root), null)
    assert.equal(localInputProblem({ ...c, conversionSizeBytes: null }, FEEDS_ALL, root), null)
    assert.match(
      localInputProblem({ ...c, conversionSizeBytes: INPUT_BYTES + 1 }, FEEDS_ALL, root) ?? '',
      new RegExp(`local size ${INPUT_BYTES} != catalog size_bytes ${INPUT_BYTES + 1} \\(D64\\)`),
    )
    assert.match(
      localInputProblem({ ...c, localPath: '/nonexistent' }, FEEDS_ALL, root) ?? '',
      /missing local input/,
    )
    rmSync(
      path.join(root, 'binance', 'aggTrades', 'BTCUSDT', 'BTCUSDT-aggTrades-2026-04-18.parquet'),
    )
    assert.match(localInputProblem(c, FEEDS_ALL, root) ?? '', /binance_agg_trades day file/)
    // Without a Binance request the missing Binance day does not matter.
    assert.equal(localInputProblem(c, { rtdsCryptoPrices: {} }, root), null)
  })

  it('an artifact bundle that is not local is an error, never an R2 download (MS-5)', () => {
    // spec: 60 MS-5 (gating runs read only local inputs); R14
    assert.throws(
      () => stageArtifact('f'.repeat(64), makeDataRoot({ input: false, days: false })),
      /parity runs read only local inputs/,
    )
  })
})
