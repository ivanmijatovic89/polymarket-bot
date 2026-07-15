import test from 'node:test'
import assert from 'node:assert/strict'
import { claimFromCandidates, claimNextOrConfirmEmpty } from '../db/claimQueue.js'
import {
  mayWriteReconstruction,
  releaseIfOwned,
  tryClaimPartial,
  type ClaimStatus,
} from './deepBackfillClaim.js'

test('tryClaimPartial: only a partial market is claimable', () => {
  assert.equal(tryClaimPartial('partial'), 'processing')
  assert.equal(tryClaimPartial('processing'), null) // a peer already holds it
  assert.equal(tryClaimPartial('done'), null) // already finished
  assert.equal(tryClaimPartial(undefined), null) // vanished
})

test('releaseIfOwned: only a processing row we own returns to partial', () => {
  assert.equal(releaseIfOwned('processing'), 'partial') // retryable
  assert.equal(releaseIfOwned('done'), 'done') // finished — never un-finish it
  assert.equal(releaseIfOwned('partial'), 'partial') // not ours — leave it
  assert.equal(releaseIfOwned(undefined), undefined)
})

test('mayWriteReconstruction: persist only while still processing', () => {
  assert.equal(mayWriteReconstruction('processing'), true)
  assert.equal(mayWriteReconstruction('done'), false) // a peer finished it first
  assert.equal(mayWriteReconstruction('partial'), false) // reset out from under us
  assert.equal(mayWriteReconstruction(undefined), false)
})

test('two concurrent workers never claim the same market twice', async () => {
  // In-memory model of polymarket_markets; the claim mirrors the SQL
  // `UPDATE … WHERE id=? AND trades_status='partial'` via tryClaimPartial, driven
  // by the SAME shared queue primitives the real code uses.
  const store = new Map<number, ClaimStatus>()
  for (let id = 1; id <= 50; id++) store.set(id, 'partial')

  const ac = new AbortController()

  const tryClaim = async (id: number): Promise<number | null> => {
    await Promise.resolve() // yield between read and write to force interleaving
    if (tryClaimPartial(store.get(id)) === null) return null
    store.set(id, 'processing')
    return id
  }

  const claimOne = () =>
    claimNextOrConfirmEmpty<number>({
      claim: async () => {
        const candidates = [...store.entries()].filter(([, s]) => s === 'partial').map(([id]) => id)
        if (candidates.length === 0) return null
        return claimFromCandidates(candidates, tryClaim)
      },
      countRemaining: async () => [...store.values()].filter((s) => s === 'partial').length,
      backoffMs: 0,
      signal: ac.signal,
    })

  const worker = async (): Promise<number[]> => {
    const mine: number[] = []
    for (;;) {
      const id = await claimOne()
      if (id === null) return mine
      mine.push(id)
      store.set(id, 'done') // "reconstructed" this market
    }
  }

  const [a, b] = await Promise.all([worker(), worker()])
  const claimed = [...a, ...b]

  assert.equal(claimed.length, 50, 'every market claimed exactly once — none lost')
  assert.equal(new Set(claimed).size, 50, 'no market claimed by both workers')
  assert.ok(
    [...store.values()].every((s) => s === 'done'),
    'queue fully drained',
  )
})

test('an interrupted claim is released back to partial for retry', async () => {
  // Worker claims, then aborts before finishing: releaseIfOwned puts it back so a
  // later run picks it up — and it does NOT touch a market that already finished.
  const store = new Map<number, ClaimStatus>([
    [1, 'partial'],
    [2, 'done'],
  ])

  // Claim #1.
  store.set(1, tryClaimPartial(store.get(1))!) // → processing
  assert.equal(store.get(1), 'processing')

  // Interrupted: release both the one we own and one that finished meanwhile.
  store.set(1, releaseIfOwned(store.get(1))!)
  store.set(2, releaseIfOwned(store.get(2))!)

  assert.equal(store.get(1), 'partial', 'our unfinished claim is retryable again')
  assert.equal(store.get(2), 'done', 'a finished market is left complete')
})
