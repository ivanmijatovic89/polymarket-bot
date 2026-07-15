#!/usr/bin/env tsx
/**
 * polymarket-data sync-positions (stage 2): final per-wallet outcome for every
 * closed market, from `/v1/market-positions`.
 *
 * Runs BEFORE the trades stage on purpose. It is one cheap call per market, and
 * its wallet list is a strict superset of the wallets visible in `/trades`
 * (verified on real markets: every trading wallet appears, plus wallets that
 * only ever split/merged/redeemed). So it discovers every participant up front —
 * including for markets whose `/trades` pages will turn out to be capped, where
 * it is the only complete participant list we can get.
 *
 * Usage:
 *   npm run polymarket-data:sync-positions -- [--symbol btc] [--timeframe 15m]
 *       [--slug a,b] [--limit N] [--latest] [--concurrency N] [--dry-run]
 *       [--retry-failed] [--reset-processing]
 */

import '../config/env.js'
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index.js'
import { withDeadlockRetry } from '../db/txRetry.js'
import { POLYMARKET_DATA_TRADES_RPS } from '../config/polymarketData.js'
import { RateLimiter } from './rateLimiter.js'
import { fetchMarketPositions, type ApiPosition } from './dataApi.js'
import {
  claimNextMarket,
  countPending,
  fmtDuration,
  markFailed,
  ProgressTracker,
  requeue,
  revertOwnedClaims,
  type ClaimedMarket,
} from './marketQueue.js'
import { parseSyncArgs, queueFilterOf } from './syncArgs.js'
import { upsertWallets } from './walletUpsert.js'

const LABEL = '[polymarket-data:sync-positions]'
const INSERT_CHUNK = 500

function dec(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(6) : null
}

/**
 * Replace a market's positions wholesale inside one transaction: the API rows
 * carry no id we could dedupe on, and a market's position set is a snapshot, so
 * "delete + insert" is both the retry story and the correctness story.
 */
async function writePositions(market: ClaimedMarket, positions: ApiPosition[]): Promise<void> {
  const db = getDb()

  // One row per (wallet, asset): a wallet can hold both outcomes, but the API
  // must not hand us the same pair twice.
  const unique = new Map<string, ApiPosition>()
  for (const p of positions) {
    unique.set(`${p.proxyWallet.toLowerCase()}|${p.asset}`, p)
  }
  const rows = [...unique.values()]

  await withDeadlockRetry(
    () =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`DELETE FROM polymarket_market_positions WHERE market_id = ${market.id}`,
        )

        for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
          const chunk = rows.slice(i, i + INSERT_CHUNK)
          const values = chunk.map(
            (p) =>
              sql`(${market.id}, ${p.proxyWallet.toLowerCase()}, ${p.asset}, ${p.outcomeIndex ?? null},
               ${dec(p.size)}, ${dec(p.avgPrice)}, ${dec(p.totalBought)}, ${dec(p.realizedPnl)}, ${dec(p.cashPnl)})`,
          )
          await tx.execute(
            sql`INSERT INTO polymarket_market_positions
              (market_id, wallet, asset, outcome_index, final_size, avg_price, total_bought, realized_pnl, cash_pnl)
            VALUES ${sql.join(values, sql`, `)}`,
          )
        }

        await tx.execute(
          sql`UPDATE polymarket_markets
          SET positions_status = 'done',
              positions_synced_at = CURRENT_TIMESTAMP,
              position_rows = ${rows.length},
              positions_error = NULL
          WHERE id = ${market.id}`,
        )
      }),
    LABEL,
  )

  await upsertWallets(
    rows.map((p) => ({
      wallet: p.proxyWallet,
      name: p.name ?? null,
      pseudonym: p.pseudonym ?? null,
    })),
  )
}

async function main(): Promise<void> {
  const args = parseSyncArgs(process.argv.slice(2), LABEL)
  const filter = queueFilterOf(args)
  const limiter = new RateLimiter(POLYMARKET_DATA_TRADES_RPS)

  const ac = new AbortController()
  const inFlight = new Set<number>()
  let shuttingDown = false
  const onSignal = () => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    console.log(`${LABEL} shutting down; finishing in-flight markets…`)
    ac.abort()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  const dry = args.dryRun
  if (args.resetProcessing) {
    const n = await requeue('positions', ['processing'], filter, { dryRun: dry })
    console.log(`${LABEL} ${dry ? 'would reset' : 'reset'} ${n} stuck 'processing' markets`)
  }
  if (args.retryFailed) {
    const n = await requeue('positions', ['failed'], filter, { dryRun: dry })
    console.log(`${LABEL} ${dry ? 'would requeue' : 'requeued'} ${n} failed markets`)
  }

  const pending = await countPending('positions', filter)
  const budget = args.limit === null ? pending : Math.min(args.limit, pending)
  console.log(
    `${LABEL} pending=${pending} budget=${budget} concurrency=${args.concurrency} dry-run=${args.dryRun}`,
  )
  if (args.dryRun || budget === 0) {
    console.log(`${LABEL} nothing to do${args.dryRun ? ' (dry-run)' : ''}`)
    return
  }

  const progress = new ProgressTracker(LABEL, budget)
  let claimed = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      if (ac.signal.aborted) return
      if (claimed >= budget) return
      claimed += 1

      const market = await claimNextMarket('positions', filter, ac.signal)
      if (!market) return
      inFlight.add(market.id)

      try {
        const positions = await fetchMarketPositions(market.conditionId, {
          limiter,
          signal: ac.signal,
          label: LABEL,
        })
        await writePositions(market, positions)
        inFlight.delete(market.id) // finalized in the DB — release ownership
        progress.record(true)
        console.log(progress.line(`${market.slug} positions=${positions.length}`))
      } catch (err) {
        // On abort the market was NOT finalized: leave it in `inFlight` so the
        // revert below returns it to `pending`. Only a real failure is marked
        // `failed` and released.
        if (ac.signal.aborted) return
        await markFailed('positions', market.id, (err as Error).message)
        inFlight.delete(market.id)
        progress.record(false)
        console.warn(`${LABEL} FAILED ${market.slug}: ${(err as Error).message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()))
  const reverted = await revertOwnedClaims('positions', [...inFlight])

  const s = progress.summary()
  console.log(
    `${LABEL} done ok=${s.done} failed=${s.failed} in ${fmtDuration(s.elapsedMs)}` +
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
