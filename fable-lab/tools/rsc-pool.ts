/**
 * rsc-pool.ts — pool the eight RESCUE-025 confirmation shard runs into
 * the ONE decisive readout and evaluate the FROZEN success bar
 * (RESCUE-025.md): SAVED iff pooled q̂ > 0 ∧ pooled t ≥ +1.5 ∧ played
 * ≥ 100 ∧ (if winRate > 0.9: minority-outcome count ≥ 30, E14); else
 * DEAD FOR GOOD. Same pooling arithmetic as scr009-pool.ts (q̂/t over
 * ALL N, results.ts convention). Read-only.
 *
 * Usage: npx tsx fable-lab/tools/rsc-pool.ts RSC-025-CONFIRM-S0 ... S7
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
  let failures = 0
  for (const uid of uids) {
    const runs = await db.select().from(backtestRuns).where(eq(backtestRuns.batchUid, uid))
    if (runs.length !== 1) throw new Error(`batchUid ${uid}: expected 1 run, got ${runs.length}`)
    if (runs[0].status !== 'completed') throw new Error(`batchUid ${uid}: status=${runs[0].status} — refuse partial read`)
    const rows = await db
      .select()
      .from(backtestRunMarkets)
      .where(eq(backtestRunMarkets.runId, runs[0].id))
    console.log(`${uid}: run ${runs[0].id} status=${runs[0].status} markets=${rows.length}`)
    for (const r of rows) {
      if (r.status === 'failed') failures++
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
  const winRate = won / Math.max(1, won + lost)
  const minority = Math.min(won, lost)
  console.log(`POOLED: N=${n} played=${played} failures=${failures} won/lost=${won}/${lost} winRate=${winRate.toFixed(4)}`)
  console.log(`  evPerMarket=${mean.toFixed(4)} sd=${sd.toFixed(4)} q=${q.toFixed(4)} t=${t.toFixed(4)} CI95=[${(mean - 1.96 * se).toFixed(4)}, ${(mean + 1.96 * se).toFixed(4)}]`)
  console.log(`  makerTrades=${maker} takerTrades=${taker} feesTotal=${fees.toFixed(4)}`)
  const e14Applies = winRate > 0.9
  const e14Pass = !e14Applies || minority >= 30
  const saved = q > 0 && t >= 1.5 && played >= 100 && e14Pass && failures === 0
  console.log(
    `FROZEN BAR: q>0=${q > 0} t>=1.5=${t >= 1.5} played>=100=${played >= 100} failures=0=${failures === 0} E14(${e14Applies ? `minority ${minority}>=30=${minority >= 30}` : 'n/a'})`,
  )
  console.log(`VERDICT: ${saved ? 'SAVED' : 'DEAD FOR GOOD'}`)
  await closeDb()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
