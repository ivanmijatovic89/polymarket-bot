#!/usr/bin/env tsx
/**
 * polymarket-data deep-backfill (stage 5): rebuild the complete trade set for
 * markets that the `/trades` offset cap cannot fully expose.
 *
 * This is NOT a rare edge case. `/trades` can reach 4,000 rows per query combo
 * (offset ≤ 3000 + limit 1000), 8,000 with the BUY/SELL split — but a busy 15m
 * market can exceed 4,000 rows on a single side. Measured on a real BTC 15m
 * sample: ~12% of markets came back `partial`, and those were missing ~12% of
 * their volume. Without this stage the dataset would be quietly incomplete
 * exactly where the action is.
 *
 * How it escapes the cap: `/trades` supports `user` + `market`, so a capped
 * market is partitioned by its complete position-participant set. This keeps
 * the canonical per-fill representation and avoids `/activity`'s overlapping
 * pagination and aggregated taker rows. Measured on two BTC daily markets, the
 * partitioned result reproduced Gamma volume exactly (7,660 and 13,221 rows).
 *
 *   participants (positions ∪ known trades) → per-wallet /trades?takerOnly=false
 *   → whole-market replace → trades_source='deep-backfill'
 *
 * Usage:
 *   npm run polymarket-data:deep-backfill -- [--symbol btc] [--timeframe 15m]
 *       [--slug a,b] [--limit N] [--concurrency N] [--wallet-concurrency N]
 *       [--reset-processing] [--dry-run]
 *
 * Markets are claimed atomically (partial→processing) so two concurrent
 * invocations never rebuild the same market. A hard kill can strand a claim in
 * `processing`; recover it with --reset-processing (only when no peers run).
 */

import '../config/env.js'
import { sql, type SQL } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index.js'
import { withDeadlockRetry } from '../db/txRetry.js'
import { shuffleInPlace } from '../db/claimQueue.js'
import { POLYMARKET_DATA_TRADES_RPS } from '../config/polymarketData.js'
import { RateLimiter } from './rateLimiter.js'
import { fetchActivityTimeSliced } from './activityApi.js'
import {
  fetchMarketPositions,
  fetchMarketTakerTrades,
  fetchWalletTakerTrades,
  fetchWalletTrades,
  type ApiTrade,
} from './dataApi.js'
import { fmtDuration, ProgressTracker } from './marketQueue.js'
import { buildTradeRows, tradeCompleteness, type BuildResult, type TradeRow } from './tradeRows.js'
import { parseSyncArgs, type SyncArgs } from './syncArgs.js'
import {
  attemptableStatuses,
  attemptTargets,
  clampBudget,
  effectiveResetStatus,
  mayWriteReconstruction,
  planSlugRerun,
  type ClaimStatus,
  type SlugRow,
  type SlugSkipReason,
  type TradesStatus,
} from './deepBackfillClaim.js'
import { POLYMARKET_DATA_MIN_CLOSE_AGE_MS } from '../config/polymarketData.js'
import { upsertWallets } from './walletUpsert.js'
import {
  marketParticipants,
  marketPositionParticipants,
  marketVerification,
  writeMarketTrades,
} from './storage/parquetFacts.js'
import { assertMarketSnapshot } from './marketSnapshotVerification.js'
import { reconstructOverflowWalletTrades } from './overflowWalletTrades.js'

const LABEL = '[polymarket-data:deep-backfill]'
const DEFAULT_WALLET_CONCURRENCY = 8

type PartialMarket = {
  id: number
  conditionId: string
  slug: string
  symbol: string
  timeframe: string
  marketStartMs: number
  marketEndMs: number
  createdMs: number
  volumeGamma: number | null
  tradeRows: number | null
}

function rowToPartial(r: Record<string, unknown>): PartialMarket {
  let raw = r.raw_json
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown
    } catch {
      raw = null
    }
  }
  const createdAt =
    raw && typeof raw === 'object' && 'createdAt' in raw
      ? String((raw as { createdAt?: unknown }).createdAt ?? '')
      : ''
  const parsedCreatedMs = Date.parse(createdAt)
  const marketStartMs = Number(r.market_start_ms)
  return {
    id: Number(r.id),
    conditionId: String(r.condition_id),
    slug: String(r.slug),
    symbol: String(r.symbol),
    timeframe: String(r.timeframe),
    marketStartMs,
    marketEndMs: Number(r.market_end_ms),
    createdMs: Number.isFinite(parsedCreatedMs)
      ? parsedCreatedMs
      : marketStartMs - 7 * 24 * 60 * 60 * 1000,
    volumeGamma: r.volume_gamma === null ? null : Number(r.volume_gamma),
    tradeRows: r.trade_rows === null ? null : Number(r.trade_rows),
  }
}

