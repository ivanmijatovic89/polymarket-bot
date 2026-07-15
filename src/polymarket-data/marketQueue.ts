/**
 * Shared MySQL work queue over `polymarket_markets`, used by the positions and
 * trades stages.
 *
 * Both stages have the same shape: claim a closed market that hasn't been
 * processed yet, hit the API, write its rows, mark it done. The only difference
 * is which status column they drive — so that column is a parameter.
 *
 * Claim protocol (same as the telonex download worker, which has survived heavy
 * multi-machine fan-out): read a batch of candidates with a single-status
 * predicate so the read stays on the `(status, market_start_ms)` index, then
 * race an atomic PK-keyed conditional UPDATE. `affectedRows === 1` means we won.
 * Deliberately not `FOR UPDATE SKIP LOCKED`: a locking scan locks the queue head
 * and serialises every worker behind it.
 */

import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { claimFromCandidates, claimNextOrConfirmEmpty } from '../db/claimQueue.js'
import {
  POLYMARKET_DATA_BACKFILL_FROM_MS,
  POLYMARKET_DATA_MIN_CLOSE_AGE_MS,
} from '../config/polymarketData.js'
import type { Timeframe } from './marketSeries.js'

const CLAIM_CANDIDATES = 100
const EMPTY_CLAIM_BACKOFF_MS = 500

/** Which stage's state column the queue drives. */
export type Stage = 'trades' | 'positions'

const STATUS_COLUMN: Record<Stage, string> = {
  trades: 'trades_status',
  positions: 'positions_status',
}

export type ClaimedMarket = {
  id: number
  conditionId: string
  slug: string
  symbol: string
  timeframe: Timeframe
  marketStartMs: number
  marketEndMs: number
  volumeGamma: number | null
}

export type QueueFilter = {
  symbol?: string
  timeframe?: Timeframe
  slugs?: string[]
  /** Take the newest eligible markets instead of the oldest. */
  latest?: boolean
}

/**
 * Which eligibility guards apply, as a pure plan so the rules are unit-testable.
 *
 * `closed` and settlement (`market_end_ms` past the min-close-age delay) are
 * ALWAYS required — a market must be finished and quiet before we snapshot its
 * trades/positions. `--slug` targets a market by name, so it bypasses
 * symbol/timeframe and the backfill FLOOR — but NOT those two guards. A
 * just-cataloged open market is `pending`; without them `--slug <open>` would
 * sync an in-progress snapshot and mark it `done`, and later catalog refreshes
 * update Gamma fields without resetting the sync status, so the remaining
 * fills/position changes would stay unsynced forever.
 */
export type EligibilityPlan = {
  requireClosed: boolean
  requireSettled: boolean
  requireBackfillFloor: boolean
  symbol?: string
  timeframe?: Timeframe
  slugs?: string[]
}

export function eligibilityPlan(filter: QueueFilter): EligibilityPlan {
  if (filter.slugs && filter.slugs.length > 0) {
    return {
      requireClosed: true,
      requireSettled: true,
      requireBackfillFloor: false,
      slugs: filter.slugs,
    }
  }
  return {
    requireClosed: true,
    requireSettled: true,
    requireBackfillFloor: true,
    ...(filter.symbol ? { symbol: filter.symbol } : {}),
    ...(filter.timeframe ? { timeframe: filter.timeframe } : {}),
  }
}

