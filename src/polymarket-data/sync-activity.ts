#!/usr/bin/env tsx
/**
 * polymarket-data sync-activity (stage 4): the non-trade side of the ledger —
 * SPLIT / MERGE / REDEEM / REWARD / CONVERSION — per wallet.
 *
 * `/activity` only works per-wallet (it 400s without `user`), so this walks the
 * wallets discovered by the positions and trades stages, biggest traders first.
 * No `type` filter is sent: we take whatever the API reports (the `type` column
 * is a varchar precisely so a new activity type can't break the sync) and keep
 * the rows that touch OUR markets.
 *
 * TRADE rows are deliberately dropped here — they already live in
 * `polymarket_trades`, and storing them twice would double-count every analysis.
 *
 * Each wallet carries a cursor, so re-running later picks up late REDEEMs
 * without re-reading history. Stopping early costs nothing: state is per-wallet.
 *
 * A plain run only claims `pending` wallets, so a wallet already `done` is NOT
 * revisited — its new activity would be missed on a recurring sync. Re-queue it
 * with --stale-after (wallets not refreshed in N hours), --refresh-done (all
 * done wallets), or --wallet (specific ones). The cursor makes the refresh cheap.
 *
 * Usage:
 *   npm run polymarket-data:sync-activity -- [--limit N] [--wallet 0x…]
 *       [--min-trades N] [--concurrency N] [--full] [--retry-failed]
 *       [--stale-after <hours>] [--refresh-done] [--reset-processing] [--dry-run]
 */

import '../config/env.js'
import { sql, type SQL } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index.js'
import { withDeadlockRetry } from '../db/txRetry.js'
import { POLYMARKET_DATA_ACTIVITY_RPS } from '../config/polymarketData.js'
import { RateLimiter } from './rateLimiter.js'
import { fetchActivity, type ApiActivity } from './activityApi.js'
import {
  activityFetchStartSec,
  needsWalletStatsRefresh,
  nextActivityCursorMs,
  selectActivityRows,
} from './activityRows.js'
import { refreshWalletStats } from './walletUpsert.js'
import { claimFromCandidates, claimNextOrConfirmEmpty } from '../db/claimQueue.js'
import { fmtDuration, ProgressTracker } from './marketQueue.js'

const LABEL = '[polymarket-data:sync-activity]'
const CLAIM_CANDIDATES = 50
const INSERT_CHUNK = 500
const EMPTY_CLAIM_BACKOFF_MS = 500

/**
 * Re-read a little before the stored cursor: activity can be indexed slightly
 * out of order around the boundary second, and `dedup_key` makes the overlap
 * free.
 */
const CURSOR_OVERLAP_MS = 60 * 60 * 1000

type Args = {
  wallets?: string[]
  limit: number | null
  minTrades: number
  concurrency: number
  full: boolean
  retryFailed: boolean
  refreshDone: boolean
  staleAfterHours: number | null
  resetProcessing: boolean
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    limit: null,
    minTrades: 0,
    concurrency: 4,
    full: false,
    retryFailed: false,
    refreshDone: false,
    staleAfterHours: null,
    resetProcessing: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--wallet') {
      out.wallets = (argv[++i] ?? '')
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w !== '')
    } else if (a === '--limit') {
      // Preserve 0: `--limit 0` means "do the re-queue admin, sync nothing".
      const n = Number(argv[++i] ?? '')
      if (!Number.isInteger(n) || n < 0) throw new Error(`${LABEL} --limit needs an integer >= 0`)
      out.limit = n
    } else if (a === '--min-trades') out.minTrades = Number(argv[++i] ?? '') || 0
    else if (a === '--concurrency') out.concurrency = Number(argv[++i] ?? '') || 4
    else if (a === '--full') out.full = true
    else if (a === '--retry-failed') out.retryFailed = true
    else if (a === '--refresh-done') out.refreshDone = true
    else if (a === '--stale-after') {
      const h = Number(argv[++i] ?? '')
      if (!Number.isFinite(h) || h < 0) throw new Error(`${LABEL} --stale-after needs hours >= 0`)
      out.staleAfterHours = h
    } else if (a === '--reset-processing') out.resetProcessing = true
    else if (a === '--dry-run') out.dryRun = true
    else throw new Error(`${LABEL} unknown arg: ${a}`)
  }
  return out
}

/**
 * Extra WHERE constraints shared by the re-queue statements: honour `--min-trades`
 * so a threshold set for the run also bounds what gets refreshed. `--wallet` is
 * handled separately (it force-requeues exactly those wallets).
 */
