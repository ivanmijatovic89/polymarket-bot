import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyTsFailure, failureVerdict, rustFailureClass } from './failureClass.js'

describe('failure classes of a parity market (60 CL-7; 14 §10)', () => {
  it('maps the TS feed-loader failures to the 14 §10 classes', () => {
    // spec: 14 §10 condition table (evidence column)
    const cases: Array<[string, string, string]> = [
      [
        '[backtest:feeds] MISSING chainlink data for btcusd: the market window [..] contains a 6.9-minute hole in the oracle series',
        'data_defect',
        'upstream_hole',
      ],
      [
        '[backtest:feeds] market window starts 2026-03-01T00:00:00.000Z, before crypto_prices coverage (2026-04-02)',
        'data_defect',
        'pre_coverage',
      ],
      [
        '[backtest:feeds] missing Binance aggTrades day file(s) for BTCUSDT: 2026-05-01',
        'data_missing',
        'day_file_missing',
      ],
      [
        '[backtest:feeds] missing Telonex crypto_prices day file(s) for btcusd: 2026-05-01.',
        'data_missing',
        'day_file_missing',
      ],
      [
        '[backtest:feeds] Binance aggTrades day file(s) for BTCUSDT contain no trades up to x',
        'data_defect',
        'corrupt',
      ],
    ]
    for (const [text, cls, cause] of cases)
      assert.deepEqual(classifyTsFailure(`Error: ${text}\n    at foo`), { class: cls, cause }, text)
    assert.equal(classifyTsFailure('TypeError: x is undefined'), null)
  })

  it('both sides failing with the same class is identical; anything else is unclassified', () => {
    // spec: 60 CL-7, HR-6 (excluded only for OR-9 and MS-5)
    const hole = { class: 'data_defect' as const, cause: 'upstream_hole' }
    assert.deepEqual(failureVerdict({ failure: hole }, { failure: hole }), {
      verdict: 'identical',
    })
    // Same class, different cause: still the same class (CL-7 compares classes).
    assert.equal(
      failureVerdict({ failure: hole }, { failure: { class: 'data_defect', cause: 'corrupt' } })
        .verdict,
      'identical',
    )
    const diff = failureVerdict(
      { failure: hole },
      { failure: { class: 'data_missing', cause: 'day_file_missing' } },
    )
    assert.equal(diff.verdict, 'unclassified')
    assert.equal(failureVerdict({ failure: hole }, 'ok').verdict, 'unclassified')
    assert.equal(failureVerdict('ok', { failure: hole }).verdict, 'unclassified')
    // An unclassifiable TS failure never equals a Rust class.
    assert.equal(failureVerdict({ failure: null }, { failure: hole }).verdict, 'unclassified')
    assert.equal(failureVerdict({ failure: null }, { failure: null }).verdict, 'unclassified')
    assert.throws(() => failureVerdict('ok', 'ok'))
  })

  it('reads the Rust class from an ErrorInfo', () => {
    assert.deepEqual(
      rustFailureClass({ class: 'data_defect', cause: 'upstream_hole', message: 'm' }),
      { class: 'data_defect', cause: 'upstream_hole' },
    )
    assert.equal(rustFailureClass(null), null)
  })
})
