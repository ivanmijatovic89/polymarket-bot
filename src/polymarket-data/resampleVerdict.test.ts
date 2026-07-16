import test from 'node:test'
import assert from 'node:assert/strict'
import { resampleVerdict, type PositionKey } from './resampleVerdict.js'

const p = (wallet: string, asset: string): PositionKey => ({ wallet, asset })

const base = {
  storedRows: 100,
  liveRows: 100,
  storedPositions: [p('0xa', 't0'), p('0xb', 't1')],
  livePositions: [p('0xa', 't0'), p('0xb', 't1')],
  orphanWallets: 0,
}

test('identical sets → pass, no notes', () => {
  assert.deepEqual(resampleVerdict(base), { ok: true, notes: [] })
})

test('equal counts but different identities → fail', () => {
  // Stored has stale B/C, live has new A/C: both size 2, but A is missing.
  const v = resampleVerdict({
    ...base,
    storedPositions: [p('0xb', 't1'), p('0xc', 't2')],
    livePositions: [p('0xa', 't0'), p('0xc', 't2')],
  })
  assert.equal(v.ok, false)
  assert.match(v.notes.join(' '), /1 live position\(s\) missing from stored/)
  assert.match(v.notes.join(' '), /0xa\|t0/)
})

test('a live identity missing from stored → fail', () => {
  const v = resampleVerdict({ ...base, storedPositions: [p('0xa', 't0')] }) // missing 0xb|t1
  assert.equal(v.ok, false)
  assert.match(v.notes.join(' '), /missing from stored/)
})

test('stored-only stale identity → informational, not a failure', () => {
  // A wallet redeemed to zero and dropped from the live snapshot after sync.
  const v = resampleVerdict({ ...base, livePositions: [p('0xa', 't0')] }) // 0xb|t1 gone from live
  assert.equal(v.ok, true)
  assert.match(v.notes.join(' '), /not in live snapshot/)
})

test('wallet casing is normalized before comparison', () => {
  // Same wallets, different case in stored vs live — must be treated as equal.
  const v = resampleVerdict({
    ...base,
    storedPositions: [p('0xAbC', 't0')],
    livePositions: [p('0xabc', 't0')],
  })
  assert.deepEqual(v, { ok: true, notes: [] })
})

test('same wallet, different asset are distinct identities', () => {
  const v = resampleVerdict({
    ...base,
    storedPositions: [p('0xa', 't0')],
    livePositions: [p('0xa', 't1')],
  })
  assert.equal(v.ok, false)
  assert.match(v.notes.join(' '), /missing from stored/)
})

test('stored rows below live (capped lower bound) → fail', () => {
  const v = resampleVerdict({ ...base, storedRows: 90, liveRows: 100 })
  assert.equal(v.ok, false)
  assert.match(v.notes.join(' '), /missing trades/)
})

test('stored rows above live is fine (live is a capped lower bound)', () => {
  assert.equal(resampleVerdict({ ...base, storedRows: 5000, liveRows: 4000 }).ok, true)
})

test('orphan trade-wallets → fail', () => {
  const v = resampleVerdict({ ...base, orphanWallets: 3 })
  assert.equal(v.ok, false)
  assert.match(v.notes.join(' '), /3 trade-wallets missing from positions/)
})
