/**
 * scr009-pool.ts — pool the six SCR-009 shard runs into the one BATCH-004
 * decisive readout (q̂/t over ALL N per the D49 results.ts convention).
 *
 * Reads per-market pnl rows for the given batchUids directly (same tables
 * as results.ts) and computes pooled N, played, EV/market, sd, q̂, t,
 * CI95, win rate, maker/taker trade counts. Read-only.
 *
 * Usage: npx tsx fable-lab/tools/scr009-pool.ts SCR-009-touch-s0 ... s5
 */
import { eq } from 'drizzle-orm'
import { getDb, closeDb, backtestRuns, backtestRunMarkets } from '../../src/db/index.js'

async function main() {
  const uids = process.argv.slice(2)
  if (uids.length === 0) throw new Error('pass batchUids')
  const db = getDb()
  const pnls: number[] = []
  let played = 0
  let won = 0
  let lost = 0
  let maker = 0
  let taker = 0
  let fees = 0
  for (const uid of uids) {
    const runs = await db.select().from(backtestRuns).where(eq(backtestRuns.batchUid, uid))
    if (runs.length !== 1) throw new Error(`batchUid ${uid}: expected 1 run, got ${runs.length}`)
    const rows = await db
      .select()
      .from(backtestRunMarkets)
      .where(eq(backtestRunMarkets.runId, runs[0].id))
    console.log(`${uid}: run ${runs[0].id} status=${runs[0].status} markets=${rows.length}`)
    for (const r of rows) {
      const pnl = Number(r.pnl ?? 0)
      pnls.push(pnl)
      const trades = Number(r.tradeCount ?? 0)
      if (trades > 0) {
        played++
        if (pnl > 0) won++
        if (pnl < 0) lost++
      }
      maker += Number(r.tradeAsMaker ?? 0)
      taker += Number(r.tradeAsTaker ?? 0)
      fees += Number(r.feesPaid ?? 0)
    }
  }
  const n = pnls.length
  const mean = pnls.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
  const q = mean / sd
  const t = q * Math.sqrt(n)
  const se = sd / Math.sqrt(n)
  console.log(`POOLED: N=${n} played=${played} won/lost=${won}/${lost} winRate=${(won / Math.max(1, won + lost)).toFixed(4)}`)
  console.log(`  evPerMarket=${mean.toFixed(4)} sd=${sd.toFixed(4)} q=${q.toFixed(4)} t=${t.toFixed(4)} CI95=[${(mean - 1.96 * se).toFixed(4)}, ${(mean + 1.96 * se).toFixed(4)}]`)
  console.log(`  makerTrades=${maker} takerTrades=${taker} feesTotal=${fees.toFixed(4)}`)
  await closeDb()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
