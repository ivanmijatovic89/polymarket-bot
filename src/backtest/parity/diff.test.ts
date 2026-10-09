import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diffTraces, isFeeHalfTie, reasonCode, toMicros, USDC_TOLERANCE } from './diff.js'
import type { TraceRecord } from './trace.js'

const header = (over: Record<string, unknown> = {}): TraceRecord => ({
  t: 'header',
  format: 'pmb-parity-trace',
  version: 2,
  engine: 'ts',
  engineVersion: 'ts',
  profile: 'ts-compat',
  slug: 'btc-updown-15m-1775417400',
  candidateKey: 'parity-btc-updown-15m-1775417400',
  level: 'decisions',
  ...over,
})

const stats = (over: Record<string, unknown> = {}) => ({
  slug: 'btc-updown-15m-1775417400',
  marketId: '0xabc',
  finalOutcome: 'UP',
  pnl: 1.23,
  tradeCount: 1,
  tradeAsMaker: 0,
  tradeAsTaker: 1,
  feesPaid: 0.18,
  avgEntryPriceUp: 0.5,
  avgEntryPriceDown: null,
  upShares: 10.02,
  downShares: 0,
  mergableShares: 0,
  cost: 5.01,
  splitCost: 0,
  intentMeta: [],
  ...over,
})

const unrounded = (over: Record<string, unknown> = {}) => ({
  pnl: 1.234,
  cost: 5.01,
  feesPaid: 0.17535,
  splitCost: 0,
  upShares: 10.02,
  downShares: 0,
  ...over,
})

const final = (over: Record<string, unknown> = {}): TraceRecord => ({
  t: 'final',
  stats: stats(),
  skipReason: null,
  eventsProcessed: 3,
  eventsByType: { book: 1, price_change: 2 },
  unrounded: unrounded(),
  ...over,
})

const tick = (seq: number, over: Record<string, unknown> = {}): TraceRecord => ({
  t: 'tick',
  seq,
  ts: 1775417400000 + seq,
  cause: 'price_change',
  ...over,
})

const trace = (...body: TraceRecord[]): TraceRecord[] => [header(), ...body, final()]