/**
 * Market-selection filters, WITHOUT the status clause (that varies by caller:
 * the claim wants `partial`, the reset wants `processing`). `--slug` overrides
 * symbol/timeframe entirely so a single market can always be re-run by name.
 */
function eligibility(args: SyncArgs): SQL {
  if (args.slugs && args.slugs.length > 0) {
    return sql`slug IN (${sql.join(
      args.slugs.map((s) => sql`${s}`),
      sql`, `,
    )})`
  }
  const clauses: SQL[] = []
  if (args.symbol) clauses.push(sql`symbol = ${args.symbol}`)
  if (args.timeframe) clauses.push(sql`timeframe = ${args.timeframe}`)
  return clauses.length > 0 ? sql.join(clauses, sql` AND `) : sql`1 = 1`
}

/**
 * Which statuses count as "a partial market to attempt". Normally just `partial`;
 * under a `--reset-processing --dry-run` preview we also treat `processing` as
 * claimable, because a real run would reset those to `partial` first and then
 * attempt them — so the dry-run plan must model that hypothetical state (while
 * staying read-only). A real reset run has already mutated them, so it does not
 * pass this flag.
 */
function partialStatusClause(includeProcessing: boolean): SQL {
  const statuses = attemptableStatuses(includeProcessing)
  return sql`trades_status IN (${sql.join(
    statuses.map((s) => sql`${s}`),
    sql`, `,
  )})`
}

/**
 * The FIXED set of markets to attempt this run (at most `limit`), ordered
 * deterministically. Iterated once by the claim loop, so each market is attempted
 * at most once even if a reconstruction leaves it `partial` again. Also serves
 * the dry-run listing (read-only, no claim).
 */
async function selectPartialMarkets(
  args: SyncArgs,
  limit: number,
  includeProcessing = false,
): Promise<PartialMarket[]> {
  const db = getDb()
  const res = await db.execute(
    sql`SELECT id, condition_id, slug, symbol, timeframe, market_start_ms, market_end_ms, volume_gamma, trade_rows,
               raw_json
        FROM polymarket_markets
        WHERE ${partialStatusClause(includeProcessing)} AND ${eligibility(args)}
        ORDER BY market_start_ms ${args.latest ? sql`DESC` : sql`ASC`}
        LIMIT ${limit}`,
  )
  const rows = (res as unknown as Array<Record<string, unknown>>[])[0] ?? []
  return rows.map(rowToPartial)
}

async function countPartial(args: SyncArgs, includeProcessing = false): Promise<number> {
  const db = getDb()
  const res = await db.execute(
    sql`SELECT COUNT(*) AS n FROM polymarket_markets
        WHERE ${partialStatusClause(includeProcessing)} AND ${eligibility(args)}`,
  )
  return Number((res as unknown as Array<Array<{ n: number | string }>>)[0]?.[0]?.n ?? 0)
}

/**
 * Atomically claim one specific `partial` market (`partial → processing`). Same
 * PK-keyed conditional UPDATE as the positions/trades stages: `affectedRows === 1`
 * means we won it; `0` means a peer took it or it is no longer `partial`, so the
 * caller skips it (it is NOT reclaimed this run). This is what keeps concurrent
 * deep-backfills from rebuilding the same market at once.
 */
