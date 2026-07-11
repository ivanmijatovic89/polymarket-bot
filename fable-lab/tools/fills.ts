/**
 * fills.ts — maker/taker fill COUNTS for runs, with PnL never selected.
 *
 * Purpose (LESSONS E15 discipline): maker experiments must budget fills from
 * measured punch-through frequency BEFORE freezing a parameter cell. Reading
 * outcome columns (pnl) during that design step would be outcome mining and
 * would multiply lineage_cells; this reader makes the safe read easy and the
 * unsafe one impossible — it selects only trade_as_maker / trade_as_taker
 * counts (plus run params/batchUid for labeling). NOTE (U75): the original
 * header also claimed skip_reason counts — never implemented; comment fixed
 * to match the code rather than widening the query surface.
 *
 * Usage: npx tsx fable-lab/tools/fills.ts <runId> [<runId> ...]
 */
import { eq, sql } from 'drizzle-orm'
import { getDb, closeDb } from '../../src/db/index.js'
import { backtestRunMarkets, backtestRuns } from '../../src/db/schema.js'

const runIds = process.argv.slice(2).map(Number).filter(Number.isFinite)
if (runIds.length === 0) {
  console.error('usage: npx tsx fable-lab/tools/fills.ts <runId> [<runId> ...]')
  process.exit(1)
}

const db = getDb()
for (const runId of runIds) {
  const [run] = await db
    .select({ id: backtestRuns.id, params: backtestRuns.params, batchUid: backtestRuns.batchUid })
    .from(backtestRuns)
    .where(eq(backtestRuns.id, runId))
  const [agg] = await db
    .select({
      n: sql<number>`count(*)`,
      filledMarkets: sql<number>`sum(case when ${backtestRunMarkets.tradeAsMaker} + ${backtestRunMarkets.tradeAsTaker} > 0 then 1 else 0 end)`,
      makerFills: sql<number>`sum(${backtestRunMarkets.tradeAsMaker})`,
      takerFills: sql<number>`sum(${backtestRunMarkets.tradeAsTaker})`,
    })
    .from(backtestRunMarkets)
    .where(eq(backtestRunMarkets.runId, runId))
  console.log(
    `run ${runId} batch=${run?.batchUid} params=${JSON.stringify(run?.params)}\n` +
      `  n=${agg.n} filledMarkets=${agg.filledMarkets} makerFills=${agg.makerFills} takerFills=${agg.takerFills}`,
  )
}
await closeDb()
