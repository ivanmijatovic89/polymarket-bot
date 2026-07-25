import test from 'node:test'
import assert from 'node:assert/strict'
import {
  boundaryLag,
  bookAgreement,
  buildTimeline,
  compareParityLogs,
  gridAgreement,
  overlapWindow,
  parseParityJsonl,
  ptbFirstSeen,
  valueAt,
  type ParityRow,
} from './feedsParityCompare.js'

const T0 = 1_700_000_000_000

function row(p: Partial<ParityRow> & { seenAtMs: number }): ParityRow {
  return { v: 1, mode: 'live', exchangeTsMs: p.seenAtMs, ...p } as ParityRow
}

test('parseParityJsonl tolerates torn lines and wrong versions, sorts by seenAtMs', () => {
  const text = [
    JSON.stringify(row({ seenAtMs: T0 + 200 })),
    '{"v":2,"seenAtMs":123}',
    'garbage{',
    JSON.stringify(row({ seenAtMs: T0 + 100 })),
    '',
  ].join('\n')
  const rows = parseParityJsonl(text)
  assert.equal(rows.length, 2)
  assert.equal(rows[0]!.seenAtMs, T0 + 100)
})

test('buildTimeline emits one point per change including key appearance/disappearance', () => {
  const rows: ParityRow[] = [
    row({ seenAtMs: T0 }), // absent
    row({ seenAtMs: T0 + 1000, binance: { tsMs: T0, value: 10 } }),
    row({ seenAtMs: T0 + 2000, binance: { tsMs: T0, value: 10 } }), // no change
    row({ seenAtMs: T0 + 3000, binance: { tsMs: T0, value: 11 } }),
    row({ seenAtMs: T0 + 4000 }), // key gone
  ]
  const tl = buildTimeline(rows, 'binance')
  assert.deepEqual(
    tl.map((p) => [p.atMs - T0, p.value]),
    [
      [0, null],
      [1000, 10],
      [3000, 11],
      [4000, null],
    ],
  )
  assert.equal(valueAt(tl, T0 + 2500), 10)
  assert.equal(valueAt(tl, T0 - 1), null)
  assert.equal(valueAt(tl, T0 + 9999), null)
})

test('gridAgreement counts equal (incl. both-null) samples', () => {
  const a = buildTimeline(
    [
      row({ seenAtMs: T0, binance: { tsMs: T0, value: 1 } }),
      row({ seenAtMs: T0 + 5000, binance: { tsMs: T0, value: 2 } }),
    ],
    'binance',
  )
  const b = buildTimeline(
    [
      row({ seenAtMs: T0, binance: { tsMs: T0, value: 1 } }),
      row({ seenAtMs: T0 + 7000, binance: { tsMs: T0, value: 2 } }),
    ],
    'binance',
  )
  // Disagree on the 2s where a=2 but b=1 (t=+5000,+6000).
  const g = gridAgreement(a, b, T0, T0 + 10_000, 1000)
  assert.equal(g.total, 11)
  assert.equal(g.agree, 9)
})

test('identical logs → 100% agreement, zero lag, no unmatched (neutrality)', () => {
  const rows: ParityRow[] = []
  for (let i = 0; i < 60; i++) {
    rows.push(
      row({
        seenAtMs: T0 + i * 1000,
        binance: { tsMs: T0 + i * 1000, value: 100 + Math.floor(i / 5) },
        chainlink: { tsMs: T0 + i * 1000, value: 200 + Math.floor(i / 7) },
      }),
    )
  }
  const report = compareParityLogs({
    live: rows,
    replay: rows,
    currentLatency: { binanceMs: 110, chainlinkMs: 235 },
  })!
  assert.equal(report.binance.agreement.pct, 100)
  assert.equal(report.chainlink.agreement.pct, 100)
  assert.equal(report.binance.lag.stats!.meanMs, 0)
  assert.equal(report.binance.lag.unmatchedLive, 0)
  assert.equal(report.binance.lag.unmatchedReplay, 0)
  assert.equal(report.binance.suggestion!.suggestedMs, 110)
})

test('constant shift → boundaryLag mean equals the shift; suggestion subtracts it (sensitivity)', () => {
  const live: ParityRow[] = []
  const replay: ParityRow[] = []
  for (let i = 0; i < 30; i++) {
    const v = 100 + i
    live.push(row({ seenAtMs: T0 + i * 2000, binance: { tsMs: T0, value: v } }))
    replay.push(row({ seenAtMs: T0 + i * 2000 + 500, binance: { tsMs: T0, value: v } }))
  }
  const tlL = buildTimeline(live, 'binance')
  const tlR = buildTimeline(replay, 'binance')
  const lag = boundaryLag(tlL, tlR, T0, T0 + 60_000)
  assert.equal(lag.stats!.meanMs, 500)
  assert.equal(lag.stats!.p50Ms, 500)
  const report = compareParityLogs({
    live,
    replay,
    currentLatency: { binanceMs: 110, chainlinkMs: 235 },
  })!
  assert.equal(report.binance.suggestion!.suggestedMs, 110 - 500 < 0 ? 0 : 110 - 500)
})

