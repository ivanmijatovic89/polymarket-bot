import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EXERCISER_FEATURES_V1,
  EXERCISER_FEATURES_V2_ADDED,
  MarketCoverageAcc,
  coverageVerdict,
  exerciserCoverage,
  exerciserFeatures,
  feedCoverage,
  genericCoverage,
} from './coverage.js'
import type { TraceRecord } from './trace.js'

const ev = (seq: number, kind: string, extra: Record<string, unknown> = {}): TraceRecord => ({
  t: 'event',
  seq,
  kind,
  ts: 1,
  ...extra,
})
const intent = (
  seq: number,
  kind: string,
  extra: Record<string, unknown> = {},
  src = 'tick',
): TraceRecord => ({ t: 'intent', seq, src, kind, ...extra })
const tick = (seq: number, cause = 'price_change'): TraceRecord => ({
  t: 'tick',
  seq,
  ts: seq,
  cause,
})

describe('coverage (60 §5.6)', () => {
  it('v1 has the 23 salvaged features and v2 adds the 26 listed in 60 §5.6', () => {
    assert.equal(Object.keys(EXERCISER_FEATURES_V1).length, 23)
    assert.equal(Object.keys(EXERCISER_FEATURES_V2_ADDED).length, 26)
    assert.equal(Object.keys(exerciserFeatures(2)).length, 49)
    assert.throws(() => exerciserFeatures(3), /unknown/)
  })

  it('detects v1 features from trace records', () => {
    const recs: TraceRecord[] = [
      tick(0),
      intent(0, 'place_limit', { cid: 'x1' }),
      ev(0, 'order_open', { cid: 'x1' }),
      ev(0, 'fill', { cid: 'x2', liquidity: 'TAKER' }),
      intent(0, 'place_limit', { cid: 'x2-exit' }, 'account'),
      ev(0, 'positions_split', { size: 10 }),
      tick(1),
      intent(1, 'cancel_order', { cid: 'x1' }),
      ev(1, 'order_done', { cid: 'x1', reason: 'canceled' }),
      ev(1, 'order_rejected', { cid: 'x7', reason: 'post_only_would_cross' }),
    ]
    const hit = exerciserCoverage(recs)
    for (const f of [
      'x1 post-only rests',
      'x2 FOK filled',
      'cascade x2-exit',
      'split',
      'cancel_order x1',
      'x7 post-only rejected',
    ])
      assert.ok(hit.has(f as never), f)
    assert.equal(hit.has('x2 FOK killed'), false)
  })

  it('detects v2 features (cascades, batches, rejection codes, intentMeta)', () => {
    const b15 = Array.from({ length: 15 }, (_, i) => `b15-${String(i).padStart(2, '0')}`)
    const b16 = Array.from({ length: 16 }, (_, i) => `b16-${String(i).padStart(2, '0')}`)
    const recs: TraceRecord[] = [
      tick(0),
      intent(0, 'place_limit', { cid: 'x11-sib' }, 'account'),
      intent(0, 'cancel_order', { cid: 'x11' }, 'account'),
      intent(0, 'place_limit', { cid: 'x12' }),
      intent(0, 'cancel_order', { cid: 'x12' }),
      intent(0, 'place_batch', { orders: b16.map((cid) => ({ cid })) }),
      ...b15.map((cid) => ev(0, 'order_accepted', { cid })),
      intent(0, 'cancel_batch', { cids: [...b15, ...b16] }),
      ev(0, 'order_rejected', {
        cid: 'x13',
        reason: 'insufficient_capital(required=990,available=500)',
      }),
      ev(0, 'order_submitted', { cid: 'x16a' }),
      ev(0, 'order_rejected', { cid: 'x16b', reason: 'invalid_size' }),
      ev(0, 'order_rejected', {
        cid: 'x15',
        reason: 'gtd_expireAtMs_too_soon(min_offset_ms=60000)',
      }),
      intent(0, 'merge_positions', { size: 0 }),
      intent(0, 'merge_positions', { size: 100000 }),
      ev(0, 'positions_merged', { size: 5 }),
      intent(0, 'cancel_market', { asset: null, market: '0xabc' }),
      { t: 'final', stats: { intentMeta: [{ case: 'x1', n: 50 }] } },
    ]
    const hit = exerciserCoverage(recs)
    for (const f of [
      'x11 order_submitted cascade',
      'x11-sib cascade cancel',
      'x12 place-then-cancel',
      'b15 accepted',
      'b16 over cap',
      'cancel_batch mixed',
      'x13 insufficient capital',
      'x16 partial batch',
      'x15 gtd too soon',
      'merge zero',
      'merge clamp',
      'cancel_market by market',
      'intentMeta populated',
    ])
      assert.ok(hit.has(f as never), f)
  })

  it('thresholds: D needs 95% of markets, L at least one market (60 §5.6)', () => {
    const rows = coverageVerdict({ d: 'D', l: 'L' }, [
      ...Array.from({ length: 19 }, () => new Set(['d'])),
      new Set<string>(['l']),
    ])
    assert.deepEqual(
      rows.map((r) => [r.feature, r.markets, r.pass]),
      [
        ['d', 19, true],
        ['l', 1, true],
      ],
    )
    const fail = coverageVerdict({ d: 'D', l: 'L' }, [new Set(['d']), new Set<string>()])
    assert.deepEqual(
      fail.map((r) => r.pass),
      [false, false],
    )
  })

  it('generic and feed coverage count ticks, synthetic causes and visible feeds', () => {
    const recs: TraceRecord[] = [
      tick(0),
      {
        t: 'feeds',
        seq: 0,
        binance: { tsMs: 1 },
        chainlink: null,
        priceToBeat: null,
        plugins: { dwellGate: {} },
      },
      tick(1, 'binance_agg_trade'),
      {
        t: 'feeds',
        seq: 1,
        binance: { tsMs: 2 },
        chainlink: { tsMs: 1 },
        priceToBeat: { value: 1 },
        plugins: {},
      },
      tick(2, 'chainlink_round'),
      ev(2, 'settlement_update', { cid: 'x1', status: 'MATCHED' }),
    ]
    const g = genericCoverage(recs)
    assert.equal(g.ticks, 3)
    assert.equal(g.syntheticTicks, 2)
    assert.equal(g.settlementUpdates, 1)
    assert.deepEqual(feedCoverage(recs), {
      ticks: 3,
      binanceTicks: 2,
      chainlinkTicks: 1,
      priceToBeatTicks: 1,
      syntheticBinance: 1,
      syntheticChainlink: 1,
      plugins: { dwellGate: 1 },
    })
  })

  it('a masked market counts only its identical prefix', () => {
    // spec: 60 PM-4 ("coverage (§5.6) counts only its identical prefix"), §5.6
    const recs = [tick(0), intent(0, 'place_limit'), tick(1), tick(2)]
    const full = new MarketCoverageAcc('decisions', null)
    const prefix = new MarketCoverageAcc('decisions', null, 2)
    for (const r of recs) {
      full.add(r)
      prefix.add(r)
    }
    assert.equal(full.result().generic.ticks, 3)
    assert.equal(full.result().prefixRecords, undefined)
    const p = prefix.result()
    assert.equal(p.generic.ticks, 1)
    assert.equal(p.generic.intents, 1)
    assert.equal(p.prefixRecords, 2)
    assert.equal(p.feeds, undefined)
    assert.deepEqual(new MarketCoverageAcc('feeds', 2).result().exerciser, [])
  })
})