function eligibility(filter: QueueFilter): SQL {
  const plan = eligibilityPlan(filter)
  const clauses: SQL[] = []

  if (plan.requireClosed) clauses.push(sql`closed = 1`)
  if (plan.requireSettled)
    clauses.push(sql`market_end_ms < ${Date.now() - POLYMARKET_DATA_MIN_CLOSE_AGE_MS}`)
  if (plan.requireBackfillFloor)
    clauses.push(sql`market_start_ms >= ${POLYMARKET_DATA_BACKFILL_FROM_MS}`)
  if (plan.slugs && plan.slugs.length > 0)
    clauses.push(
      sql`slug IN (${sql.join(
        plan.slugs.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    )
  if (plan.symbol) clauses.push(sql`symbol = ${plan.symbol}`)
  if (plan.timeframe) clauses.push(sql`timeframe = ${plan.timeframe}`)

  return sql.join(clauses, sql` AND `)
}

type MarketRow = {
  id: number
  condition_id: string
  slug: string
  symbol: string
  timeframe: Timeframe
  market_start_ms: number | string
  market_end_ms: number | string
  volume_gamma: string | null
}

function toClaimedMarket(r: MarketRow): ClaimedMarket {
  return {
    id: Number(r.id),
    conditionId: r.condition_id,
    slug: r.slug,
    symbol: r.symbol,
    timeframe: r.timeframe,
    marketStartMs: Number(r.market_start_ms),
    marketEndMs: Number(r.market_end_ms),
    volumeGamma: r.volume_gamma === null ? null : Number(r.volume_gamma),
  }
}

export async function countPending(stage: Stage, filter: QueueFilter): Promise<number> {
  const db = getDb()
  const col = sql.raw(STATUS_COLUMN[stage])
  const rows = await db.execute(
    sql`SELECT COUNT(*) AS n FROM polymarket_markets
        WHERE ${col} = 'pending' AND ${eligibility(filter)}`,
  )
  const first = (rows as unknown as Array<Array<{ n: number | string }>>)[0]?.[0]
  return Number(first?.n ?? 0)
}

/**
 * Claim one market for `stage`, or null when the queue is genuinely drained.
 *
 * An empty claim is treated as contention, not drain, until a real COUNT
 * confirms zero — the bug that `claimNextOrConfirmEmpty` exists to prevent.
 */
export async function claimNextMarket(
  stage: Stage,
  filter: QueueFilter,
  signal: AbortSignal,
): Promise<ClaimedMarket | null> {
  const db = getDb()
  const col = sql.raw(STATUS_COLUMN[stage])
  const order = filter.latest ? sql`DESC` : sql`ASC`

  return claimNextOrConfirmEmpty<ClaimedMarket>({
    claim: async () => {
      const res = await db.execute(
        sql`SELECT id, condition_id, slug, symbol, timeframe, market_start_ms, market_end_ms, volume_gamma
            FROM polymarket_markets
            WHERE ${col} = 'pending' AND ${eligibility(filter)}
            ORDER BY market_start_ms ${order}
            LIMIT ${CLAIM_CANDIDATES}`,
      )
      const candidates = ((res as unknown as MarketRow[][])[0] ?? []).map(toClaimedMarket)
      if (candidates.length === 0) return null

      return claimFromCandidates(candidates, async (market) => {
        const upd = await db.execute(
          sql`UPDATE polymarket_markets SET ${col} = 'processing'
              WHERE id = ${market.id} AND ${col} = 'pending'`,
        )
        const affected = (upd as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
        return affected === 1 ? market : null
      })
    },
    countRemaining: () => countPending(stage, filter),
    backoffMs: EMPTY_CLAIM_BACKOFF_MS,
    signal,
  })
}

/**
 * Return this process's in-flight claims to `pending` on shutdown.
 *
 * Only our own ids — reverting by predicate would clobber the claims of peer
 * processes fanned out against the same DB.
 */
export async function revertOwnedClaims(stage: Stage, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const db = getDb()
  const col = sql.raw(STATUS_COLUMN[stage])
  const res = await db.execute(
    sql`UPDATE polymarket_markets SET ${col} = 'pending'
        WHERE ${col} = 'processing'
          AND id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
  )
  return (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
}

/**
 * Flip terminal-but-incomplete rows back to `pending` so the normal loop picks
 * them up. `processing` is included only via `--reset-processing`, which is
 * unsafe while other workers are running (their claims would be stolen) and is
 * therefore an explicit opt-in for crash recovery.
 */
export async function requeue(
  stage: Stage,
  statuses: Array<'failed' | 'partial' | 'processing' | 'done'>,
  filter: QueueFilter,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<number> {
  if (statuses.length === 0) return 0
  const db = getDb()
  const col = sql.raw(STATUS_COLUMN[stage])
  const where = sql`${col} IN (${sql.join(
    statuses.map((s) => sql`${s}`),
    sql`, `,
  )}) AND ${eligibility(filter)}`

  // Under --dry-run report the count that WOULD move; never write.
  if (dryRun) {
    const res = await db.execute(sql`SELECT COUNT(*) AS n FROM polymarket_markets WHERE ${where}`)
    return Number((res as unknown as Array<Array<{ n: number }>>)[0]?.[0]?.n ?? 0)
  }
  const res = await db.execute(sql`UPDATE polymarket_markets SET ${col} = 'pending' WHERE ${where}`)
  return (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
}

export async function markFailed(stage: Stage, id: number, error: string): Promise<void> {
  const db = getDb()
  const col = sql.raw(STATUS_COLUMN[stage])
  const errCol = sql.raw(stage === 'trades' ? 'trades_error' : 'positions_error')
  await db.execute(
    sql`UPDATE polymarket_markets SET ${col} = 'failed', ${errCol} = ${error.slice(0, 1000)}
        WHERE id = ${id}`,
  )
}

/** Progress accounting shared by the workers of one process. */
export class ProgressTracker {
  private done = 0
  private failed = 0
  private readonly startedAtMs = Date.now()

  constructor(
    private readonly label: string,
    private readonly total: number,
  ) {}

  record(ok: boolean): void {
    if (ok) this.done += 1
    else this.failed += 1
  }

  line(extra: string): string {
    const processed = this.done + this.failed
    const elapsedS = (Date.now() - this.startedAtMs) / 1000
    const rate = elapsedS > 0 ? processed / elapsedS : 0
    const remaining = Math.max(0, this.total - processed)
    const etaS = rate > 0 ? remaining / rate : 0
    return (
      `${this.label} ${processed}/${this.total} ` +
      `(ok=${this.done} failed=${this.failed}) ` +
      `${rate.toFixed(2)}/s eta=${fmtDuration(etaS * 1000)} ${extra}`
    )
  }

  summary(): { done: number; failed: number; elapsedMs: number } {
    return { done: this.done, failed: this.failed, elapsedMs: Date.now() - this.startedAtMs }
  }
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
