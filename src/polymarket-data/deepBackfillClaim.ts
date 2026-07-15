/**
 * Pure claim-state transitions for deep-backfill, split out so the atomic
 * `partial → processing` claim (and its release) is unit-testable without a DB.
 * The DB code in deep-backfill.ts implements exactly these transitions with
 * conditional SQL (`UPDATE … WHERE id=? AND trades_status='partial'`), so the
 * state machine has one authoritative definition that a test can exercise.
 *
 * deep-backfill is the recovery stage for markets left `partial` by the /trades
 * cap. Before this it selected partials and rebuilt them without claiming, so
 * two concurrent invocations could rebuild the same market at once — and a slow
 * one could overwrite a fast one's complete result with an incomplete snapshot.
 */
export type ClaimStatus = 'partial' | 'processing' | 'done'

/**
 * The atomic claim: only a `partial` market may be taken, and taking it moves it
 * to `processing`. Returns the new status when the claim is won, or null when
 * the row is not claimable (already `processing`/`done`) — the `affectedRows === 1`
 * vs `0` semantics of the conditional `UPDATE`.
 */
export function tryClaimPartial(current: ClaimStatus | undefined): 'processing' | null {
  return current === 'partial' ? 'processing' : null
}

/**
 * Release a claim we did not finish (abort / failure): a market we still own
 * (`processing`) goes back to `partial` so it is retried; a market that has since
 * moved on — an operator reset it, or it already finished — is left untouched, so
 * we never yank a row out from under a peer or un-finish a completed one.
 */
export function releaseIfOwned(current: ClaimStatus | undefined): ClaimStatus | undefined {
  return current === 'processing' ? 'partial' : current
}

/**
 * May we persist our reconstruction? Only while we still hold the claim. If the
 * row is no longer `processing`, a concurrent worker owns it (or it already
 * finished), and our possibly-stale/incomplete snapshot must NOT overwrite it.
 */
export function mayWriteReconstruction(current: ClaimStatus | undefined): boolean {
  return current === 'processing'
}

export type TradesStatus = 'pending' | 'processing' | 'partial' | 'done' | 'failed'

/**
 * How many markets to ATTEMPT this run: `--limit` if given, else all, but never
 * more than actually exist. Clamping matters because a reconstruction can
 * legitimately finish `partial` (still short) and so stay claimable — without a
 * fixed, clamped target set the same market could be re-claimed up to `--limit`
 * times (e.g. one partial market with `--limit 1000` → 1000 rebuilds).
 */
export function clampBudget(limit: number | null, total: number): number {
  return Math.min(limit ?? total, total)
}

/**
 * What to do with an explicitly named (`--slug`) market at a given status. A
 * named market is force-rerun from any terminal/pending state (it is claimed by
 * name on purpose), EXCEPT one that is actively `processing` — that claim belongs
 * to another worker and must not be stolen.
 */
export function namedRerunAction(status: TradesStatus): 'requeue' | 'skip-active' {
  return status === 'processing' ? 'skip-active' : 'requeue'
}

/**
 * Iterate a FIXED target set exactly once, claiming each atomically before
 * running it. A single pass is what guarantees "attempt each market at most once
 * per invocation": a market that `run` leaves `partial` is behind us in the list
 * and is never revisited, so it cannot starve markets we have not reached yet.
 *
 * Pure orchestration over injected effects, so the attempt-once/claim/release
 * behaviour is unit-testable without a DB. `claim` is the atomic
 * `partial → processing` (false = a peer won it → skip, do not run). `run` does
 * the reconstruction+write and throws on failure; on a throw the claim is
 * `release`d (back to `partial`, retryable) unless we are aborting, in which case
 * we release it and stop.
 */
export async function attemptTargets<M extends { id: number }>(
  targets: readonly M[],
  h: {
    aborted: () => boolean
    claim: (id: number) => Promise<boolean>
    run: (market: M) => Promise<void>
    release: (id: number) => Promise<void>
    onNotClaimed?: (market: M) => void
    onError?: (market: M, err: unknown) => void
  },
): Promise<{ attempted: number; claimed: number }> {
  let attempted = 0
  let claimed = 0
  for (const market of targets) {
    if (h.aborted()) break
    attempted += 1
    if (!(await h.claim(market.id))) {
      h.onNotClaimed?.(market)
      continue
    }
    claimed += 1
    try {
      await h.run(market)
    } catch (err) {
      await h.release(market.id)
      if (h.aborted()) break
      h.onError?.(market, err)
    }
  }
  return { attempted, claimed }
}
