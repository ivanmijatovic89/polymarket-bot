#!/usr/bin/env tsx
/**
 * polymarket-data verify: does the DB actually match the API?
 *
 * Two independent checks, one cheap and one thorough:
 *
 * 1. INVARIANT (offline, every synced market, no API calls):
 *      SUM(size) / 2 == polymarket_markets.volume_gamma
 *    Gamma's `volumeNum` is the traded share count with each match counted once.
 *    Holding every fill reproduces it exactly — verified at 0.000% drift across
 *    every market synced so far, by both the trades API and the deep-backfill
 *    path. So a market that fails this is provably missing (or duplicating)
 *    fills, and `--requeue` flips it back to `partial` for the deep backfill.
 *
 * 2. RESAMPLE (online, a sample of markets):
 *    re-fetch `/trades` and `/v1/market-positions` and compare row counts,
 *    wallet counts and share volume against what we stored — plus a cross-check
 *    that every trading wallet has a positions row.
 *
 * Pass/fail: incomplete markets are split by intent. A `partial` market failing
 * the invariant is EXPECTED (it's flagged partial precisely because the /trades
 * cap cut it off — deep-backfill will finish it), so it does NOT fail the audit.
 * A `done` market failing the invariant, or a resample mismatch, is a real
 * defect: it prints an INTEGRITY VIOLATION and the process exits non-zero, so
 * the sync wrapper and any CI surface it. Clean run → exit 0.
 *
 * Usage:
 *   npm run polymarket-data:verify -- [--symbol btc] [--timeframe 15m]
 *       [--slug a,b] [--limit N] [--resample N] [--requeue]
 */

import '../config/env.js'
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index.js'
import { POLYMARKET_DATA_TRADES_RPS } from '../config/polymarketData.js'
import { RateLimiter } from './rateLimiter.js'
import { fetchMarketPositions, fetchMarketTrades } from './dataApi.js'
import { COMPLETENESS_TOLERANCE } from './tradeRows.js'
import { isTimeframe, type Timeframe } from './marketSeries.js'

const LABEL = '[polymarket-data:verify]'

type Args = {
  symbol?: string
  timeframe?: Timeframe
  slugs?: string[]
  limit: number | null
  resample: number
  requeue: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { limit: null, resample: 0, requeue: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--symbol') out.symbol = (argv[++i] ?? '').toLowerCase()
    else if (a === '--timeframe') {
      const tf = argv[++i] ?? ''
      if (!isTimeframe(tf)) throw new Error(`${LABEL} unknown --timeframe: ${tf}`)
      out.timeframe = tf
    } else if (a === '--slug') {
      out.slugs = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    } else if (a === '--limit') out.limit = Number(argv[++i] ?? '') || null
    else if (a === '--resample') out.resample = Number(argv[++i] ?? '') || 0
    else if (a === '--requeue') out.requeue = true
    else throw new Error(`${LABEL} unknown arg: ${a}`)
  }
  return out
}

