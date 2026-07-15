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
 *       [--slug a,b] [--limit N] [--concurrency N] [--wallet-concurrency N] [--dry-run]
 */

import '../config/env.js'
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index.js'
import { withDeadlockRetry } from '../db/txRetry.js'
import { POLYMARKET_DATA_ACTIVITY_RPS } from '../config/polymarketData.js'
import { RateLimiter } from './rateLimiter.js'
import { fetchActivity } from './activityApi.js'
import { buildReconstructedRows, takerKeysOf, type ReconstructedRow } from './reconstruct.js'
import { fetchMarketPositions, fetchMarketTakerTrades } from './dataApi.js'
import { fmtDuration, ProgressTracker } from './marketQueue.js'
import { COMPLETENESS_TOLERANCE, tradeCompleteness } from './tradeRows.js'
import { parseSyncArgs, type SyncArgs } from './syncArgs.js'
import { upsertWallets } from './walletUpsert.js'

const LABEL = '[polymarket-data:deep-backfill]'
const INSERT_CHUNK = 1000
const DEFAULT_WALLET_CONCURRENCY = 8

type PartialMarket = {
  id: number
  conditionId: string
  slug: string
  marketStartMs: number
  marketEndMs: number
  volumeGamma: number | null
  tradeRows: number | null
}

async function selectPartialMarkets(args: SyncArgs): Promise<PartialMarket[]> {
  const db = getDb()
  const clauses = [sql`trades_status = 'partial'`]
  if (args.slugs && args.slugs.length > 0) {
    clauses.length = 0
    clauses.push(
      sql`slug IN (${sql.join(
        args.slugs.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    )
  } else {
    if (args.symbol) clauses.push(sql`symbol = ${args.symbol}`)
    if (args.timeframe) clauses.push(sql`timeframe = ${args.timeframe}`)
  }
  const limit = args.limit ?? 1000

  const res = await db.execute(
    sql`SELECT id, condition_id, slug, market_start_ms, market_end_ms, volume_gamma, trade_rows
        FROM polymarket_markets
        WHERE ${sql.join(clauses, sql` AND `)}
        ORDER BY market_start_ms ${args.latest ? sql`DESC` : sql`ASC`}
        LIMIT ${limit}`,
  )
  const rows = (res as unknown as Array<Record<string, unknown>>[])[0] ?? []
  return rows.map((r) => ({
    id: Number(r.id),
    conditionId: String(r.condition_id),
    slug: String(r.slug),
    marketStartMs: Number(r.market_start_ms),
    marketEndMs: Number(r.market_end_ms),
    volumeGamma: r.volume_gamma === null ? null : Number(r.volume_gamma),
    tradeRows: r.trade_rows === null ? null : Number(r.trade_rows),
  }))
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
      ? Math.abs((sharesVolume - market.volumeGamma) / market.volumeGamma) <= COMPLETENESS_TOLERANCE
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
): Promise<void> {
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

  await withDeadlockRetry(
    () =>
      db.transaction(async (tx) => {
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
  let shuttingDown = false
  const onSignal = () => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    console.log(`${LABEL} shutting down; finishing the current market…`)
    ac.abort()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  const markets = await selectPartialMarkets(args)
  console.log(
    `${LABEL} partial markets=${markets.length} wallet-concurrency=${walletConcurrency} dry-run=${args.dryRun}`,
  )
  if (args.dryRun || markets.length === 0) {
    for (const m of markets) {
      console.log(`${LABEL}   ${m.slug} capped_rows=${m.tradeRows ?? '?'}`)
    }
    console.log(`${LABEL} nothing to do${args.dryRun ? ' (dry-run)' : ''}`)
    return
  }

  const progress = new ProgressTracker(LABEL, markets.length)

  // Markets are processed one at a time; the parallelism is per-wallet inside a
  // market (hundreds of wallets each), which is where the request cost lives.
  for (const market of markets) {
    if (ac.signal.aborted) break
    try {
      const built = await reconstructMarket(market, walletConcurrency, limiter, ac.signal)
      await writeReconstructed(market, built.rows, built)
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
      if (ac.signal.aborted) break
      progress.record(false)
      console.warn(`${LABEL} FAILED ${market.slug}: ${(err as Error).message}`)
    }
  }

  // Wallet trade counters are refreshed once, at the start of sync-activity —
  // not here. Recomputing them from the full trades table (~50s) after every
  // deep-backfill invocation added up to tens of minutes across a wrapper run.

  const s = progress.summary()
  console.log(
    `${LABEL} done ok=${s.done} failed=${s.failed} in ${fmtDuration(s.elapsedMs)}` +
      (ac.signal.aborted ? ' (interrupted)' : ''),
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
