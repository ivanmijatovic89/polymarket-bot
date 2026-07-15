import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCatalogStartMs } from './catalogResume.js'

const DAY = 24 * 60 * 60 * 1000
const FLOOR = Date.parse('2026-06-01T00:00:00Z')
const OVERLAP = DAY
const TF_15M = 15 * 60 * 1000
const TF_1D = DAY

const base = { full: false, floorMs: FLOOR, timeframeMs: TF_15M, resumeOverlapMs: OVERLAP }

test('explicit --from always wins', () => {
  const from = Date.parse('2026-03-01T00:00:00Z')
  assert.equal(
    resolveCatalogStartMs({
      ...base,
      fromMs: from,
      minStartMs: FLOOR,
      maxStartMs: FLOOR + 10 * DAY,
    }),
    from,
  )
})

test('--full rescans from the floor', () => {
  assert.equal(
    resolveCatalogStartMs({ ...base, full: true, minStartMs: FLOOR, maxStartMs: FLOOR + 10 * DAY }),
    FLOOR,
  )
})

test('empty series starts at the floor', () => {
  assert.equal(resolveCatalogStartMs({ ...base, minStartMs: null, maxStartMs: null }), FLOOR)
})

test('steady state resumes just behind the newest market', () => {
  const maxStart = FLOOR + 30 * DAY
  // earliest stored ~= floor (continuous markets) → not an extend
  assert.equal(
    resolveCatalogStartMs({ ...base, minStartMs: FLOOR, maxStartMs: maxStart }),
    maxStart - OVERLAP,
  )
})

test('floor moved earlier than stored history → scan from the (new) floor', () => {
  // Regression for the reported bug: DB holds June onward, floor lowered to Jan.
  const janFloor = Date.parse('2026-01-01T00:00:00Z')
  const juneMin = Date.parse('2026-06-01T00:00:00Z')
  const juneMax = Date.parse('2026-06-30T00:00:00Z')
  assert.equal(
    resolveCatalogStartMs({
      ...base,
      floorMs: janFloor,
      minStartMs: juneMin,
      maxStartMs: juneMax,
    }),
    janFloor,
  )
})

test('one timeframe of slack: a daily market starting hours after a midnight floor is NOT an extend', () => {
  // floor at 00:00 UTC, first daily market at 04:00 UTC → 4h gap < 1 day tolerance
  const minStart = FLOOR + 4 * 60 * 60 * 1000
  const maxStart = FLOOR + 20 * DAY
  const start = resolveCatalogStartMs({
    ...base,
    timeframeMs: TF_1D,
    minStartMs: minStart,
    maxStartMs: maxStart,
  })
  assert.equal(start, maxStart - OVERLAP, 'should resume recent, not rescan from floor')
})

test('resume never precedes the floor', () => {
  // maxStart just above the floor → maxStart-overlap would dip below the floor
  const maxStart = FLOOR + 6 * 60 * 60 * 1000
  assert.equal(resolveCatalogStartMs({ ...base, minStartMs: FLOOR, maxStartMs: maxStart }), FLOOR)
})
