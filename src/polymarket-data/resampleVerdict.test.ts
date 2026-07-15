import test from 'node:test'
import assert from 'node:assert/strict'
import { resampleVerdict } from './resampleVerdict.js'

const base = {
  storedRows: 100,
  liveRows: 100,
  storedPositions: 50,
  livePositions: 50,
  orphanWallets: 0,
}

test('everything matches → ok, no notes', () => {
  assert.deepEqual(resampleVerdict(base), { ok: true, notes: [] })
})

test('stored rows below live (capped lower bound) → fail', () => {
  const v = resampleVerdict({ ...base, storedRows: 90, liveRows: 100 })
  assert.equal(v.ok, false)
  assert.match(v.notes.join(' '), /missing trades/)
})

test('stored positions below live → fail (missing participants)', () => {
  // The regression this fixes: the resample printed a positions mismatch with a
  // checkmark. A stored count below the complete live count is a real gap.
  const v = resampleVerdict({ ...base, storedPositions: 48, livePositions: 50 })
  assert.equal(v.ok, false)
  assert.match(v.notes.join(' '), /missing participants/)
})

test('stored positions above live → note only, not a failure (post-sync redemption)', () => {
  const v = resampleVerdict({ ...base, storedPositions: 52, livePositions: 50 })
  assert.equal(v.ok, true)
  assert.match(v.notes.join(' '), /positions changed since sync/)
})

test('orphan trade-wallets → fail', () => {
  const v = resampleVerdict({ ...base, orphanWallets: 3 })
  assert.equal(v.ok, false)
  assert.match(v.notes.join(' '), /3 trade-wallets missing from positions/)
})

test('stored rows above live is fine (live is a capped lower bound)', () => {
  assert.equal(resampleVerdict({ ...base, storedRows: 5000, liveRows: 4000 }).ok, true)
})
