/**
 * Plans a `backtest --extend <runId>` invocation.
 *
 * Pure planning — does not enqueue BullMQ or update the DB. The CLI calls
 * `planExtension` to get back the resolved parent run, the candidate slug
 * list, and the new batchUid; then it eagerly UPDATEs `backtest_runs` and
 * enqueues the flow. Kept separate so the (future) dashboard "Extend" button
 * can reuse the same planning logic via an API route.
 *
 * Direction semantics (the part that's easy to get wrong):
 *
 *   - **Default** (no `--latest`, no `--from-ms`/`--to-ms`): extend
 *     BACKWARD in time from the covered set. Candidate set is
 *     `eligible[market_start_ms < min(covered.market_start_ms)]`,
 *     ordered DESC and capped by `--limit`. That gives "the N markets
 *     immediately before what the parent already ran", matching the
 *     mental model of "I ran --latest 6000; extend it backward to grow
 *     coverage into older history".
 *
 *   - **`--latest`**: extend FORWARD in time from the covered set.
 *     Candidate set is `eligible[market_start_ms > max(covered.market_start_ms)]`,
 *     ordered DESC. Useful after Telonex syncs new markets that the
 *     parent run missed.
 *
 *   - **`--from-ms` and/or `--to-ms`**: the user is being explicit
 *     about the time window. Auto-direction is skipped entirely — the
 *     candidate set is just `eligible \ covered` filtered by the range.
 *
 * The returned `candidates` array is sorted by `market_start_ms ASC`
 * (chronological order) regardless of which direction was used, so the
 * BullMQ child jobs and per-market log lines progress in time order.
 */

import {
  countEligibleTelonexMarkets,
  listEligibleTelonexMarkets,
  type Converter,
  type Market as TelonexMarket,
  type ReadFrom,
} from '../db/telonexMarkets.js'
import {
  getCoveredRangeForRun,
  getCoveredSlugsForRun,
  getRunForExtension,
  type ExtensibleRun,
} from '../db/backtests.js'
import { generateExtensionBatchUid } from './extendBatchUid.js'

export type ExtensionPlanOptions = {
  parentRunId: number
  /** Inclusive lower bound on `market_start_ms`. Disables auto-direction. */
  fromMs?: number
  /** Inclusive upper bound on `market_start_ms`. Disables auto-direction. */
  toMs?: number
  /** Cap the candidate set size. Without `--limit`, all matching uncovered markets are included. */
  limit?: number
  /** Switch from default BACKWARD (before covered) to FORWARD (after covered). */
  latest?: boolean
  /** Pick randomly from the missing universe (overrides any direction). */
  random?: boolean
}

export type ExtensionDirection = 'backward' | 'forward' | 'explicit-range' | 'random'

export type ExtensionPlan = {
  parent: ExtensibleRun
  /** Markets to run, sorted by `market_start_ms` ASC for chronological replay. */
  candidates: TelonexMarket[]
  /** Number of slugs the parent currently covers (== `marketsTotal` modulo failures). */
  parentCoveredCount: number
  /**
   * Total eligible markets matching `(symbol, timeframe, converter, readFrom)`
   * + the eligibility floor, ignoring coverage. Denominator for the pre-flight log.
   */
  eligibleTotal: number
  /** How many uncovered markets are available in the chosen direction (before --limit). */
  availableCount: number
  /** Which direction the planner chose. */
  direction: ExtensionDirection
  /** New batchUid for the BullMQ flow. */
  newBatchUid: string
}

export type ExtensionPlanResult =
  | { kind: 'ok'; plan: ExtensionPlan }
  | { kind: 'parent-not-found' }
  | { kind: 'parent-not-telonex'; inputMode: string | null }
  | { kind: 'parent-missing-metadata'; missing: string[] }
  | { kind: 'extend-in-progress'; since: Date }
  | { kind: 'nothing-to-extend'; direction: ExtensionDirection; hint: string }

