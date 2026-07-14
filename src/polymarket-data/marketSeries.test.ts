import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MARKET_SERIES,
  TIMEFRAME_MS,
  isTimeframe,
  pagingWindowMs,
  parseSlugEpochMs,
  resolveMarketWindow,
  selectSeries,
} from './marketSeries.js'

test('every (symbol, timeframe) pair is present exactly once', () => {
  const keys = MARKET_SERIES.map((s) => `${s.symbol}-${s.timeframe}`)
  assert.equal(new Set(keys).size, keys.length, 'duplicate symbol/timeframe entry')
  assert.equal(keys.length, 20, '4 symbols x 5 timeframes')

  const ids = MARKET_SERIES.map((s) => s.seriesId)
  assert.equal(new Set(ids).size, ids.length, 'duplicate series id')
})

test('selectSeries filters by symbol and timeframe', () => {
  assert.equal(selectSeries({ symbol: 'btc' }).length, 5)
  assert.equal(selectSeries({ timeframe: '15m' }).length, 4)
  const one = selectSeries({ symbol: 'sol', timeframe: '4h' })
  assert.equal(one.length, 1)
  // The live series — the legacy `solana-up-or-down-4h` (10326) returns no events.
  assert.equal(one[0]!.seriesId, '10333')
})

test('parseSlugEpochMs reads epoch slugs and rejects word slugs', () => {
  assert.equal(parseSlugEpochMs('btc-updown-15m-1784061000'), 1784061000_000)
  assert.equal(parseSlugEpochMs('btc-updown-4h-1784030400'), 1784030400_000)
  assert.equal(parseSlugEpochMs('bitcoin-up-or-down-july-14-2026-2pm-et'), null)
  assert.equal(parseSlugEpochMs('bitcoin-up-or-down-on-july-14-2026'), null)
})

test('resolveMarketWindow uses the slug epoch for epoch slugs', () => {
  const w = resolveMarketWindow({
    slug: 'btc-updown-15m-1784061000',
    timeframe: '15m',
    endDateIso: '2026-07-14T20:45:00Z',
    eventStartTimeIso: '2026-07-14T20:30:00Z',
  })
  assert.equal(w.startMs, 1784061000_000)
  assert.equal(w.endMs - w.startMs, TIMEFRAME_MS['15m'])
})

test('resolveMarketWindow uses eventStartTime for word slugs', () => {
  const w = resolveMarketWindow({
    slug: 'bitcoin-up-or-down-july-14-2026-2pm-et',
    timeframe: '1h',
    endDateIso: '2026-07-14T19:00:00Z',
    eventStartTimeIso: '2026-07-14T18:00:00Z',
  })
  assert.equal(w.startMs, Date.parse('2026-07-14T18:00:00Z'))
  assert.equal(w.endMs, Date.parse('2026-07-14T19:00:00Z'))
})

test('resolveMarketWindow falls back to end - timeframe when eventStartTime is missing', () => {
  const w = resolveMarketWindow({
    slug: 'bitcoin-up-or-down-on-july-14-2026',
    timeframe: '1d',
    endDateIso: '2026-07-15T04:00:00Z',
    eventStartTimeIso: null,
  })
  assert.equal(w.endMs - w.startMs, TIMEFRAME_MS['1d'])
})

test('resolveMarketWindow throws when the slug epoch and eventStartTime disagree', () => {
  assert.throws(
    () =>
      resolveMarketWindow({
        slug: 'btc-updown-15m-1784061000',
        timeframe: '15m',
        endDateIso: '2026-07-14T20:45:00Z',
        eventStartTimeIso: '2026-07-14T20:31:00Z',
      }),
    /window mismatch/,
  )
})

test('paging windows stay well below Gamma offset cap for the densest series', () => {
  for (const tf of ['5m', '15m', '1h', '4h', '1d'] as const) {
    const eventsPerWindow = pagingWindowMs(tf) / TIMEFRAME_MS[tf]
    assert.ok(eventsPerWindow <= 2000, `${tf} window would exceed the offset cap`)
  }
})

test('isTimeframe guards unknown values', () => {
  assert.equal(isTimeframe('15m'), true)
  assert.equal(isTimeframe('30m'), false)
})
