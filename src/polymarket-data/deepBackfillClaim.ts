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

export type SlugSkipReason = 'skip-processing' | 'skip-open' | 'skip-unsettled' | 'skip-pending'
export type SlugDisposition = 'rerun' | SlugSkipReason

/**
 * The statuses that count as an attemptable "partial" market this run. Normally
 * just `partial`; under a `--reset-processing --dry-run` preview `processing` is
 * also included, because a real run resets those to `partial` first and then
 * attempts them — so the read-only preview must model that same set.
 */
export function attemptableStatuses(includeProcessing: boolean): TradesStatus[] {
  return includeProcessing ? ['partial', 'processing'] : ['partial']
}

/**
 * A market's status as the plan should SEE it. Under a `--reset-processing
 * --dry-run` preview a `processing` market is treated as `partial` (a real run
 * would have reset it first), so the dry-run plan matches what a real run
 * attempts instead of reporting it as `skip-processing`.
 */
export function effectiveResetStatus(status: TradesStatus, simulateReset: boolean): TradesStatus {
  return simulateReset && status === 'processing' ? 'partial' : status
}

/**
 * What to do with an explicitly named (`--slug`) market. Force-rerun applies ONLY
 * to a market that is closed, settled (past the min-close-age delay), and in a
 * terminal state (`done`/`partial`/`failed`). Everything else is skipped:
 *   - `processing` — a live worker owns the claim; never steal it;
 *   - not closed — the market is still open (an in-progress snapshot);
 *   - closed but within the settlement delay — fills may still be landing;
 *   - `pending` — not yet trade-synced; the trades stage must run first.
 * Without the closed/settled guards, `--slug <open>` would reconstruct an
 * in-progress market and mark it `done`, and later catalog refreshes never reset
 * the status, so its remaining fills would stay unsynced forever.
 */
export function classifySlugTarget(
  market: { status: TradesStatus; closed: boolean; marketEndMs: number },
  ctx: { nowMs: number; minCloseAgeMs: number },
): SlugDisposition {
  if (market.status === 'processing') return 'skip-processing'
  if (!market.closed) return 'skip-open'
  if (market.marketEndMs >= ctx.nowMs - ctx.minCloseAgeMs) return 'skip-unsettled'
  if (market.status === 'pending') return 'skip-pending'
  return 'rerun'
}

export type SlugRow = {
  id: number
  slug: string
  status: TradesStatus
  closed: boolean
  marketStartMs: number
  marketEndMs: number
}

export type SlugRerunPlan<R extends SlugRow> = {
  /** Bounded, ordered set to requeue → partial and then attempt. */
  targets: R[]
  /** Eligible for rerun but past `--limit` — left untouched this run. */
  beyondLimit: R[]
  /** Not rerunnable, with the reason (for reporting). */
  skipped: Array<{ row: R; reason: SlugSkipReason }>
}

/**
 * Resolve the bounded `--slug` rerun set from fetched rows, BEFORE any mutation:
 * classify each named market, order the eligible ones, and apply `--limit`. Only
 * `targets` should be requeued/attempted — so `--slug a,b,c --limit 1` downgrades
 * and rebuilds exactly one market, not all three. Pure, so this is unit-testable.
 */
export function planSlugRerun<R extends SlugRow>(
  rows: R[],
  opts: { latest: boolean; limit: number | null; nowMs: number; minCloseAgeMs: number },
): SlugRerunPlan<R> {
  const classified = rows.map((row) => ({ row, cls: classifySlugTarget(row, opts) }))
  const eligible = classified.filter((c) => c.cls === 'rerun').map((c) => c.row)
  const ordered = [...eligible].sort((a, b) =>
    opts.latest ? b.marketStartMs - a.marketStartMs : a.marketStartMs - b.marketStartMs,
  )
  const budget = clampBudget(opts.limit, ordered.length)
  const targets = ordered.slice(0, budget)
  const targetIds = new Set(targets.map((t) => t.id))
  return {
    targets,
    beyondLimit: ordered.filter((r) => !targetIds.has(r.id)),
    skipped: classified
      .filter((c) => c.cls !== 'rerun')
      .map((c) => ({ row: c.row, reason: c.cls as SlugSkipReason })),
  }
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