export async function planExtension(opts: ExtensionPlanOptions): Promise<ExtensionPlanResult> {
  const lookup = await getRunForExtension(opts.parentRunId)
  if (lookup.kind === 'not-found') return { kind: 'parent-not-found' }
  if (lookup.kind === 'not-telonex') {
    return { kind: 'parent-not-telonex', inputMode: lookup.inputMode }
  }
  if (lookup.kind === 'missing-metadata') {
    return { kind: 'parent-missing-metadata', missing: lookup.missing }
  }

  const parent = lookup.run
  if (parent.extendingAt !== null) {
    return { kind: 'extend-in-progress', since: parent.extendingAt }
  }

  const coveredSet = await getCoveredSlugsForRun(parent.id)
  const excludeSlugs = coveredSet.size > 0 ? Array.from(coveredSet) : undefined

  // Resolve direction + auto fromMs/toMs.
  const explicitRange = opts.fromMs !== undefined || opts.toMs !== undefined
  let direction: ExtensionDirection
  if (opts.random) direction = 'random'
  else if (explicitRange) direction = 'explicit-range'
  else if (opts.latest) direction = 'forward'
  else direction = 'backward'

  let effectiveFromMs: number | undefined = opts.fromMs
  let effectiveToMs: number | undefined = opts.toMs

  if (direction === 'backward' || direction === 'forward') {
    const range = await getCoveredRangeForRun(parent.id)
    if (range.minMs === null || range.maxMs === null) {
      // Parent has zero covered markets (unusual — pre-completion or
      // explicit-skip parent). Default direction has no anchor; fall back
      // to "everything uncovered" sorted accordingly.
      // We leave fromMs/toMs as user-supplied (both undefined here).
    } else if (direction === 'backward') {
      // Exclusive upper bound: just before the oldest covered market.
      effectiveToMs = range.minMs - 1
    } else {
      // direction === 'forward': just after the newest covered market.
      effectiveFromMs = range.maxMs + 1
    }
  }

  const baseQueryOpts = {
    symbol: parent.symbol,
    timeframe: parent.timeframe,
    converter: parent.converter as Converter,
    readFrom: parent.readFrom as ReadFrom,
  } as const

  // Pick markets closest to the covered edge — that's the intuitive
  // "extend the contiguous block" behaviour the user expects:
  //   backward → newest of the older-uncovered region (immediately before covered)
  //   forward  → oldest of the newer-uncovered region (immediately after covered)
  //   explicit-range → oldest-in-range (chronological)
  //   random   → random
  //
  // listEligibleTelonexMarkets's `latest: true` flag sorts DESC and then
  // takes the top-N, which is what backward wants. For forward we want
  // oldest-first (ASC), which is the default order.
  const pickFromEnd = opts.random
    ? { random: true as const }
    : direction === 'backward'
      ? { latest: true as const }
      : {} // forward / explicit-range → ASC (default)

  // listEligibleTelonexMarkets defaults `limit` to 1000 when omitted, so
  // an unlimited extend would silently truncate. Pass an explicit large
  // ceiling when --limit was not provided — this contract is documented at
  // the top of planExtension: "Without --limit, all matching uncovered
  // markets are included."
  const effectiveLimit = opts.limit ?? Number.MAX_SAFE_INTEGER
  const candidates = await listEligibleTelonexMarkets({
    ...baseQueryOpts,
    ...(effectiveFromMs !== undefined && { fromMs: effectiveFromMs }),
    ...(effectiveToMs !== undefined && { toMs: effectiveToMs }),
    ...(excludeSlugs !== undefined && { excludeSlugs }),
    limit: effectiveLimit,
    ...pickFromEnd,
  })

  const withDataset = candidates.filter((m) => m.dataset !== null && m.dataset.trim() !== '')

  if (withDataset.length === 0) {
    const hint = directionHint(direction)
    return { kind: 'nothing-to-extend', direction, hint }
  }

  // Re-sort to chronological for replay (listEligibleTelonexMarkets returned
  // them DESC for the limit step; replay expects ASC by market_start_ms).
  if (!opts.random) {
    withDataset.sort((a, b) => a.marketStartMs - b.marketStartMs)
  }

  // Denominators for the pre-flight log. Use the COUNT(*) helper per the
  // CLAUDE.md single-source-of-truth contract for telonex eligibility, and
  // avoid hydrating the full Market rows just to call .length on them.
  // Both counts are independent — run in parallel.
  const [eligibleTotal, availableCount] = await Promise.all([
    countEligibleTelonexMarkets(baseQueryOpts),
    opts.limit !== undefined
      ? countEligibleTelonexMarkets({
          ...baseQueryOpts,
          ...(effectiveFromMs !== undefined && { fromMs: effectiveFromMs }),
          ...(effectiveToMs !== undefined && { toMs: effectiveToMs }),
          ...(excludeSlugs !== undefined && { excludeSlugs }),
        })
      : Promise.resolve(withDataset.length),
  ])

  return {
    kind: 'ok',
    plan: {
      parent,
      candidates: withDataset,
      parentCoveredCount: coveredSet.size,
      eligibleTotal,
      availableCount,
      direction,
      newBatchUid: generateExtensionBatchUid(parent.batchUid),
    },
  }
}

function directionHint(direction: ExtensionDirection): string {
  switch (direction) {
    case 'backward':
      return 'No uncovered markets exist before the parent run. Try --latest to extend forward, or pass --from-ms/--to-ms for an explicit range.'
    case 'forward':
      return 'No uncovered markets exist after the parent run. (Default direction is backward; drop --latest to extend before covered.)'
    case 'explicit-range':
      return 'No uncovered markets exist within the requested --from-ms/--to-ms window.'
    case 'random':
      return 'No uncovered markets match the filter to sample from.'
  }
}
