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
