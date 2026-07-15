/**
 * Where a (symbol, timeframe) catalog scan should start. Pure and dependency-free
 * so the incremental-vs-extend decision is unit-testable in isolation (the
 * sync-markets CLI self-executes on import, so this can't live there).
 *
 * Rules, in order:
 *  - explicit `--from` wins.
 *  - `--full` rescans from the floor.
 *  - empty series → the floor.
 *  - **floor moved earlier than our history** → scan from the floor. Detected by
 *    the earliest stored market sitting more than one timeframe interval after
 *    the floor: for continuous markets the earliest start is essentially the
 *    floor, so a real gap there means the floor was lowered (or early history is
 *    genuinely missing). Scanning from the floor re-pages already-held markets
 *    (idempotent upsert) but guarantees the newly-requested older range is
 *    discovered instead of silently skipped.
 *  - otherwise resume just behind the newest market (the efficient common case).
 */
export function resolveCatalogStartMs(opts: {
  fromMs?: number
  full: boolean
  floorMs: number
  minStartMs: number | null
  maxStartMs: number | null
  timeframeMs: number
  resumeOverlapMs: number
}): number {
  if (opts.fromMs !== undefined) return opts.fromMs
  if (opts.full) return opts.floorMs
  if (opts.maxStartMs === null || opts.minStartMs === null) return opts.floorMs
  if (opts.minStartMs - opts.floorMs > opts.timeframeMs) return opts.floorMs
  return Math.max(opts.floorMs, opts.maxStartMs - opts.resumeOverlapMs)
}
