import test from 'node:test'
import assert from 'node:assert/strict'
import { claimFromCandidates, claimNextOrConfirmEmpty } from '../db/claimQueue.js'
import {
  attemptTargets,
  clampBudget,
  mayWriteReconstruction,
  namedRerunAction,
  releaseIfOwned,
  tryClaimPartial,
  type ClaimStatus,
  type TradesStatus,
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

test('clampBudget: never exceeds the markets that exist', () => {
  assert.equal(clampBudget(1000, 1), 1, 'one partial market + --limit 1000 → attempt it once')
  assert.equal(clampBudget(null, 5), 5, 'no --limit → all markets')
  assert.equal(clampBudget(3, 5), 3, '--limit below total is respected')
  assert.equal(clampBudget(0, 5), 0)
})

test('namedRerunAction: force rerun from any state except active processing', () => {
  const rerun: TradesStatus[] = ['pending', 'partial', 'done', 'failed']
  for (const s of rerun) assert.equal(namedRerunAction(s), 'requeue', s)
  assert.equal(namedRerunAction('processing'), 'skip-active', 'never steal a live claim')
})

// A tiny in-memory harness modelling attemptTargets over a status store, so the
// "attempt each market once" and claim/release behaviour is testable end-to-end.
function harness(initial: Array<[number, ClaimStatus]>) {
  const store = new Map<number, ClaimStatus>(initial)
  return {
    store,
    claim: async (id: number) => {
      if (tryClaimPartial(store.get(id)) === null) return false
      store.set(id, 'processing')
      return true
    },
    release: async (id: number) => {
      store.set(id, releaseIfOwned(store.get(id)) as ClaimStatus)
    },
  }
}

test('a market that finishes partial is attempted once; others still run', async () => {
  // The regression: a reconstruction that stays `partial` used to be re-claimed
  // over and over (one market, --limit 1000 → 1000 rebuilds), starving the rest.
  const h = harness([
    [1, 'partial'],
    [2, 'partial'],
    [3, 'partial'],
  ])
  const runs = new Map<number, number>()
  const targets = [{ id: 1 }, { id: 2 }, { id: 3 }]

  const res = await attemptTargets(targets, {
    aborted: () => false,
    claim: h.claim,
    release: h.release,
    run: async (m) => {
      runs.set(m.id, (runs.get(m.id) ?? 0) + 1)
      h.store.set(m.id, 'partial') // reconstruction still short → stays partial
    },
  })

  assert.equal(res.attempted, 3)
  assert.equal(res.claimed, 3)
  assert.deepEqual([...runs.entries()].sort(), [
    [1, 1],
    [2, 1],
    [3, 1],
  ])
  assert.ok(
    [...runs.values()].every((c) => c === 1),
    'each market run exactly once despite ending partial (no re-claim, no starvation)',
  )
})

test('a market a peer already holds is skipped; the rest still run', async () => {
  const h = harness([
    [1, 'partial'],
    [2, 'processing'], // a peer owns #2
    [3, 'partial'],
  ])
  const ran: number[] = []

  const res = await attemptTargets([{ id: 1 }, { id: 2 }, { id: 3 }], {
    aborted: () => false,
    claim: h.claim,
    release: h.release,
    run: async (m) => {
      ran.push(m.id)
      h.store.set(m.id, 'done')
    },
  })

  assert.equal(res.attempted, 3, 'every target attempted once')
  assert.equal(res.claimed, 2, 'the peer-held market was not claimed')
  assert.deepEqual(ran.sort(), [1, 3])
  assert.equal(h.store.get(2), 'processing', "peer's claim untouched")
})

test('a failed run releases the claim back to partial; an abort stops the pass', async () => {
  const h = harness([
    [1, 'partial'],
    [2, 'partial'],
    [3, 'partial'],
  ])
  const ran: number[] = []

  // #2 throws (real failure) → released to partial; #1 and #3 still run.
  const res = await attemptTargets([{ id: 1 }, { id: 2 }, { id: 3 }], {
    aborted: () => false,
    claim: h.claim,
    release: h.release,
    run: async (m) => {
      ran.push(m.id)
      if (m.id === 2) throw new Error('boom')
      h.store.set(m.id, 'done')
    },
  })
  assert.deepEqual(ran.sort(), [1, 2, 3])
  assert.equal(res.claimed, 3)
  assert.equal(h.store.get(2), 'partial', 'failed market is retryable')

  // Abort mid-pass: the in-flight claim is released and iteration stops.
  const h2 = harness([
    [10, 'partial'],
    [11, 'partial'],
  ])
  let aborted = false
  const res2 = await attemptTargets([{ id: 10 }, { id: 11 }], {
    aborted: () => aborted,
    claim: h2.claim,
    release: h2.release,
    run: async () => {
      aborted = true // simulate SIGINT during this market
      throw new Error('aborted fetch')
    },
  })
  assert.equal(res2.attempted, 1, 'stopped after the aborted market')
  assert.equal(h2.store.get(10), 'partial', 'the interrupted claim was released')
  assert.equal(h2.store.get(11), 'partial', 'the untouched market is still pending work')
})
