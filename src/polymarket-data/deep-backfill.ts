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
 * How it escapes the cap: `/activity` is per-wallet, and per-wallet it honours
 * time filters and ASC sort, so each wallet's fills can be walked completely.
 * Verified equivalent to `/trades` on a fully-synced market — same rows, same
 * USDC, maker fills included. Participants come from `/v1/market-positions`,
 * which is complete even when `/trades` is capped (and is a superset of the
 * wallets `/trades` shows).
 *
 *   participants (positions ∪ known trades) → per-wallet /activity?type=TRADE
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
import { claimFromCandidates, claimNextOrConfirmEmpty } from '../db/claimQueue.js'
import { POLYMARKET_DATA_ACTIVITY_RPS } from '../config/polymarketData.js'
import { RateLimiter } from './rateLimiter.js'
import { fetchActivity } from './activityApi.js'
import { buildReconstructedRows, takerKeysOf, type ReconstructedRow } from './reconstruct.js'
import { fetchMarketPositions, fetchMarketTakerTrades } from './dataApi.js'
import { fmtDuration, ProgressTracker } from './marketQueue.js'
import { completenessToleranceShares, tradeCompleteness } from './tradeRows.js'
import { parseSyncArgs, type SyncArgs } from './syncArgs.js'
import { mayWriteReconstruction, type ClaimStatus } from './deepBackfillClaim.js'
import { upsertWallets } from './walletUpsert.js'

const LABEL = '[polymarket-data:deep-backfill]'
const INSERT_CHUNK = 1000
const DEFAULT_WALLET_CONCURRENCY = 8
const CLAIM_CANDIDATES = 100
const EMPTY_CLAIM_BACKOFF_MS = 500

type PartialMarket = {
  id: number
  conditionId: string
  slug: string
  marketStartMs: number
  marketEndMs: number
  volumeGamma: number | null
  tradeRows: number | null
}

