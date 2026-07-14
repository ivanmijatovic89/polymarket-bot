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
 * Usage:
 *   npm run polymarket-data:sync-activity -- [--limit N] [--wallet 0x…]
 *       [--min-trades N] [--concurrency N] [--full] [--retry-failed] [--dry-run]
 */

import '../config/env.js'
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index.js'
import { withDeadlockRetry } from '../db/txRetry.js'
import { POLYMARKET_DATA_ACTIVITY_RPS } from '../config/polymarketData.js'
import { RateLimiter } from './rateLimiter.js'
import { fetchActivity, type ApiActivity } from './activityApi.js'
import { selectActivityRows } from './activityRows.js'
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
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    limit: null,
    minTrades: 0,
    concurrency: 4,
    full: false,
    retryFailed: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--wallet') {
      out.wallets = (argv[++i] ?? '')
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w !== '')
    } else if (a === '--limit') out.limit = Number(argv[++i] ?? '') || null
    else if (a === '--min-trades') out.minTrades = Number(argv[++i] ?? '') || 0
    else if (a === '--concurrency') out.concurrency = Number(argv[++i] ?? '') || 4
    else if (a === '--full') out.full = true
    else if (a === '--retry-failed') out.retryFailed = true
    else if (a === '--dry-run') out.dryRun = true
    else throw new Error(`${LABEL} unknown arg: ${a}`)
  }
  return out
}

function walletSelection(args: Args) {
  const clauses = [sql`activity_status = 'pending'`]
  if (args.wallets && args.wallets.length > 0) {
    clauses.length = 0
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
          // INSERT IGNORE + unique(dedup_key): the cursor's overlap re-reads rows
          // we already have, and they are silently skipped.
          await tx.execute(
            sql`INSERT IGNORE INTO polymarket_activity
                  (wallet, type, market_id, condition_id, size, usdc_size, outcome_index, ts_ms, tx_hash, dedup_key)
                VALUES ${sql.join(values, sql`, `)}`,
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

  if (args.retryFailed) {
    const res = await db.execute(
      sql`UPDATE polymarket_wallets SET activity_status = 'pending' WHERE activity_status = 'failed'`,
    )
    const n = (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
    console.log(`${LABEL} requeued ${n} failed wallets`)
  }
  if (args.wallets && args.wallets.length > 0) {
    // Named wallets are always (re)synced, whatever state they were left in.
    await db.execute(
      sql`UPDATE polymarket_wallets SET activity_status = 'pending'
          WHERE wallet IN (${sql.join(
            args.wallets.map((w) => sql`${w}`),
            sql`, `,
          )})`,
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
        const startSec =
          claim.cursorTs === null
            ? 1
            : Math.max(1, Math.floor((claim.cursorTs - CURSOR_OVERLAP_MS) / 1000))

        const activities = await fetchActivity(
          { wallet: claim.wallet, startSec },
          { limiter, signal: ac.signal, label: LABEL },
        )

        // Default scope is our markets only; --full keeps a wallet's whole
        // Polymarket history (for wallets under active investigation).
        const keep = selectActivityRows(activities, marketIndex, args.full)

        // Cursor: the newest row we saw, or (for a wallet with no activity) now
        // minus the overlap, so the next run doesn't re-read all of history.
        const newestTs = activities.reduce((max, r) => Math.max(max, r.timestamp * 1000), 0)
        const cursorTs = newestTs > 0 ? newestTs : Date.now() - CURSOR_OVERLAP_MS

        await writeActivity(claim.wallet, keep, cursorTs)
        storedRows += keep.length

        progress.record(true)
        console.log(
          progress.line(
            `${claim.wallet.slice(0, 10)}… fetched=${activities.length} stored=${keep.length}`,
          ),
        )
      } catch (err) {
        if (ac.signal.aborted) return
        await db.execute(
          sql`UPDATE polymarket_wallets
              SET activity_status = 'failed', activity_error = ${(err as Error).message.slice(0, 1000)}
              WHERE wallet = ${claim.wallet}`,
        )
        progress.record(false)
        console.warn(`${LABEL} FAILED ${claim.wallet}: ${(err as Error).message}`)
      } finally {
        inFlight.delete(claim.wallet)
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()))

  if (inFlight.size > 0) {
    await db.execute(
      sql`UPDATE polymarket_wallets SET activity_status = 'pending'
          WHERE activity_status = 'processing'
            AND wallet IN (${sql.join(
              [...inFlight].map((w) => sql`${w}`),
              sql`, `,
            )})`,
    )
  }

  const s = progress.summary()
  console.log(
    `${LABEL} done wallets_ok=${s.done} failed=${s.failed} activity_rows=${storedRows} ` +
      `in ${fmtDuration(s.elapsedMs)}` +
      (ac.signal.aborted ? ' (interrupted; claims reverted)' : ''),
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