async function claimPartial(id: number): Promise<boolean> {
  const db = getDb()
  const upd = await db.execute(
    sql`UPDATE polymarket_markets SET trades_status = 'processing'
        WHERE id = ${id} AND trades_status = 'partial'`,
  )
  return ((upd as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 1
}

/** One named-slug candidate: the fields planSlugRerun classifies on, plus the
 * full market row it will hand to reconstruction. */
type SlugCandidate = SlugRow & { market: PartialMarket }

const SKIP_REASON: Record<SlugSkipReason, string> = {
  'skip-processing': 'processing, owned by a worker',
  'skip-open': 'not closed yet',
  'skip-unsettled': 'closed but within the settlement delay',
  'skip-pending': 'pending — run the trades stage first',
}

/**
 * Resolve which explicitly named (`--slug`) markets to rerun, and print the plan.
 * The bounded target set is decided BEFORE any mutation: each named market is
 * guarded (must be closed, settled, and in a terminal state — see
 * `classifySlugTarget`), then the eligible ones are ordered and cut to `--limit`.
 * Only the returned targets are later requeued and attempted, so
 * `--slug a,b,c --limit 1` touches exactly one market. Read-only.
 */
async function resolveSlugTargets(args: SyncArgs, simulateReset = false): Promise<PartialMarket[]> {
  if (!args.slugs || args.slugs.length === 0) return []
  const db = getDb()
  const res = await db.execute(
    sql`SELECT id, condition_id, slug, symbol, timeframe, market_start_ms, market_end_ms, volume_gamma, trade_rows,
               raw_json, closed, trades_status
        FROM polymarket_markets
        WHERE slug IN (${sql.join(
          args.slugs.map((s) => sql`${s}`),
          sql`, `,
        )})`,
  )
  const rows = (res as unknown as Array<Record<string, unknown>>[])[0] ?? []
  const candidates: SlugCandidate[] = rows.map((r) => ({
    id: Number(r.id),
    slug: String(r.slug),
    // --reset-processing --dry-run: a real run would reset these to `partial`
    // first, so model that here (read-only) — otherwise the dry-run classifies
    // them `skip-processing` and reports zero reruns while a real run reruns them.
    status: effectiveResetStatus(String(r.trades_status) as TradesStatus, simulateReset),
    closed: Number(r.closed) === 1,
    marketStartMs: Number(r.market_start_ms),
    marketEndMs: Number(r.market_end_ms),
    market: rowToPartial(r),
  }))

  const plan = planSlugRerun(candidates, {
    latest: args.latest,
    limit: args.limit,
    nowMs: Date.now(),
    minCloseAgeMs: POLYMARKET_DATA_MIN_CLOSE_AGE_MS,
  })

  const targetIds = new Set(plan.targets.map((t) => t.id))
  const foundSlugs = new Set(candidates.map((c) => c.slug))
  for (const s of args.slugs) {
    if (!foundSlugs.has(s)) console.log(`${LABEL}   ${s} → SKIP (not in catalog)`)
  }
  for (const t of plan.targets) console.log(`${LABEL}   ${t.slug} status=${t.status} → rerun`)
  for (const r of plan.beyondLimit) {
    if (!targetIds.has(r.id)) {
      console.log(`${LABEL}   ${r.slug} status=${r.status} → eligible but beyond --limit`)
    }
  }
  for (const { row, reason } of plan.skipped) {
    console.log(`${LABEL}   ${row.slug} status=${row.status} → SKIP (${SKIP_REASON[reason]})`)
  }

  return plan.targets.map((t) => t.market)
}

/**
 * Requeue ONLY the given (already-bounded, guarded) named markets back to
 * `partial` so the atomic claim can pick them up. Never touches a `processing`
 * row — a peer may have claimed it between resolution and here.
 */
async function requeueSelectedToPartial(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const db = getDb()
  const res = await db.execute(
    sql`UPDATE polymarket_markets SET trades_status = 'partial'
        WHERE trades_status <> 'processing'
          AND id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
  )
  return (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
}

/**
 * Return this process's unfinished claims to `partial` (retryable) on shutdown
 * or per-market failure. Only rows we still own (`processing`) and only our ids —
 * reverting by predicate would clobber a peer's claims.
 */
async function revertOwnedClaims(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const db = getDb()
  const res = await db.execute(
    sql`UPDATE polymarket_markets SET trades_status = 'partial'
        WHERE trades_status = 'processing'
          AND id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
  )
  return (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
}

/**
 * Free markets stranded in `processing` by a hard kill (SIGINT reverts its own
 * claims; SIGKILL does not) back to `partial`. Unsafe while peers are running —
 * their claims would be stolen — so it is an explicit `--reset-processing` opt-in.
 */
async function resetProcessing(args: SyncArgs, dryRun: boolean): Promise<number> {
  const db = getDb()
  const where = sql`trades_status = 'processing' AND ${eligibility(args)}`
  if (dryRun) {
    const res = await db.execute(sql`SELECT COUNT(*) AS n FROM polymarket_markets WHERE ${where}`)
    return Number((res as unknown as Array<Array<{ n: number | string }>>)[0]?.[0]?.n ?? 0)
  }
  const res = await db.execute(
    sql`UPDATE polymarket_markets SET trades_status = 'partial' WHERE ${where}`,
  )
  return (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
}

/**
 * Every wallet that touched the market.
 *
 * The positions snapshot is the load-bearing half: it is complete even when
 * /trades is capped, and it is precisely the wallets BEYOND the cap that we are
 * here to recover. The wallets already stored from the capped /trades pass are
 * unioned in, but they can never be the only source — doing that would search
 * only where we have already looked, and would silently reproduce the same
 * incomplete market. (It did: a market rebuilt from capped-trade wallets alone
 * came back still 18% short of its Gamma volume.)
 *
 * So positions are ALWAYS included: read from the DB when the positions stage
 * has run for this market, fetched live otherwise.
 */
async function participantsOf(
  market: PartialMarket,
  limiter: RateLimiter,
  signal: AbortSignal,
): Promise<{ wallets: string[]; positionsFetchedLive: boolean }> {
  const positionWallets = await marketPositionParticipants(market)
  const wallets = new Set(positionWallets)
  // Retain wallets already visible in the capped trade snapshot, but never let
  // that incomplete snapshot substitute for positions as the discovery source.
  for (const wallet of await marketParticipants(market)) wallets.add(wallet)

  const positionsFetchedLive = positionWallets.length === 0
  if (positionsFetchedLive) {
    const positions = await fetchMarketPositions(market.conditionId, {
      limiter,
      signal,
      label: LABEL,
    })
    for (const p of positions) wallets.add(p.proxyWallet.toLowerCase())
  }

  return { wallets: [...wallets], positionsFetchedLive }
}

/** Run `task` over `items` with at most `concurrency` in flight. */
async function pool<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await task(items[i]!)
    }
  })
  await Promise.all(workers)
  return out
}

