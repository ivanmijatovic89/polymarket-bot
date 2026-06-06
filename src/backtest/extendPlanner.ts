/**
 * Plans a `backtest --extend <runId>` invocation.
 *
 * Pure planning — does not enqueue BullMQ or update the DB. The CLI calls
 * `planExtension` to get back the resolved parent run, the candidate slug
 * list, and the new batchUid; then it eagerly UPDATEs `backtest_runs` and
 * enqueues the flow. Kept separate so the (future) dashboard "Extend" button
 * can reuse the same planning logic via an API route.
 */

import {
  listEligibleTelonexMarkets,
  type Converter,
  type Market as TelonexMarket,
  type ReadFrom,
} from '../db/telonexMarkets.js'
import { getCoveredSlugsForRun, getRunForExtension, type ExtensibleRun } from '../db/backtests.js'
import { generateExtensionBatchUid } from './extendBatchUid.js'

export type ExtensionPlanOptions = {
  parentRunId: number
  /** Inclusive lower bound on `market_start_ms`. */
  fromMs?: number
  /** Inclusive upper bound on `market_start_ms`. */
  toMs?: number
  /** Cap the candidate set size. Without `--limit`, all uncovered markets in the filter are included. */
  limit?: number
  /** Pick newest-first instead of the default oldest-first. */
  latest?: boolean
  /** Pick randomly from the missing universe (overrides ordering). */
  random?: boolean
}

export type ExtensionPlan = {
  parent: ExtensibleRun
  /** Markets to run, already ordered per `latest` / `random` flags. */
  candidates: TelonexMarket[]
  /** Number of slugs the parent currently covers (== `marketsTotal` modulo failures). */
  parentCoveredCount: number
  /** Total eligible markets matching parent's universe + fromMs/toMs filter, regardless of coverage. */
  eligibleInRangeCount: number
  /** Number of uncovered markets after the fromMs/toMs filter (before --limit). */
  availableCount: number
  /** New batchUid for the BullMQ flow. */
  newBatchUid: string
}

/**
 * Outcome variants for ergonomic error handling — caller decides whether to
 * `console.error + process.exit` or surface as an HTTP error.
 */
export type ExtensionPlanResult =
  | { kind: 'ok'; plan: ExtensionPlan }
  | { kind: 'parent-not-found' }
  | { kind: 'parent-not-telonex'; inputMode: string | null }
  | { kind: 'parent-missing-metadata'; missing: string[] }
  | { kind: 'nothing-to-extend' }

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
  const coveredSet = await getCoveredSlugsForRun(parent.id)
  const excludeSlugs = coveredSet.size > 0 ? Array.from(coveredSet) : undefined

  // Centralised query: same source of truth used by the initial backtest
  // selection and the dashboard coverage view. excludeSlugs subtracts the
  // parent's covered set from the eligible universe.
  const candidates = await listEligibleTelonexMarkets({
    symbol: parent.symbol,
    timeframe: parent.timeframe,
    converter: parent.converter as Converter,
    readFrom: parent.readFrom as ReadFrom,
    ...(opts.fromMs !== undefined && { fromMs: opts.fromMs }),
    ...(opts.toMs !== undefined && { toMs: opts.toMs }),
    ...(excludeSlugs !== undefined && { excludeSlugs }),
    // Apply --limit / --latest / --random at the query layer so we don't
    // hydrate more rows than needed for large universes.
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.latest ? { latest: true } : {}),
    ...(opts.random ? { random: true } : {}),
  })

  // Drop rows that lack a dataset path (defensive — listEligibleTelonexMarkets
  // already enforces non-empty path via the readFrom filter, but the join can
  // theoretically return a null in pathological data states).
  const withDataset = candidates.filter((m) => m.dataset !== null && m.dataset.trim() !== '')

  if (withDataset.length === 0) {
    return { kind: 'nothing-to-extend' }
  }

  // Surface a couple of "context" counts for the pre-flight log. They cost
  // one extra query but make the operator-facing output meaningful.
  const eligibleInRangeCount = (
    await listEligibleTelonexMarkets({
      symbol: parent.symbol,
      timeframe: parent.timeframe,
      converter: parent.converter as Converter,
      readFrom: parent.readFrom as ReadFrom,
      ...(opts.fromMs !== undefined && { fromMs: opts.fromMs }),
      ...(opts.toMs !== undefined && { toMs: opts.toMs }),
      // No exclude / limit — we want the full denominator.
      limit: Number.MAX_SAFE_INTEGER,
    })
  ).length

  // `availableCount` = uncovered within filter, no --limit applied. If the
  // caller passed --limit, this tells them how many were truncated.
  const availableCount =
    opts.limit !== undefined
      ? (
          await listEligibleTelonexMarkets({
            symbol: parent.symbol,
            timeframe: parent.timeframe,
            converter: parent.converter as Converter,
            readFrom: parent.readFrom as ReadFrom,
            ...(opts.fromMs !== undefined && { fromMs: opts.fromMs }),
            ...(opts.toMs !== undefined && { toMs: opts.toMs }),
            ...(excludeSlugs !== undefined && { excludeSlugs }),
            limit: Number.MAX_SAFE_INTEGER,
          })
        ).length
      : withDataset.length

  return {
    kind: 'ok',
    plan: {
      parent,
      candidates: withDataset,
      parentCoveredCount: coveredSet.size,
      eligibleInRangeCount,
      availableCount,
      newBatchUid: generateExtensionBatchUid(parent.batchUid),
    },
  }
}
