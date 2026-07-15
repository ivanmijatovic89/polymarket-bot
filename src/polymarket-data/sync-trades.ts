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
import { buildTradeRows, type TradeRow } from './tradeRows.js'
import { upsertWallets } from './walletUpsert.js'

const LABEL = '[polymarket-data:sync-trades]'
const INSERT_CHUNK = 1000

async function writeTrades(
  market: ClaimedMarket,
  rows: TradeRow[],
  stats: { volumeTraded: number; wallets: number; partial: boolean },
): Promise<void> {
  const db = getDb()

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
          SET trades_status = ${stats.partial ? 'partial' : 'done'},
              trades_source = 'trades-api',
              trades_synced_at = CURRENT_TIMESTAMP,
              trade_rows = ${rows.length},
              trade_wallets = ${stats.wallets},
              volume_traded = ${stats.volumeTraded.toFixed(6)},
              trades_error = ${stats.partial ? 'fills missing (offset cap); awaiting deep-backfill' : null}
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

  if (args.resetProcessing) {
    const n = await requeue('trades', ['processing'], filter)
    console.log(`${LABEL} reset ${n} stuck 'processing' markets to pending`)
  }
  if (args.retryFailed) {
    const n = await requeue('trades', ['failed'], filter)
    console.log(`${LABEL} requeued ${n} failed markets`)
  }
  if (args.retryPartial) {
    const n = await requeue('trades', ['partial'], filter)
    console.log(`${LABEL} requeued ${n} partial markets`)
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

        // A market is `done` only if it reproduces Gamma's share count exactly.
        // Paging's own "did I hit the cap" signal is a hint, not the authority:
        // `complete === false` means fills are provably missing even if paging
        // thought it saw everything, and that market goes to deep-backfill.
        const incomplete = built.complete === false || all.capped || taker.capped

        await writeTrades(market, built.rows, {
          volumeTraded: built.volumeTraded,
          wallets: built.wallets,
          partial: incomplete,
        })
        await upsertWallets(walletSightings(all.trades))

        if (incomplete) partialCount += 1
        progress.record(true)
        console.log(
          progress.line(
            `${market.slug} rows=${built.rows.length} taker=${built.takerRows} ` +
              `wallets=${built.wallets} vol=${built.volumeTraded.toFixed(0)}` +
              (all.usedSideSplit ? ' side-split' : '') +
              (incomplete ? ' PARTIAL' : ' ✓complete'),
          ),
        )
      } catch (err) {
        if (ac.signal.aborted) return
        await markFailed('trades', market.id, (err as Error).message)
        progress.record(false)
        console.warn(`${LABEL} FAILED ${market.slug}: ${(err as Error).message}`)
      } finally {
        inFlight.delete(market.id)
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()))
  await revertOwnedClaims('trades', [...inFlight])

  // NOTE: wallet trade_count / first/last-trade are NOT recomputed here. They
  // are derived from the whole polymarket_trades table (6M+ rows, ~50s), and
  // doing it after every stage invocation — the wrapper runs this stage once per
  // symbol/timeframe — wasted tens of minutes re-aggregating unchanged data. The
  // refresh now runs once, at the start of sync-activity, which is the only
  // consumer of those counts.

  const s = progress.summary()
  console.log(
    `${LABEL} done ok=${s.done} failed=${s.failed} partial=${partialCount} in ${fmtDuration(s.elapsedMs)}` +
      (ac.signal.aborted ? ' (interrupted; claims reverted)' : ''),
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