async function reconstructMarket(
  market: PartialMarket,
  walletConcurrency: number,
  limiter: RateLimiter,
  signal: AbortSignal,
): Promise<
  BuildResult & {
    takerKnown: boolean
    participants: number
    cappedWalletScopes: number
    overflowWalletsRecovered: number
  }
> {
  const { wallets: participants } = await participantsOf(market, limiter, signal)
  const participantSet = new Set(participants)
  const fetchOpts = { limiter, signal, label: LABEL }

  const marketTaker = await fetchMarketTakerTrades(market.conditionId, fetchOpts)
  const perWallet = await pool(participants, walletConcurrency, async (wallet) => {
    const all = await fetchWalletTrades(market.conditionId, wallet, fetchOpts)
    return { wallet, all }
  })

  // Validate the scope filters before using any response. Do not concatenate
  // yet: a capped wallet may be replaced by the time-sliced overflow path.
  for (const { wallet, all } of perWallet) {
    for (const row of all.trades) {
      if (row.conditionId !== market.conditionId) {
        throw new Error(`API returned foreign condition ${row.conditionId} for ${market.slug}`)
      }
      if (row.proxyWallet.toLowerCase() !== wallet) {
        throw new Error(
          `API user filter mismatch for ${market.slug}: requested ${wallet}, got ${row.proxyWallet}`,
        )
      }
    }
  }

  // Usually the market-wide taker subset fits under the cap and costs only a
  // few requests. If it caps, partition takers by wallet too so is_taker stays
  // exact rather than silently labelling some takers as makers.
  let takerTrades = marketTaker.trades
  let takerKnown = !marketTaker.capped
  const cappedTakerWallets = new Set<string>()
  if (marketTaker.capped) {
    const perWalletTaker = await pool(participants, walletConcurrency, async (wallet) => {
      const taker = await fetchWalletTakerTrades(market.conditionId, wallet, fetchOpts)
      return { wallet, taker }
    })
    takerTrades = []
    takerKnown = true
    for (const { wallet, taker } of perWalletTaker) {
      if (taker.capped) {
        cappedTakerWallets.add(wallet)
        takerKnown = false
      }
      for (const row of taker.trades) {
        if (row.conditionId !== market.conditionId) {
          throw new Error(`API returned foreign taker condition for ${market.slug}`)
        }
        if (row.proxyWallet.toLowerCase() !== wallet) {
          throw new Error(
            `API taker user filter mismatch for ${market.slug}: requested ${wallet}, got ${row.proxyWallet}`,
          )
        }
        takerTrades.push(row)
      }
    }
  }

  const takersByWallet = new Map<string, ApiTrade[]>()
  for (const row of takerTrades) {
    if (row.conditionId !== market.conditionId) {
      throw new Error(`API returned foreign taker condition for ${market.slug}`)
    }
    const wallet = row.proxyWallet.toLowerCase()
    const rows = takersByWallet.get(wallet) ?? []
    rows.push(row)
    takersByWallet.set(wallet, rows)
  }

  const cappedFullScopes = perWallet.filter(({ all }) => all.capped)
  const recovered = await pool(cappedFullScopes, walletConcurrency, async ({ wallet, all }) => {
    if (cappedTakerWallets.has(wallet)) return { wallet, rows: null }
    const activities = await fetchActivityTimeSliced(
      {
        wallet,
        conditionId: market.conditionId,
        types: ['TRADE'],
        startSec: Math.max(1, Math.floor(market.createdMs / 1000) - 60),
        endSec: Math.ceil(Date.now() / 1000),
      },
      fetchOpts,
    )
    const rows = reconstructOverflowWalletTrades({
      wallet,
      conditionId: market.conditionId,
      activities,
      visibleTrades: all.trades,
      takerTrades: takersByWallet.get(wallet) ?? [],
    })
    return { wallet, rows }
  })
  const recoveredByWallet = new Map(
    recovered.filter((item) => item.rows !== null).map((item) => [item.wallet, item.rows!]),
  )

  let unresolvedCappedTradeWallets = 0
  const trades: ApiTrade[] = []
  for (const { wallet, all } of perWallet) {
    if (!all.capped) {
      trades.push(...all.trades)
      continue
    }
    const overflow = recoveredByWallet.get(wallet)
    if (overflow) trades.push(...overflow)
    else {
      unresolvedCappedTradeWallets += 1
      trades.push(...all.trades)
    }
  }

  const built = buildTradeRows({
    trades,
    takerTrades,
    market: {
      conditionId: market.conditionId,
      slug: market.slug,
      marketStartMs: market.marketStartMs,
      marketEndMs: market.marketEndMs,
      volumeGamma: market.volumeGamma,
    },
  })

  for (const row of built.rows) {
    if (!participantSet.has(row.wallet)) {
      throw new Error(`trade wallet ${row.wallet} is absent from positions for ${market.slug}`)
    }
  }
  if (built.unmatchedTakers > 0) takerKnown = false
  return {
    ...built,
    complete: unresolvedCappedTradeWallets > 0 ? false : built.complete,
    takerKnown,
    participants: participants.length,
    cappedWalletScopes: unresolvedCappedTradeWallets + cappedTakerWallets.size,
    overflowWalletsRecovered: recoveredByWallet.size,
  }
}

