/**
 * Generates a unique batchUid for an extension batch.
 *
 * Each `--extend <runId>` invocation must produce a fresh BullMQ batch
 * (unique flow id). After the extension completes, the parent run's
 * `backtest_runs.batch_uid` is updated to this new value — so the latest
 * batchUid always identifies the most recent extend event.
 *
 * Convention: replace any trailing `-ext<N>` suffix with `-ext<N+1>`. If
 * there is no existing suffix, append `-ext1`.
 *
 *   "v5-500"               -> "v5-500-ext1"
 *   "v5-500-ext1"          -> "v5-500-ext2"
 *   "v5-500-ext2"          -> "v5-500-ext3"
 *
 * Replace (rather than append) keeps the suffix bounded — the string never
 * grows unbounded across many extends, which matters because
 * `backtest_runs.batch_uid` is VARCHAR(255).
 *
 * This is a placeholder convention. If a more descriptive scheme is
 * desired later (e.g. cumulative market counts, phase tags), swap the
 * implementation here — callers don't need to change.
 *
 * Pure function. No DB, no Redis. Easily unit-testable.
 */
export function generateExtensionBatchUid(parentBatchUid: string): string {
  if (typeof parentBatchUid !== 'string' || parentBatchUid.trim() === '') {
    throw new Error(
      `[extendBatchUid] parentBatchUid must be a non-empty string (got: ${String(parentBatchUid)})`,
    )
  }

  const m = parentBatchUid.match(/^(.+)-ext(\d+)$/)
  if (m) {
    const base = m[1]!
    const n = Number(m[2])
    if (!Number.isFinite(n) || n < 0) {
      // Pathological suffix (e.g. `-extNaN`) — treat as if no suffix.
      return `${parentBatchUid}-ext1`
    }
    return `${base}-ext${n + 1}`
  }
  return `${parentBatchUid}-ext1`
}