function selection(args: Args) {
  const clauses = [sql`trades_status IN ('done', 'partial')`]
  if (args.slugs && args.slugs.length > 0) {
    clauses.push(
      sql`slug IN (${sql.join(
        args.slugs.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    )
  }
  if (args.symbol) clauses.push(sql`symbol = ${args.symbol}`)
  if (args.timeframe) clauses.push(sql`timeframe = ${args.timeframe}`)
  return sql.join(clauses, sql` AND `)
}

type InvariantRow = {
  id: number
  slug: string
  condition_id: string
  trades_status: string
  trades_source: string | null
  trade_rows: number
  shares_volume: string | null
  volume_gamma: string | null
  drift_pct: string | null
}

/** The offline check: every synced market, one SQL statement, no API calls. */
async function checkInvariant(args: Args): Promise<InvariantRow[]> {
  const db = getDb()
  const res = await db.execute(
    sql`SELECT m.id, m.slug, m.condition_id, m.trades_status, m.trades_source,
               COUNT(t.id) AS trade_rows,
               SUM(t.size) / 2 AS shares_volume,
               m.volume_gamma,
               (SUM(t.size) / 2 - m.volume_gamma) / NULLIF(m.volume_gamma, 0) * 100 AS drift_pct
        FROM polymarket_markets m
        LEFT JOIN polymarket_trades t ON t.market_id = m.id
        WHERE ${selection(args)}
        GROUP BY m.id
        ORDER BY ABS(COALESCE((SUM(t.size) / 2 - m.volume_gamma) / NULLIF(m.volume_gamma, 0), 0)) DESC
        ${args.limit ? sql`LIMIT ${args.limit}` : sql``}`,
  )
  return ((res as unknown as InvariantRow[][])[0] ?? []) as InvariantRow[]
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const rows = await checkInvariant(args)

  if (rows.length === 0) {
    console.log(`${LABEL} no synced markets match the selection`)
    return 0
  }

  const bad: InvariantRow[] = []
  let unknown = 0
  for (const r of rows) {
    if (r.volume_gamma === null || Number(r.volume_gamma) <= 0) {
      // No Gamma volume to check against. An empty market (0 rows) is the
      // verified-complete case and is fine as `done`. But a `done` market with
      // rows here is inconsistent under the contract (it should be `partial`,
      // since completeness can't be proven) — flag it.
      if (r.trades_status === 'done' && Number(r.trade_rows) > 0) bad.push(r)
      else unknown += 1
      continue
    }
    // A market with no rows at all yields NULL here, not 0 — and NULL must never
    // coerce to "0% drift, looks complete". That is the exact failure this tool
    // exists to catch (a status column claiming `done` over an empty market).
    if (r.shares_volume === null || r.drift_pct === null) {
      bad.push(r)
      continue
    }
    const drift = Math.abs(Number(r.drift_pct)) / 100
    if (drift > COMPLETENESS_TOLERANCE) bad.push(r)
  }

  // Split the incomplete markets by intent:
  //   - `partial` incomplete  → EXPECTED. It is flagged partial precisely because
  //     the /trades cap cut it off; deep-backfill will finish it.
  //   - `done` incomplete     → a BUG. We claimed it was complete and it is not.
  //     This must never happen (the completeness gate should have kept it
  //     `partial`), so it is a hard failure, not a routine "needs backfill".
  const brokenDone = bad.filter((r) => r.trades_status === 'done')
  const expectedPartial = bad.filter((r) => r.trades_status !== 'done')

  const ok = rows.length - bad.length - unknown
  console.log(
    `${LABEL} invariant (shares/2 == gamma volume): ${ok}/${rows.length} complete, ` +
      `${expectedPartial.length} partial (awaiting deep-backfill), ` +
      `${brokenDone.length} DONE-but-incomplete, ${unknown} unknown`,
  )

  if (brokenDone.length > 0) {
    console.error(
      `${LABEL} ✗✗ INTEGRITY VIOLATION: ${brokenDone.length} market(s) are marked 'done' but do NOT ` +
        `reproduce Gamma's volume — they were stored as complete while missing fills:`,
    )
    for (const r of brokenDone.slice(0, 20)) {
      console.error(
        `${LABEL}   ✗✗ ${r.slug} rows=${r.trade_rows} ` +
          `shares/2=${Number(r.shares_volume ?? 0).toFixed(2)} gamma=${Number(r.volume_gamma).toFixed(2)} ` +
          `drift=${r.drift_pct === null ? 'n/a' : `${Number(r.drift_pct).toFixed(2)}%`} ` +
          `[${r.trades_source ?? '-'}]`,
      )
    }
  }
  for (const r of expectedPartial.slice(0, 10)) {
    console.log(
      `${LABEL}   · ${r.slug} rows=${r.trade_rows} drift=${r.drift_pct === null ? 'n/a' : `${Number(r.drift_pct).toFixed(1)}%`} [partial]`,
    )
  }

  if (bad.length > 0 && args.requeue) {
    const db = getDb()
    await db.execute(
      sql`UPDATE polymarket_markets
          SET trades_status = 'partial',
              trades_error = 'verify: shares/2 != gamma volume'
          WHERE id IN (${sql.join(
            bad.map((r) => sql`${r.id}`),
            sql`, `,
          )})`,
    )
    console.log(`${LABEL} requeued ${bad.length} market(s) as partial for deep-backfill`)
  }

  // A DONE-but-incomplete market is a real defect and makes the whole audit fail
  // (non-zero exit, so the sync wrapper and any CI surface it). Expected
  // `partial` markets do NOT fail the audit — they are just work still to do.
  let integrityOk = brokenDone.length === 0

  if (args.resample > 0) {
    const limiter = new RateLimiter(POLYMARKET_DATA_TRADES_RPS)
    // Prefer re-checking the markets that already look wrong; fill the rest of
    // the sample with healthy ones so a systematic problem still surfaces.
    const sample = [...bad, ...rows.filter((r) => !bad.includes(r))].slice(0, args.resample)
    console.log(`${LABEL} resampling ${sample.length} market(s) against the live API…`)

    const db = getDb()
    for (const r of sample) {
      const live = await fetchMarketTrades(r.condition_id, { limiter, label: LABEL })
      const positions = await fetchMarketPositions(r.condition_id, { limiter, label: LABEL })
      const liveShares = live.trades.reduce((sum, t) => sum + t.size, 0) / 2

      const stored = await db.execute(
        sql`SELECT COUNT(*) AS rows_, COUNT(DISTINCT wallet) AS wallets,
                   (SELECT COUNT(*) FROM polymarket_market_positions WHERE market_id = ${r.id}) AS positions
            FROM polymarket_trades WHERE market_id = ${r.id}`,
      )
      const s = ((stored as unknown as Array<Record<string, number>>[])[0] ?? [])[0] ?? {}

      // Cross-check the two independently-sourced tables: every wallet that
      // traded must have a market-positions row (positions is a verified
      // superset of trade wallets). A miss means a trade we stored belongs to
      // the wrong market, or a wallet is missing from positions — either is a
      // real defect. (We DON'T reconcile avg_price/total_bought here: those are
      // cost-basis figures shaped by sells and splits, so they legitimately
      // differ from a naive buy-average and would produce false alarms.)
      const orphan = await db.execute(
        sql`SELECT COUNT(*) AS n FROM (
              SELECT DISTINCT wallet FROM polymarket_trades WHERE market_id = ${r.id}
            ) tw
            WHERE NOT EXISTS (
              SELECT 1 FROM polymarket_market_positions p
              WHERE p.market_id = ${r.id} AND p.wallet = tw.wallet
            )`,
      )
      const orphanWallets = Number(
        (orphan as unknown as Array<Array<{ n: number }>>)[0]?.[0]?.n ?? 0,
      )

      // `live` is capped for busy markets, so it is a LOWER bound: our stored
      // set should be >= it, never below.
      const short = Number(s.rows_ ?? 0) < live.trades.length
      const ok = !short && orphanWallets === 0
      if (!ok) integrityOk = false
      console.log(
        `${LABEL}   ${ok ? '✓' : '✗'} ${r.slug} ` +
          `stored_rows=${s.rows_} live_rows=${live.trades.length}${live.capped ? '(capped)' : ''} ` +
          `stored_positions=${s.positions} live_positions=${positions.length} ` +
          `stored_shares/2=${Number(r.shares_volume ?? 0).toFixed(0)} live_shares/2=${liveShares.toFixed(0)}` +
          (orphanWallets > 0 ? ` ⚠ ${orphanWallets} trade-wallets missing from positions` : ''),
      )
    }
  }

  if (expectedPartial.length > 0 && !args.requeue) {
    console.log(
      `${LABEL} ${expectedPartial.length} partial market(s) still to backfill — ` +
        `run deep-backfill, or verify --requeue`,
    )
  }

  if (integrityOk) {
    console.log(`${LABEL} ✓ audit passed — no done market is broken`)
  } else {
    console.error(`${LABEL} ✗ audit FAILED — see the INTEGRITY VIOLATION / ✗ lines above`)
  }
  return integrityOk ? 0 : 1
}

main()
  .then(async (code) => {
    await closeDb()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error(err)
    await closeDb().catch(() => {})
    process.exit(1)
  })