describe('diff v2 (22 §3.4)', () => {
  it('identical traces are equal and gating', () => {
    const a = trace(tick(0), tick(1))
    const r = diffTraces(a, structuredClone(a))
    assert.equal(r.equal, true)
    assert.equal(r.gating, true)
    assert.equal(r.mismatches.length, 0)
  })

  it('headers must agree on format, version, slug, candidateKey, profile; engine fields may differ', () => {
    // spec: 22 §3.4 Alignment
    const a = trace(tick(0))
    const b = [header({ engine: 'native', engineVersion: '0.1.0' }), tick(0), final()]
    assert.equal(diffTraces(a, b).equal, true)
    const c = [header({ candidateKey: 'other' }), tick(0), final()]
    const r = diffTraces(a, c)
    assert.equal(r.equal, false)
    assert.equal(r.failures[0]!.kind, 'header')
  })

  it('prices and sizes are exact after conversion to micros', () => {
    // spec: 22 §3.4 "Prices, sizes ... exact after conversion to micros"
    const intent = (price: number): TraceRecord => ({
      t: 'intent',
      seq: 0,
      src: 'tick',
      kind: 'place_limit',
      cid: 'x1',
      asset: 0,
      side: 'BUY',
      price,
      size: 10,
      orderType: 'GTC',
      postOnly: true,
      expireAtMs: null,
    })
    assert.equal(
      diffTraces(trace(tick(0), intent(0.52)), trace(tick(0), intent(0.5200000001))).equal,
      true,
    )
    const r = diffTraces(trace(tick(0), intent(0.52)), trace(tick(0), intent(0.520001)))
    assert.equal(r.equal, false)
    assert.equal(r.failures[0]!.path, '$.price')
  })

  it('USDC fields compare within 1e-4', () => {
    // spec: 22 §3.4 USDC fields; 00 R5
    const split = (cost: number): TraceRecord => ({
      t: 'event',
      seq: 0,
      kind: 'positions_split',
      ts: 1,
      size: 10,
      cost,
    })
    assert.equal(diffTraces(trace(tick(0), split(10)), trace(tick(0), split(10.00009))).equal, true)
    assert.equal(diffTraces(trace(tick(0), split(10)), trace(tick(0), split(10.0002))).equal, false)
  })

  it('integers, strings and key sets are exact', () => {
    // spec: 22 §3.4 integers/strings/key sets
    assert.equal(diffTraces(trace(tick(0)), trace(tick(0, { ts: 1775417400001 }))).equal, false)
    assert.equal(diffTraces(trace(tick(0)), trace(tick(0, { cause: 'book' }))).equal, false)
    assert.equal(diffTraces(trace(tick(0)), trace(tick(0, { extra: 1 }))).equal, false)
  })

  it('optional tick fields xts/vts are compared only when both sides have them', () => {
    // spec: 22 §3.2 tick record
    assert.equal(diffTraces(trace(tick(0, { xts: 5, vts: 6 })), trace(tick(0))).equal, true)
    assert.equal(diffTraces(trace(tick(0, { vts: 6 })), trace(tick(0, { vts: 7 }))).equal, false)
  })

  it('reason codes: parameters ignored, known codes exact, unknown codes reported as reason_code_unmapped', () => {
    // spec: 22 §3.4 reason rule; 21 §17
    const rej = (reason: string): TraceRecord => ({
      t: 'event',
      seq: 0,
      kind: 'order_rejected',
      ts: 1,
      cid: 'x13',
      reason,
    })
    assert.equal(reasonCode('insufficient_capital(required=1,available=0)'), 'insufficient_capital')
    assert.equal(
      diffTraces(
        trace(tick(0), rej('insufficient_capital(required=990.5,available=500)')),
        trace(tick(0), rej('insufficient_capital(required=990.500000,available=500.000000)')),
      ).equal,
      true,
    )
    assert.equal(
      diffTraces(trace(tick(0), rej('invalid_price')), trace(tick(0), rej('invalid_size'))).equal,
      false,
    )
    const r = diffTraces(
      trace(tick(0), rej('Funding error: x')),
      trace(tick(0), rej('insufficient_collateral')),
    )
    assert.equal(r.failures[0]!.kind, 'reason_code_unmapped')
    // order_done reasons are plain strings, compared exactly
    const done = (reason: string): TraceRecord => ({
      t: 'event',
      seq: 0,
      kind: 'order_done',
      ts: 1,
      cid: 'x1',
      reason,
      filledSize: null,
    })
    assert.equal(
      diffTraces(trace(tick(0), done('canceled')), trace(tick(0), done('canceled(x)'))).equal,
      false,
    )
  })

  it('a record type or kind change is a sequence divergence that stops the diff', () => {
    // spec: 60 HR-6 (field-only divergences continue, sequence shifts stop)
    const a = trace(tick(0), { t: 'event', seq: 0, kind: 'order_open', ts: 1, cid: 'x1' }, tick(1))
    const b = trace(
      tick(0),
      { t: 'event', seq: 0, kind: 'order_rejected', ts: 1, cid: 'x1', reason: 'invalid_price' },
      tick(1, { ts: 9 }),
    )
    const r = diffTraces(a, b)
    assert.equal(r.sequenceDivergence, 2)
    assert.equal(r.failures.length, 1)
    assert.equal(r.failures[0]!.kind, 'sequence')
  })

  it('field-only divergences are all collected and the diff continues', () => {
    // spec: 60 HR-6
    const r = diffTraces(trace(tick(0), tick(1)), trace(tick(0, { ts: 1 }), tick(1, { ts: 2 })))
    assert.equal(r.failures.length, 2)
    assert.equal(r.sequenceDivergence, null)
  })

  it('a missing final record makes the traces unequal', () => {
    const a = trace(tick(0))
    const r = diffTraces(a, a.slice(0, -1))
    assert.equal(r.equal, false)
    assert.equal(r.failures[0]!.kind, 'sequence')
  })

  it('final.stats are exact at persisted precision', () => {
    // spec: 22 §3.4 final.stats (2 dp, 4 dp, integers)
    const b = [
      header(),
      tick(0),
      final({ stats: stats({ pnl: 1.234999 }), unrounded: unrounded({ pnl: 1.234999 }) }),
    ]
    const a = [
      header(),
      tick(0),
      final({ stats: stats({ pnl: 1.23 }), unrounded: unrounded({ pnl: 1.234999 }) }),
    ]
    assert.equal(diffTraces(a, b).equal, true)
    const c = [header(), tick(0), final({ stats: stats({ tradeCount: 2 }) })]
    assert.equal(diffTraces(trace(tick(0)), c).equal, false)
  })

  it('a quantized stat that differs while its unrounded value agrees within 1e-4 is rounding_boundary', () => {
    // spec: 22 §3.4 rounding boundary; 60 §3.5 PE-R1
    const a = [
      header(),
      tick(0),
      final({ stats: stats({ pnl: 1.23 }), unrounded: unrounded({ pnl: 1.234999 }) }),
    ]
    const b = [
      header(),
      tick(0),
      final({ stats: stats({ pnl: 1.24 }), unrounded: unrounded({ pnl: 1.235001 }) }),
    ]
    const r = diffTraces(a, b)
    assert.equal(r.equal, true)
    assert.equal(r.autoClasses.rounding_boundary, 1)
  })

  it('a negative half tie is rounding_tie (D08)', () => {
    // spec: 22 §3.4; 60 §3.5 PE-R2; D08
    const a = [
      header(),
      tick(0),
      final({ stats: stats({ pnl: -1.23 }), unrounded: unrounded({ pnl: -1.235 }) }),
    ]
    const b = [
      header(),
      tick(0),
      final({ stats: stats({ pnl: -1.24 }), unrounded: unrounded({ pnl: -1.235 }) }),
    ]
    const r = diffTraces(a, b)
    assert.equal(r.equal, true)
    assert.equal(r.autoClasses.rounding_tie, 1)
  })

  it('a quantized stat that differs with unrounded values apart is a failure', () => {
    const a = [
      header(),
      tick(0),
      final({ stats: stats({ pnl: 1.23 }), unrounded: unrounded({ pnl: 1.23 }) }),
    ]
    const b = [
      header(),
      tick(0),
      final({ stats: stats({ pnl: 1.25 }), unrounded: unrounded({ pnl: 1.25 }) }),
    ]
    const r = diffTraces(a, b)
    assert.equal(r.equal, false)
    assert.deepEqual(r.failures.map((f) => f.path).sort(), ['$.stats.pnl', '$.unrounded.pnl'])
  })

  it('intentMeta is deep-equal with numbers within relative 1e-9', () => {
    // spec: 22 §3.4 final.stats intentMeta
    const meta = (x: number) => [
      header(),
      tick(0),
      final({ stats: stats({ intentMeta: [{ case: 'x1', edge: x }] }) }),
    ]
    assert.equal(diffTraces(meta(0.123456789), meta(0.1234567890000001)).equal, true)
    assert.equal(diffTraces(meta(0.123456789), meta(0.1234568)).equal, false)
  })

  it('fee_rounding_tie: a fill fee off by exactly 1e-4 on an exact 4-dp half is auto-classified and compensated', () => {
    // spec: 60 §3.5 PE-R3 (p = 0.50, C = 10.02 gives 0.17535)
    assert.equal(isFeeHalfTie(0.5, 10.02), true)
    assert.equal(isFeeHalfTie(0.5, 10), false)
    const fill = (fee: number): TraceRecord => ({
      t: 'event',
      seq: 0,
      kind: 'fill',
      ts: 1,
      cid: 'x5',
      asset: 0,
      side: 'BUY',
      price: 0.5,
      size: 10.02,
      fee,
      liquidity: 'TAKER',
    })
    const a = [
      header(),
      tick(0),
      fill(0.1753),
      final({ unrounded: unrounded({ feesPaid: 0.1753, pnl: 1.2341 }) }),
    ]
    const b = [
      header(),
      tick(0),
      fill(0.1754),
      final({ unrounded: unrounded({ feesPaid: 0.1754, pnl: 1.234 }) }),
    ]
    const r = diffTraces(a, b)
    assert.equal(r.autoClasses.fee_rounding_tie, 1)
    assert.equal(r.equal, true, JSON.stringify(r.failures))
    // without an exact half the plain 1e-4 USDC rule applies
    const c = [header(), tick(0), { ...fill(0.1753), size: 10 }, final()]
    const d = [header(), tick(0), { ...fill(0.1755), size: 10 }, final()]
    assert.equal(diffTraces(c, d).equal, false)
    const e = [header(), tick(0), { ...fill(0.17535), size: 10 }, final()]
    assert.equal(diffTraces(c, e).autoClasses.fee_rounding_tie, undefined)
  })

  it('feeds values are exact; plugin floats compare at relative 1e-9 and plugin integers exactly', () => {
    // spec: 14 V-3 (feeds exact), 14 V-5 (plugin floats relative 1e-9)
    const feeds = (value: number, vol: number, n: number): TraceRecord => ({
      t: 'feeds',
      seq: 0,
      binance: { tsMs: 1, value, receivedAtMs: 111 },
      chainlink: null,
      priceToBeat: { value: 68000.5, receivedAtMs: 2700 },
      plugins: { timeWindowVolatility: { std: vol, n } },
    })
    assert.equal(
      diffTraces(
        trace(tick(0), feeds(67465.22, 0.1, 3)),
        trace(tick(0), feeds(67465.22, 0.1 + 1e-12, 3)),
      ).equal,
      true,
    )
    assert.equal(
      diffTraces(
        trace(tick(0), feeds(67465.22, 0.1, 3)),
        trace(tick(0), feeds(67465.2200001, 0.1, 3)),
      ).equal,
      false,
    )
    assert.equal(
      diffTraces(trace(tick(0), feeds(67465.22, 0.1, 3)), trace(tick(0), feeds(67465.22, 0.1, 4)))
        .equal,
      false,
    )
  })

  it('--tolerance overrides the numeric rules and marks the result non-gating', () => {
    // spec: 22 §3.4 Tolerance flags; 60 VP-3
    const split = (cost: number): TraceRecord => ({
      t: 'event',
      seq: 0,
      kind: 'positions_split',
      ts: 1,
      size: 10,
      cost,
    })
    const r = diffTraces(trace(tick(0), split(10)), trace(tick(0), split(10.0002)), {
      tolerance: 1e-3,
    })
    assert.equal(r.equal, true)
    assert.equal(r.gating, false)
  })

  it('micros round half away from zero', () => {
    // spec: 22 §3.4 (round half away from zero at 1e-6)
    assert.equal(toMicros(0.0000005), 1)
    assert.equal(toMicros(-0.0000005), -1)
    assert.equal(USDC_TOLERANCE, 1e-4)
  })
})