function requeueScope(args: Args): SQL {
  return args.minTrades > 0 ? sql` AND trade_count >= ${args.minTrades}` : sql``
}

function walletSelection(args: Args) {
  // `activity_status = 'pending'` is ALWAYS required: it is what lets a claimed
  // (and then finalized → 'done') wallet leave the candidate set, so both the
  // `LIMIT` candidate query and countRemaining() drain to zero. `--wallet`
  // NARROWS this pending set rather than replacing the status predicate — the
  // explicit requeue step in main() first flips named wallets back to 'pending'
  // (in any prior state), so they are claimable here.
  const clauses = [sql`activity_status = 'pending'`]
  if (args.wallets && args.wallets.length > 0) {
    clauses.push(
      sql`wallet IN (${sql.join(
        args.wallets.map((w) => sql`${w}`),
        sql`, `,
      )})`,
    )
  } else if (args.minTrades > 0) {
    clauses.push(sql`trade_count >= ${args.minTrades}`)
  }
  return sql.join(clauses, sql` AND `)
}

type ClaimedWallet = { wallet: string; cursorTs: number | null }

async function countPendingWallets(args: Args): Promise<number> {
  const db = getDb()
  const res = await db.execute(
    sql`SELECT COUNT(*) AS n FROM polymarket_wallets WHERE ${walletSelection(args)}`,
  )
  const first = (res as unknown as Array<Array<{ n: number | string }>>)[0]?.[0]
  return Number(first?.n ?? 0)
}