function rowToPartial(r: Record<string, unknown>): PartialMarket {
  return {
    id: Number(r.id),
    conditionId: String(r.condition_id),
    slug: String(r.slug),
    marketStartMs: Number(r.market_start_ms),
    marketEndMs: Number(r.market_end_ms),
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

/** Partial markets in scope, for the dry-run listing (read-only, no claim). */
async function selectPartialMarkets(args: SyncArgs): Promise<PartialMarket[]> {
  const db = getDb()
  const res = await db.execute(
    sql`SELECT id, condition_id, slug, market_start_ms, market_end_ms, volume_gamma, trade_rows
        FROM polymarket_markets
        WHERE trades_status = 'partial' AND ${eligibility(args)}
        ORDER BY market_start_ms ${args.latest ? sql`DESC` : sql`ASC`}
        LIMIT ${args.limit ?? 1000}`,
  )
  const rows = (res as unknown as Array<Record<string, unknown>>[])[0] ?? []
  return rows.map(rowToPartial)
}

async function countPartial(args: SyncArgs): Promise<number> {
  const db = getDb()
  const res = await db.execute(
    sql`SELECT COUNT(*) AS n FROM polymarket_markets
        WHERE trades_status = 'partial' AND ${eligibility(args)}`,
  )
  return Number((res as unknown as Array<Array<{ n: number | string }>>)[0]?.[0]?.n ?? 0)
}

/**
 * Claim one `partial` market atomically (`partial → processing`), or null when
 * the queue is genuinely drained. Same protocol as the positions/trades stages
 * (`claimNextOrConfirmEmpty` + a PK-keyed conditional UPDATE): an empty claim is
 * contention, not drain, until a real COUNT confirms zero. Without this, two
 * concurrent deep-backfills would rebuild the same market at once.
 */
async function claimNextPartialMarket(
  args: SyncArgs,
  signal: AbortSignal,
): Promise<PartialMarket | null> {
  const db = getDb()
  const order = args.latest ? sql`DESC` : sql`ASC`
  return claimNextOrConfirmEmpty<PartialMarket>({
    claim: async () => {
      const res = await db.execute(
        sql`SELECT id, condition_id, slug, market_start_ms, market_end_ms, volume_gamma, trade_rows
            FROM polymarket_markets
            WHERE trades_status = 'partial' AND ${eligibility(args)}
            ORDER BY market_start_ms ${order}
            LIMIT ${CLAIM_CANDIDATES}`,
      )
      const rows = (res as unknown as Array<Record<string, unknown>>[])[0] ?? []
      if (rows.length === 0) return null
      return claimFromCandidates(rows.map(rowToPartial), async (m) => {
        const upd = await db.execute(
          sql`UPDATE polymarket_markets SET trades_status = 'processing'
              WHERE id = ${m.id} AND trades_status = 'partial'`,
        )
        const affected = (upd as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0
        return affected === 1 ? m : null
      })
    },
    countRemaining: () => countPartial(args),
    backoffMs: EMPTY_CLAIM_BACKOFF_MS,
    signal,
  })
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
  const db = getDb()
  const wallets = new Set<string>()

  const storedPositions = await db.execute(
    sql`SELECT wallet FROM polymarket_market_positions WHERE market_id = ${market.id}`,
  )
  const positionRows = (storedPositions as unknown as Array<{ wallet: string }>[])[0] ?? []
  for (const r of positionRows) wallets.add(r.wallet.toLowerCase())

  const positionsFetchedLive = positionRows.length === 0
  if (positionsFetchedLive) {
    const positions = await fetchMarketPositions(market.conditionId, {
      limiter,
      signal,
      label: LABEL,
    })
    for (const p of positions) wallets.add(p.proxyWallet.toLowerCase())
  }

  const storedTrades = await db.execute(
    sql`SELECT DISTINCT wallet FROM polymarket_trades WHERE market_id = ${market.id}`,
  )
  for (const r of (storedTrades as unknown as Array<{ wallet: string }>[])[0] ?? []) {
    wallets.add(r.wallet.toLowerCase())
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
): Promise<{
  rows: ReconstructedRow[]
  wallets: number
  volume: number
  sharesVolume: number
  complete: boolean | null
  takerKnown: boolean
  participants: number
}> {
  const { wallets: participants } = await participantsOf(market, limiter, signal)

  // The taker-only /trades query has the same offset cap, but taker rows are a
  // fraction of all rows, so it is usually well within it. When it is not, we
  // say so rather than silently mislabel every row as a maker fill.
  const taker = await fetchMarketTakerTrades(market.conditionId, { limiter, signal, label: LABEL })
  const takerKeys = takerKeysOf(taker.trades)

  const perWallet = await pool(participants, walletConcurrency, async (wallet) =>
    fetchActivity(
      { wallet, conditionId: market.conditionId, types: ['TRADE'], startSec: 1 },
      { limiter, signal, label: LABEL },
    ),
  )

  const built = buildReconstructedRows(perWallet, takerKeys, market.conditionId)
  const { rows, volume, sharesVolume } = built

  // Same completeness contract as the trades stage (see tradeRows.ts):
  //   true  → invariant held, or an empty no-volume market (trivially complete);
  //   false → invariant failed (still short);
  //   null  → unverifiable (no Gamma volume but rows exist).
  // Only `true` may become `done`.
  const complete =
    market.volumeGamma !== null && market.volumeGamma > 0
      ? Math.abs(sharesVolume - market.volumeGamma) <= completenessToleranceShares(rows.length)
      : rows.length === 0
        ? true
        : null

  return {
    rows,
    wallets: built.wallets,
    volume,
    sharesVolume,
    complete,
    takerKnown: !taker.capped,
    participants: participants.length,
  }
}

async function writeReconstructed(
  market: PartialMarket,
  rows: ReconstructedRow[],
  stats: { wallets: number; volume: number; takerKnown: boolean; complete: boolean | null },
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

        await tx.execute(sql`DELETE FROM polymarket_trades WHERE market_id = ${market.id}`)

        for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
          const chunk = rows.slice(i, i + INSERT_CHUNK)
          const values = chunk.map(
            (r) =>
              sql`(${market.id}, ${r.wallet}, ${r.side}, ${r.outcomeIndex}, ${r.asset},
               ${r.size.toFixed(6)}, ${r.price.toFixed(6)}, ${r.usdcSize.toFixed(6)},
               ${r.isTaker ? 1 : 0}, ${r.tsMs}, ${r.txHash})`,
          )
          await tx.execute(
            sql`INSERT INTO polymarket_trades
              (market_id, wallet, side, outcome_index, asset, size, price, usdc_size, is_taker, ts_ms, tx_hash)
            VALUES ${sql.join(values, sql`, `)}`,
          )
        }

        await tx.execute(
          sql`UPDATE polymarket_markets
              SET trades_status = ${status},
                  trades_source = 'deep-backfill',
                  trades_synced_at = CURRENT_TIMESTAMP,
                  trade_rows = ${rows.length},
                  trade_wallets = ${stats.wallets},
                  volume_traded = ${stats.volume.toFixed(6)},
                  trades_error = ${note}
              WHERE id = ${market.id}`,
        )
        return true
      }),
    LABEL,
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
  const limiter = new RateLimiter(POLYMARKET_DATA_ACTIVITY_RPS)

  const ac = new AbortController()
  const inFlight = new Set<number>()
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

  if (args.dryRun) {
    const markets = await selectPartialMarkets(args)
    console.log(`${LABEL} partial markets=${markets.length} (dry-run)`)
    for (const m of markets) {
      console.log(`${LABEL}   ${m.slug} capped_rows=${m.tradeRows ?? '?'}`)
    }
    console.log(`${LABEL} nothing to do (dry-run)`)
    return
  }

  const total = await countPartial(args)
  const budget = args.limit ?? total
  console.log(
    `${LABEL} partial markets=${total} budget=${budget} wallet-concurrency=${walletConcurrency}`,
  )
  if (total === 0 || budget === 0) {
    console.log(`${LABEL} nothing to do`)
    return
  }

  const progress = new ProgressTracker(LABEL, Math.min(budget, total))
  let processed = 0

  // Markets are claimed and processed one at a time (atomic partial→processing,
  // so concurrent invocations never rebuild the same market); the parallelism is
  // per-wallet inside a market (hundreds each), which is where the cost lives.
  for (;;) {
    if (ac.signal.aborted) break
    if (processed >= budget) break
    const market = await claimNextPartialMarket(args, ac.signal)
    if (!market) break
    inFlight.add(market.id)
    processed += 1

    try {
      const built = await reconstructMarket(market, walletConcurrency, limiter, ac.signal)
      const written = await writeReconstructed(market, built.rows, built)
      inFlight.delete(market.id)
      if (!written) {
        // We lost the claim mid-flight (an operator reset it, a peer took over):
        // do not overwrite their work, and do not revert — it is not ours.
        progress.record(false)
        console.warn(`${LABEL} SKIPPED ${market.slug}: lost claim mid-flight, not overwriting`)
        continue
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
            `wallets=${built.wallets}/${built.participants} vol=${built.volume.toFixed(0)} ` +
            (built.complete === true
              ? '✓complete'
              : built.complete === false
                ? `STILL SHORT ${shortfall?.toFixed(2)}%`
                : 'completeness unknown (no gamma volume)') +
            (built.takerKnown ? '' : ' TAKER_FLAGS_PARTIAL'),
        ),
      )
    } catch (err) {
      // On abort the market was NOT finished: leave it in `inFlight` so the
      // revert below returns it to `partial`. A real failure reverts it now
      // (retryable) — deep-backfill's input state IS `partial`.
      if (ac.signal.aborted) break
      await revertOwnedClaims([market.id])
      inFlight.delete(market.id)
      progress.record(false)
      console.warn(`${LABEL} FAILED ${market.slug}: ${(err as Error).message}`)
    }
  }

  // Any claim still owned here was interrupted mid-flight: return it to partial.
  let reverted = 0
  if (inFlight.size > 0) reverted = await revertOwnedClaims([...inFlight])

  // Wallet trade counters are refreshed once, at the start of sync-activity —
  // not here. Recomputing them from the full trades table (~50s) after every
  // deep-backfill invocation added up to tens of minutes across a wrapper run.

  const s = progress.summary()
  console.log(
    `${LABEL} done ok=${s.done} failed=${s.failed} in ${fmtDuration(s.elapsedMs)}` +
      (ac.signal.aborted ? ` (interrupted; reverted ${reverted} claim(s) to partial)` : ''),
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
