#!/usr/bin/env tsx
/**
 * polymarket-data sync-trades (stage 3): every fill (maker AND taker rows) for
 * each closed market, from `/trades`.
 *
 * A market's rows are fetched once, after it closes, and written whole inside
 * one transaction (delete + insert). The API gives rows no unique id, and two
 * genuinely identical fills can exist, so whole-market replacement — not
 * row-level dedup — is what makes retries safe.
 *
 * Markets whose rows exceed what the API's offset cap can reach are stored as
 * far as they go and marked `partial`; the deep-backfill stage reconstructs them
 * per-wallet. They are never silently truncated into `done`.
 *
 * Usage:
 *   npm run polymarket-data:sync-trades -- [--symbol btc] [--timeframe 15m]
 *       [--slug a,b] [--limit N] [--latest] [--concurrency N] [--dry-run]
 *       [--retry-failed] [--retry-partial] [--reset-processing]
 */

import '../config/env.js'
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index.js'
import { withDeadlockRetry } from '../db/txRetry.js'
import { POLYMARKET_DATA_TRADES_RPS } from '../config/polymarketData.js'
import { RateLimiter } from './rateLimiter.js'
import { fetchMarketTakerTrades, fetchMarketTrades, type ApiTrade } from './dataApi.js'
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
import { buildTradeRows, tradeCompleteness, type TradeRow } from './tradeRows.js'
import { upsertWallets } from './walletUpsert.js'
import { marketVerification, writeMarketTrades } from './storage/parquetFacts.js'
import { assertMarketSnapshot } from './marketSnapshotVerification.js'

const LABEL = '[polymarket-data:sync-trades]'
async function writeTrades(
  market: ClaimedMarket,
  rows: TradeRow[],
  stats: {
    volumeTraded: number
    sharesVolume: number
    wallets: number
    complete: boolean | null
    partial: boolean
    error: string | null
  },
): Promise<void> {
  const db = getDb()

  // Facts live in Parquet. Publish the complete market snapshot atomically,
  // then keep only its small status/summary record in MySQL.
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

  await withDeadlockRetry(
    () =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`UPDATE polymarket_markets
          SET trades_status = ${stats.partial ? 'partial' : 'done'},
              trades_source = 'trades-api',
              trades_synced_at = CURRENT_TIMESTAMP,
              trade_rows = ${rows.length},
              trade_wallets = ${stats.wallets},
              volume_traded = ${stats.volumeTraded.toFixed(6)},
              trades_error = ${stats.error}
          WHERE id = ${market.id}`,
        )
      }),
    LABEL,
  )
}

function walletSightings(trades: ApiTrade[]) {
  return trades.map((t) => ({
    wallet: t.proxyWallet,
    name: t.name ?? null,
    pseudonym: t.pseudonym ?? null,
  }))
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
  const wouldOrDid = dry ? 'would requeue' : 'requeued'
  if (args.resetProcessing) {
    const n = await requeue('trades', ['processing'], filter, { dryRun: dry })
    console.log(`${LABEL} ${dry ? 'would reset' : 'reset'} ${n} stuck 'processing' markets`)
  }
  if (args.retryFailed) {
    const n = await requeue('trades', ['failed'], filter, { dryRun: dry })
    console.log(`${LABEL} ${wouldOrDid} ${n} failed markets`)
  }
  if (args.retryPartial) {
    const n = await requeue('trades', ['partial'], filter, { dryRun: dry })
    console.log(`${LABEL} ${wouldOrDid} ${n} partial markets`)
  }

  const pending = await countPending('trades', filter)
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
  let partialCount = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      if (ac.signal.aborted) return
      if (claimed >= budget) return
      claimed += 1

      const market = await claimNextMarket('trades', filter, ac.signal)
      if (!market) return
      inFlight.add(market.id)

      try {
        const fetchOpts = { limiter, signal: ac.signal, label: LABEL }
        const all = await fetchMarketTrades(market.conditionId, fetchOpts)
        const taker = await fetchMarketTakerTrades(market.conditionId, fetchOpts)

        const built = buildTradeRows({
          trades: all.trades,
          takerTrades: taker.trades,
          market: {
            conditionId: market.conditionId,
            slug: market.slug,
            marketStartMs: market.marketStartMs,
            marketEndMs: market.marketEndMs,
            volumeGamma: market.volumeGamma,
          },
        })

        for (const w of built.warnings) {
          console.warn(`${LABEL} WARN ${market.slug}: ${w}`)
        }
        if (built.foreignRows > 0) {
          throw new Error(
            `${built.foreignRows} API trade row(s) failed the condition-id verification`,
          )
        }

        // Two INDEPENDENT dimensions:
        //   - row completeness (built.complete) drives `partial`; only proven
        //     complete rows may be `done`. `all.capped` only refines the wording.
        //   - a capped TAKER query leaves some takers labelled makers: that does
        //     NOT make the market `partial` (all rows are present, invariant
        //     holds), but the diagnostic is always recorded — never cleared.
        const { partial, error } = tradeCompleteness({
          complete: built.complete,
          takerCapped: taker.capped || built.unmatchedTakers > 0,
          shortRowsNote: all.capped
            ? 'fills missing (offset cap); awaiting deep-backfill'
            : 'fills missing (invariant failed); awaiting deep-backfill',
        })

        await writeTrades(market, built.rows, {
          volumeTraded: built.volumeTraded,
          sharesVolume: built.sharesVolume,
          wallets: built.wallets,
          complete: built.complete,
          partial,
          error,
        })
        await upsertWallets(walletSightings(all.trades))
        inFlight.delete(market.id) // finalized in the DB — release ownership

        if (partial) partialCount += 1
        progress.record(true)
        console.log(
          progress.line(
            `${market.slug} rows=${built.rows.length} taker=${built.takerRows} ` +
              `wallets=${built.wallets} vol=${built.volumeTraded.toFixed(0)}` +
              (all.usedSideSplit ? ' side-split' : '') +
              (partial ? ' PARTIAL' : ' ✓complete') +
              (taker.capped || built.unmatchedTakers > 0 ? ' taker-incomplete' : ''),
          ),
        )
      } catch (err) {
        // On abort the market was NOT finalized: leave it in `inFlight` so the
        // revert below returns it to `pending`. Only a real failure is marked
        // `failed` and released.
        if (ac.signal.aborted) return
        await markFailed('trades', market.id, (err as Error).message)
        inFlight.delete(market.id)
        progress.record(false)
        console.warn(`${LABEL} FAILED ${market.slug}: ${(err as Error).message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()))
  const reverted = await revertOwnedClaims('trades', [...inFlight])

  // NOTE: wallet trade_count / first/last-trade are NOT recomputed here. They
  // are derived from all trade Parquet files, and
  // doing it after every stage invocation — the wrapper runs this stage once per
  // symbol/timeframe — wasted tens of minutes re-aggregating unchanged data. The
  // refresh now runs once, at the start of sync-activity, which is the only
  // consumer of those counts.

  const s = progress.summary()
  console.log(
    `${LABEL} done ok=${s.done} failed=${s.failed} partial=${partialCount} in ${fmtDuration(s.elapsedMs)}` +
      (reverted > 0 ? ` (interrupted; reverted ${reverted} claim(s) to pending)` : ''),
  )
  if (partialCount > 0) {
    console.log(
      `${LABEL} ${partialCount} market(s) exceeded the /trades offset cap — run polymarket-data:deep-backfill`,
    )
  }
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