async function writeReconstructed(
  market: PartialMarket,
  rows: TradeRow[],
  stats: {
    wallets: number
    volumeTraded: number
    sharesVolume: number
    takerKnown: boolean
    complete: boolean | null
  },
): Promise<boolean> {
  const db = getDb()

  // Same status contract as sync-trades (shared helper): `done` only when
  // completeness is PROVEN; a capped taker query (`!takerKnown`) records the
  // maker/taker diagnostic without forcing `partial`.
  const { partial, error: note } = tradeCompleteness({
    complete: stats.complete,
    takerCapped: !stats.takerKnown,
    shortRowsNote: 'reconstruction still short of gamma share volume',
  })
  const status = partial ? 'partial' : 'done'

  return withDeadlockRetry(
    () =>
      db.transaction(async (tx) => {
        // Write only while we still own the claim. Lock the row and re-check:
        // if it is no longer `processing` (an operator reset it and another
        // worker took over), our snapshot must not overwrite theirs — this is
        // what stops a slow rebuild from clobbering a fresh complete one.
        const own = await tx.execute(
          sql`SELECT trades_status AS s FROM polymarket_markets WHERE id = ${market.id} FOR UPDATE`,
        )
        const cur = (own as unknown as Array<Array<{ s: string }>>)[0]?.[0]?.s as
          | ClaimStatus
          | undefined
        if (!mayWriteReconstruction(cur)) return false

        // Keep the claim row locked while the replacement Parquet snapshot is
        // atomically published, then commit its matching status/summary.
        await writeMarketTrades(market, rows)
        const persisted = await marketVerification(market)
        assertMarketSnapshot(
          market.slug,
          {
            rows: rows.length,
            wallets: stats.wallets,
            sharesVolume: stats.sharesVolume,
            complete: stats.complete,
            volumeGamma: market.volumeGamma,
          },
          persisted,
        )

        await tx.execute(
          sql`UPDATE polymarket_markets
              SET trades_status = ${status},
                  trades_source = 'deep-backfill',
                  trades_synced_at = CURRENT_TIMESTAMP,
                  trade_rows = ${rows.length},
                  trade_wallets = ${stats.wallets},
                  volume_traded = ${stats.volumeTraded.toFixed(6)},
                  trades_error = ${note}
              WHERE id = ${market.id}`,
        )
        return true
      }),
    LABEL,
  )
}