async function claimNextWallet(args: Args, signal: AbortSignal): Promise<ClaimedWallet | null> {
  const db = getDb()
  return claimNextOrConfirmEmpty<ClaimedWallet>({
    claim: async () => {
      const res = await db.execute(
        sql`SELECT wallet, activity_cursor_ts FROM polymarket_wallets
            WHERE ${walletSelection(args)}
            ORDER BY trade_count DESC
            LIMIT ${CLAIM_CANDIDATES}`,
      )
      const rows =
        (
          res as unknown as Array<Array<{ wallet: string; activity_cursor_ts: number | null }>>
        )[0] ?? []
      if (rows.length === 0) return null

      const candidates: ClaimedWallet[] = rows.map((r) => ({
        wallet: r.wallet,
        cursorTs: r.activity_cursor_ts === null ? null : Number(r.activity_cursor_ts),
      }))

      return claimFromCandidates(candidates, async (c) => {
        const upd = await db.execute(
          sql`UPDATE polymarket_wallets SET activity_status = 'processing'
              WHERE wallet = ${c.wallet} AND activity_status = 'pending'`,
        )
        const affected = (upd as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
        return affected === 1 ? c : null
      })
    },
    countRemaining: () => countPendingWallets(args),
    backoffMs: EMPTY_CLAIM_BACKOFF_MS,
    signal,
  })
}

type MarketIndex = Map<string, number>

async function loadMarketIndex(): Promise<MarketIndex> {
  const db = getDb()
  const res = await db.execute(sql`SELECT id, condition_id FROM polymarket_markets`)
  const rows = (res as unknown as Array<Array<{ id: number; condition_id: string }>>)[0] ?? []
  return new Map(rows.map((r) => [r.condition_id, Number(r.id)]))
}

async function writeActivity(
  wallet: string,
  rows: Array<{ row: ApiActivity; marketId: number | null; key: string }>,
  cursorTs: number,
): Promise<void> {
  const db = getDb()

  await withDeadlockRetry(
    () =>
      db.transaction(async (tx) => {
        for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
          const chunk = rows.slice(i, i + INSERT_CHUNK)
          const values = chunk.map(
            ({ row, marketId, key }) =>
              sql`(${wallet}, ${row.type}, ${marketId}, ${row.conditionId},
                   ${row.size ?? null}, ${row.usdcSize ?? null}, ${row.outcomeIndex ?? null},
                   ${row.timestamp * 1000}, ${row.transactionHash ?? null}, ${key})`,
          )
          // Duplicate-specific idempotency. `ON DUPLICATE KEY UPDATE dedup_key =
          // dedup_key` no-ops on the overlap the cursor deliberately re-reads,
          // but — unlike `INSERT IGNORE` — does NOT swallow truncation / invalid
          // / out-of-range errors into warnings and store coerced data. Those
          // now abort the transaction so a data problem is surfaced, not hidden.
          await tx.execute(
            sql`INSERT INTO polymarket_activity
                  (wallet, type, market_id, condition_id, size, usdc_size, outcome_index, ts_ms, tx_hash, dedup_key)
                VALUES ${sql.join(values, sql`, `)}
                ON DUPLICATE KEY UPDATE dedup_key = dedup_key`,
          )
        }

        await tx.execute(
          sql`UPDATE polymarket_wallets
              SET activity_status = 'done',
                  activity_cursor_ts = ${cursorTs},
                  activity_synced_at = CURRENT_TIMESTAMP,
                  activity_error = NULL
              WHERE wallet = ${wallet}`,
        )
      }),
    LABEL,
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const limiter = new RateLimiter(POLYMARKET_DATA_ACTIVITY_RPS)

  const ac = new AbortController()
  const inFlight = new Set<string>()
  let shuttingDown = false
  const onSignal = () => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    console.log(`${LABEL} shutting down; finishing in-flight wallets…`)
    ac.abort()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  const db = getDb()

  // Flip a set of wallets back to `pending`, or under --dry-run just report how
  // many WOULD move. Every re-queue path goes through here so dry-run is honestly
  // read-only (it previously still wrote — caught in testing).
  const requeue = async (where: SQL, note: string): Promise<void> => {
    if (args.dryRun) {
      const res = await db.execute(sql`SELECT COUNT(*) AS n FROM polymarket_wallets WHERE ${where}`)
      const n = Number((res as unknown as Array<Array<{ n: number }>>)[0]?.[0]?.n ?? 0)
      console.log(`${LABEL} would requeue ${n} ${note} (dry-run)`)
      return
    }
    const res = await db.execute(
      sql`UPDATE polymarket_wallets SET activity_status = 'pending' WHERE ${where}`,
    )
    const n = (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
    console.log(`${LABEL} requeued ${n} ${note}`)
  }

  // Recompute wallet trade counts BEFORE the requeues below. This stage is the
  // only reader of those counts (claim order = trade_count DESC, and
  // --min-trades scopes both the requeues and the claim), so they must be fresh
  // *before* any --min-trades-scoped requeue decides which done wallets to
  // revisit — otherwise a done wallet whose new trades just crossed the
  // threshold is filtered out on a stale count and, when nothing else is
  // pending, never refreshed, so it stays undiscovered indefinitely.
  //
  // It is a full aggregation of polymarket_trades (index-backed, ~3s), so we
  // still skip it when it cannot matter: dry-run (read-only) and named-wallet
  // runs (explicit wallets, no threshold/ordering), or a plain drain with
  // nothing pending and no requeue requested.
  const namedRun = !!(args.wallets && args.wallets.length > 0)
  const requeueRequested =
    args.retryFailed || args.refreshDone || args.staleAfterHours !== null || args.resetProcessing
  // Only pay for the cheap status probe when the decision still hinges on it.
  let anyPending = false
  if (!args.dryRun && !namedRun && !(args.minTrades > 0 || requeueRequested)) {
    const gate = await db.execute(
      sql`SELECT EXISTS(SELECT 1 FROM polymarket_wallets WHERE activity_status = 'pending') AS anyp`,
    )
    anyPending = Number((gate as unknown as Array<Array<{ anyp: number }>>)[0]?.[0]?.anyp ?? 0) > 0
  }
  if (
    needsWalletStatsRefresh(
      { dryRun: args.dryRun, namedRun, minTrades: args.minTrades, requeueRequested },
      anyPending,
    )
  ) {
    const t = Date.now()
    await refreshWalletStats()
    console.log(`${LABEL} refreshed wallet trade stats in ${((Date.now() - t) / 1000).toFixed(1)}s`)
  }

  if (args.resetProcessing) {
    // Free wallets left in 'processing' by a hard kill (SIGINT reverts its own
    // claims; a SIGKILL does not). Unsafe while peers are running — their claims
    // would be stolen — so it's an explicit opt-in.
    await requeue(
      sql`activity_status = 'processing'${requeueScope(args)}`,
      "stuck 'processing' wallets",
    )
  }
  if (args.retryFailed) {
    await requeue(sql`activity_status = 'failed'${requeueScope(args)}`, 'failed wallets')
  }
  // Refresh already-synced wallets so a recurring sync catches their NEW activity
  // (late redeems/splits). Cheap and idempotent: each wallet resumes from its
  // stored cursor minus an overlap, and re-read rows are dropped by dedup_key.
  // --stale-after targets wallets not refreshed in N hours (incl. never); a NULL
  // activity_synced_at counts as stale so it is always re-queued.
  if (args.staleAfterHours !== null) {
    const cutoffSec = Math.floor((Date.now() - args.staleAfterHours * 60 * 60 * 1000) / 1000)
    await requeue(
      sql`activity_status = 'done'
          AND (activity_synced_at IS NULL OR activity_synced_at < FROM_UNIXTIME(${cutoffSec}))
          ${requeueScope(args)}`,
      `done wallets not refreshed in ${args.staleAfterHours}h`,
    )
  } else if (args.refreshDone) {
    await requeue(
      sql`activity_status = 'done'${requeueScope(args)}`,
      'done wallets for a full refresh',
    )
  }
  if (args.wallets && args.wallets.length > 0) {
    // Named wallets are always (re)synced, whatever state they were left in.
    await requeue(
      sql`wallet IN (${sql.join(
        args.wallets.map((w) => sql`${w}`),
        sql`, `,
      )})`,
      'named wallets',
    )
  }

  const marketIndex = await loadMarketIndex()
  const pending = await countPendingWallets(args)
  const budget = args.limit === null ? pending : Math.min(args.limit, pending)
  console.log(
    `${LABEL} pending_wallets=${pending} budget=${budget} markets_known=${marketIndex.size} ` +
      `concurrency=${args.concurrency} scope=${args.full ? 'all-polymarket' : 'our-markets'} dry-run=${args.dryRun}`,
  )
  if (args.dryRun || budget === 0) {
    console.log(`${LABEL} nothing to do${args.dryRun ? ' (dry-run)' : ''}`)
    return
  }

  const progress = new ProgressTracker(LABEL, budget)
  let claimed = 0
  let storedRows = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      if (ac.signal.aborted) return
      if (claimed >= budget) return
      claimed += 1

      const claim = await claimNextWallet(args, ac.signal)
      if (!claim) return
      inFlight.add(claim.wallet)

      try {
        const startSec = activityFetchStartSec(claim.cursorTs, CURSOR_OVERLAP_MS)
        // Capture the upper bound BEFORE fetching and bound the fetch by it, so
        // the persisted cursor is exactly the interval we scanned through — not
        // the newest event found. This lets inactive wallets advance efficiently.
        const upperBoundMs = Date.now()

        const activities = await fetchActivity(
          { wallet: claim.wallet, startSec, endSec: Math.floor(upperBoundMs / 1000) },
          { limiter, signal: ac.signal, label: LABEL },
        )

        // Default scope is our markets only; --full keeps a wallet's whole
        // Polymarket history (for wallets under active investigation).
        const keep = selectActivityRows(activities, marketIndex, args.full)

        const cursorTs = nextActivityCursorMs(claim.cursorTs, upperBoundMs)

        await writeActivity(claim.wallet, keep, cursorTs)
        inFlight.delete(claim.wallet) // finalized in the DB — release ownership
        storedRows += keep.length

        progress.record(true)
        console.log(
          progress.line(
            `${claim.wallet.slice(0, 10)}… fetched=${activities.length} stored=${keep.length}`,
          ),
        )
      } catch (err) {
        // On abort the wallet was NOT finalized: leave it in `inFlight` so the
        // revert below returns it to `pending`. Only a real failure is marked
        // `failed` and released.
        if (ac.signal.aborted) return
        await db.execute(
          sql`UPDATE polymarket_wallets
              SET activity_status = 'failed', activity_error = ${(err as Error).message.slice(0, 1000)}
              WHERE wallet = ${claim.wallet}`,
        )
        inFlight.delete(claim.wallet)
        progress.record(false)
        console.warn(`${LABEL} FAILED ${claim.wallet}: ${(err as Error).message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()))

  let reverted = 0
  if (inFlight.size > 0) {
    const res = await db.execute(
      sql`UPDATE polymarket_wallets SET activity_status = 'pending'
          WHERE activity_status = 'processing'
            AND wallet IN (${sql.join(
              [...inFlight].map((w) => sql`${w}`),
              sql`, `,
            )})`,
    )
    reverted = (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
  }

  const s = progress.summary()
  console.log(
    `${LABEL} done wallets_ok=${s.done} failed=${s.failed} activity_rows=${storedRows} ` +
      `in ${fmtDuration(s.elapsedMs)}` +
      (reverted > 0 ? ` (interrupted; reverted ${reverted} claim(s) to pending)` : ''),
  )
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
