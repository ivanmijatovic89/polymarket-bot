import test from 'node:test'
import assert from 'node:assert/strict'
import { assertRawFilesCoverWindow } from './convert.js'

// btc-updown-15m-1784646000 → window 2026-07-21T15:00..15:15 UTC (one day)
const MID_DAY = 'btc-updown-15m-1784646000'
// btc-updown-15m-1784677500 → window 2026-07-21T23:45..2026-07-22T00:00 UTC
// (ends exactly at midnight — the window day is still only 07-21)
const ENDS_AT_MIDNIGHT = 'btc-updown-15m-1784677500'
// btc-updown-1h-1784675700 → window 2026-07-21T23:15..2026-07-22T00:15 UTC (two days)
const CROSSES_MIDNIGHT = 'btc-updown-1h-1784675700'

test('passes when the window day is covered', () => {
  assertRawFilesCoverWindow(MID_DAY, ['2026-07-20', '2026-07-21'])
  assertRawFilesCoverWindow(MID_DAY, ['2026-07-21'])
})

test('throws when only the creation day exists (the 2026-07 incident shape)', () => {
  assert.throws(
    () => assertRawFilesCoverWindow(MID_DAY, ['2026-07-20']),
    /missing day file\(s\) 2026-07-21/,
  )
})

test('throws when there are no files at all', () => {
  assert.throws(() => assertRawFilesCoverWindow(MID_DAY, []), /have: none/)
})

test('window ending exactly at midnight needs only its own day', () => {
  assertRawFilesCoverWindow(ENDS_AT_MIDNIGHT, ['2026-07-21'])
})

test('window crossing midnight needs both days', () => {
  assert.throws(
    () => assertRawFilesCoverWindow(CROSSES_MIDNIGHT, ['2026-07-21']),
    /missing day file\(s\) 2026-07-22/,
  )
  assertRawFilesCoverWindow(CROSSES_MIDNIGHT, ['2026-07-21', '2026-07-22'])
})

test('unparseable slugs are not blocked', () => {
  assertRawFilesCoverWindow('some-other-market', [])
})