/**
 * Reconstruct a FIXED target set, claiming and attempting each at most ONCE. A
 * single pass over this snapshot is what stops a market that finishes `partial`
 * (still short) from being re-claimed — and starving markets we have not reached
 * — as a re-querying loop would. Atomic per-id claiming still keeps concurrent
 * invocations from rebuilding the same market. Shuffled so peers collide less.
 * Parallelism is per-wallet INSIDE a market (hundreds each).
 */
async function runReconstruction(
  targets: PartialMarket[],
  walletConcurrency: number,
  limiter: RateLimiter,
  ac: AbortController,
): Promise<void> {
  shuffleInPlace(targets)
  const progress = new ProgressTracker(LABEL, targets.length)
  const marketMetrics = new Map<number, { startedAtMs: number; requestsBefore: number }>()

  const formatMarketMetrics = (marketId: number): string => {
    const metrics = marketMetrics.get(marketId)
    if (!metrics) return 'http_requests=? elapsed=? avg_rps=?'
    const elapsedMs = Date.now() - metrics.startedAtMs
    const requests = limiter.requestCount - metrics.requestsBefore
    const averageRps = elapsedMs > 0 ? requests / (elapsedMs / 1000) : 0
    return `http_requests=${requests} elapsed=${fmtDuration(elapsedMs)} avg_rps=${averageRps.toFixed(1)}`
  }

  const { claimed } = await attemptTargets(targets, {
    aborted: () => ac.signal.aborted,
    claim: (id) => claimPartial(id),
    release: async (id) => {
      await revertOwnedClaims([id])
    },
    run: async (market) => {
      marketMetrics.set(market.id, {
        startedAtMs: Date.now(),
        requestsBefore: limiter.requestCount,
      })
      const built = await reconstructMarket(market, walletConcurrency, limiter, ac.signal)
      for (const warning of built.warnings) {
        console.warn(`${LABEL} WARN ${market.slug}: ${warning}`)
      }
      const written = await writeReconstructed(market, built.rows, built)
      if (!written) {
        // Lost the claim mid-flight (an operator reset it, a peer took over): do
        // not overwrite their work, and do not revert — it is not ours.
        progress.record(false)
        console.warn(
          `${LABEL} SKIPPED ${market.slug}: lost claim mid-flight, not overwriting ` +
            formatMarketMetrics(market.id),
        )
        marketMetrics.delete(market.id)
        return
      }
      await upsertWallets(built.rows.map((r) => ({ wallet: r.wallet })))

      const before = market.tradeRows ?? 0
      const gained = built.rows.length - before
      const shortfall =
        market.volumeGamma && market.volumeGamma > 0
          ? ((built.sharesVolume - market.volumeGamma) / market.volumeGamma) * 100
          : null
      progress.record(true)
      console.log(
        progress.line(
          `${market.slug} rows=${built.rows.length} (+${gained}) ` +
            `wallets=${built.wallets}/${built.participants} vol=${built.volumeTraded.toFixed(0)} ` +
            (built.complete === true
              ? '✓complete'
              : built.complete === false
                ? `STILL SHORT ${shortfall?.toFixed(2)}%`
                : 'completeness unknown (no gamma volume)') +
            (built.takerKnown ? '' : ' TAKER_FLAGS_PARTIAL') +
            (built.overflowWalletsRecovered > 0
              ? ` OVERFLOW_WALLETS_RECOVERED=${built.overflowWalletsRecovered}`
              : '') +
            (built.cappedWalletScopes > 0
              ? ` CAPPED_WALLET_SCOPES=${built.cappedWalletScopes}`
              : '') +
            ` ${formatMarketMetrics(market.id)}`,
        ),
      )
      marketMetrics.delete(market.id)
    },
    onError: (market, err) => {
      progress.record(false)
      console.warn(
        `${LABEL} FAILED ${market.slug}: ${(err as Error).message} ${formatMarketMetrics(market.id)}`,
      )
      marketMetrics.delete(market.id)
    },
  })

  // Wallet trade counters are refreshed once, at the start of sync-activity —
  // not here. Recomputing them from the full trades table (~50s) after every
  // deep-backfill invocation added up to tens of minutes across a wrapper run.

  const s = progress.summary()
  console.log(
    `${LABEL} done ok=${s.done} failed=${s.failed} attempted=${targets.length} claimed=${claimed} ` +
      `in ${fmtDuration(s.elapsedMs)}` +
      (ac.signal.aborted ? ' (interrupted; released in-flight claim to partial)' : ''),
  )
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  let walletConcurrency = DEFAULT_WALLET_CONCURRENCY
  const wcIdx = argv.indexOf('--wallet-concurrency')
  if (wcIdx !== -1) {
    const n = Number(argv[wcIdx + 1] ?? '')
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new Error(`${LABEL} --wallet-concurrency must be > 0`)
    }
    walletConcurrency = n
    argv.splice(wcIdx, 2)
  }

  const args = parseSyncArgs(argv, LABEL)
  const limiter = new RateLimiter(POLYMARKET_DATA_TRADES_RPS)

  const ac = new AbortController()
  let shuttingDown = false
  const onSignal = () => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    console.log(`${LABEL} shutting down; finishing the current market…`)
    ac.abort()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  if (args.resetProcessing) {
    const n = await resetProcessing(args, args.dryRun)
    console.log(
      `${LABEL} ${args.dryRun ? 'would reset' : 'reset'} ${n} stuck 'processing' market(s) → partial` +
        (args.dryRun ? ' (dry-run)' : ''),
    )
  }

  // Under a --reset-processing --dry-run preview the reset above did NOT mutate,
  // so model its effect here: treat currently-`processing` markets as if they
  // were reset to `partial`, so the plan matches what a real run would attempt.
  // A real reset run has already flipped them, so this stays false there.
  const simulateReset = args.resetProcessing && args.dryRun

  // --slug: resolve the guarded, bounded (--limit-clamped) rerun set FIRST, then
  // requeue only those exact markets. This keeps a settlement guard on named
  // markets (an open one is skipped, not reconstructed) and stops `--limit` from
  // downgrading more markets than it rebuilds.
  if (args.slugs && args.slugs.length > 0) {
    const targets = await resolveSlugTargets(args, simulateReset)
    if (args.dryRun) {
      console.log(
        `${LABEL} would rerun ${targets.length} named market(s); nothing executed (dry-run)`,
      )
      return
    }
    if (targets.length === 0) {
      console.log(`${LABEL} nothing to do`)
      return
    }
    const requeued = await requeueSelectedToPartial(targets.map((t) => t.id))
    console.log(
      `${LABEL} requeued ${requeued} named market(s) → partial; attempting ${targets.length} ` +
        `wallet-concurrency=${walletConcurrency}`,
    )
    await runReconstruction(targets, walletConcurrency, limiter, ac)
    return
  }

  const total = await countPartial(args, simulateReset)
  const budget = clampBudget(args.limit, total)
  console.log(
    `${LABEL} partial markets=${total} budget=${budget} wallet-concurrency=${walletConcurrency}` +
      (args.dryRun ? ' (dry-run)' : ''),
  )

  if (args.dryRun) {
    const markets = await selectPartialMarkets(args, budget, simulateReset)
    for (const m of markets) console.log(`${LABEL}   ${m.slug} capped_rows=${m.tradeRows ?? '?'}`)
    console.log(`${LABEL} nothing executed (dry-run)`)
    return
  }
  if (budget === 0) {
    console.log(`${LABEL} nothing to do`)
    return
  }

  const targets = await selectPartialMarkets(args, budget)
  await runReconstruction(targets, walletConcurrency, limiter, ac)
}

main()
  .then(async () => {
    await closeDb()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(err)
    await closeDb().catch(() => {})
    process.exit(1)
  })