test('boundaryLag leaves transitions unmatched outside the window / with unseen values', () => {
  const live = buildTimeline(
    [
      row({ seenAtMs: T0, binance: { tsMs: T0, value: 1 } }),
      row({ seenAtMs: T0 + 10_000, binance: { tsMs: T0, value: 2 } }),
      row({ seenAtMs: T0 + 20_000, binance: { tsMs: T0, value: 3 } }), // replay never sees 3
    ],
    'binance',
  )
  const replay = buildTimeline(
    [
      row({ seenAtMs: T0 + 100, binance: { tsMs: T0, value: 1 } }),
      row({ seenAtMs: T0 + 17_000, binance: { tsMs: T0, value: 2 } }), // 7s late: outside 5s window
    ],
    'binance',
  )
  const lag = boundaryLag(live, replay, T0, T0 + 30_000)
  assert.equal(lag.matched.length, 1) // only value=1
  assert.equal(lag.unmatchedLive, 2)
})

test('ptb first-seen and delta', () => {
  const live = [
    row({ seenAtMs: T0 }),
    row({ seenAtMs: T0 + 30_000, ptb: { openPrice: 5, receivedAtMs: T0 + 30_000 } }),
  ]
  const replay = [
    row({ seenAtMs: T0 }),
    row({ seenAtMs: T0 + 33_000, ptb: { openPrice: 5, receivedAtMs: T0 + 33_000 } }),
  ]
  assert.equal(ptbFirstSeen(live), T0 + 30_000)
  const report = compareParityLogs({
    live,
    replay,
    currentLatency: { binanceMs: 110, chainlinkMs: 235 },
  })!
  assert.equal(report.ptb.dtMs, 3000)
})

test('bookAgreement aligns on exchange ts and compares per-asset top-of-book', () => {
  const mk = (seen: number, ex: number, bid: number): ParityRow =>
    ({
      ...row({ seenAtMs: seen }),
      exchangeTsMs: ex,
      books: [{ assetId: 'A', bid, ask: bid + 0.01 }],
    }) as ParityRow
  const live = [mk(T0, T0, 0.5), mk(T0 + 1000, T0 + 1000, 0.51), mk(T0 + 2000, T0 + 2000, 0.52)]
  const replay = [
    mk(T0 + 50, T0, 0.5),
    mk(T0 + 1050, T0 + 1000, 0.51),
    mk(T0 + 2050, T0 + 2000, 0.99),
  ]
  const b = bookAgreement(live, replay)
  assert.equal(b.total, 3)
  assert.equal(b.agree, 2)
})

test('overlapWindow trims to the common span', () => {
  const a = [row({ seenAtMs: T0 }), row({ seenAtMs: T0 + 100_000 })]
  const b = [row({ seenAtMs: T0 + 40_000 }), row({ seenAtMs: T0 + 200_000 })]
  const ov = overlapWindow(a, b)!
  assert.equal(ov.fromMs, T0 + 40_000)
  assert.equal(ov.toMs, T0 + 100_000)
  assert.equal(overlapWindow([], b), null)
})

test('syntheticTicks counts synthetic rows and flags backward exchangeTsMs (the clamp observable)', () => {
  const mk = (side: 'live' | 'parquet', rows: Array<[number, number, boolean]>): ParityRow[] =>
    rows.map(([seenAtMs, exchangeTsMs, synthetic]) =>
      row({ seenAtMs, exchangeTsMs, mode: side, ...(synthetic ? { synthetic: true } : {}) }),
    )
  // Live: clamped correctly — synthetic exchangeTs never below the previous row.
  const live = mk('live', [
    [T0, T0, false],
    [T0 + 100, T0 + 100, true],
    [T0 + 60_000, T0 + 60_000, false],
  ])
  // Replay: one synthetic row stamped BELOW the preceding real tick's exchange
  // ts — exactly what an un-clamped builder would produce.
  const replay = mk('parquet', [
    [T0, T0, false],
    [T0 + 100, T0 - 50, true],
    [T0 + 60_000, T0 + 60_000, false],
  ])
  const report = compareParityLogs({
    live,
    replay,
    currentLatency: { binanceMs: 110, chainlinkMs: 320 },
  })
  assert.ok(report)
  assert.deepEqual(report.syntheticTicks, {
    live: 1,
    replay: 1,
    backwardTimeLive: 0,
    backwardTimeReplay: 1,
  })
})

test('syntheticTicks is null when neither side has synthetic rows', () => {
  const rows = [row({ seenAtMs: T0 }), row({ seenAtMs: T0 + 60_000 })]
  const report = compareParityLogs({
    live: rows,
    replay: rows.map((r) => ({ ...r, mode: 'parquet' as const })),
    currentLatency: { binanceMs: 110, chainlinkMs: 320 },
  })
  assert.ok(report)
  assert.equal(report.syntheticTicks, null)
})
