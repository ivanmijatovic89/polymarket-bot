/**
 * runs.ts — list recent backtest runs (id, batchUid, strategy, status).
 *
 * Usage: npx tsx gabagool-lab/tools/runs.ts [--limit 20] [--mine]
 *   --mine filters to lab runs (batchUid LIKE 'glab--%').
 */
import { desc, like } from 'drizzle-orm'
import { closeDb, getDb, backtestRuns } from '../../src/db/index.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--limit')
  const limit = i >= 0 ? Number(argv[i + 1]) : 20
  const mine = argv.includes('--mine')
  const db = getDb()
  const base = db
    .select({
      id: backtestRuns.id,
      batchUid: backtestRuns.batchUid,
      strategy: backtestRuns.strategy,
      status: backtestRuns.status,
      markets: backtestRuns.marketsPersisted,
      failures: backtestRuns.failuresCount,
      createdAt: backtestRuns.createdAt,
    })
    .from(backtestRuns)
  const rows = await (mine ? base.where(like(backtestRuns.batchUid, 'glab--%')) : base)
    .orderBy(desc(backtestRuns.id))
    .limit(Number.isFinite(limit) && limit > 0 ? limit : 20)
  for (const r of rows) {
    console.log(
      `${String(Number(r.id)).padStart(5)}  ${String(r.status).padEnd(9)}  m=${String(
        r.markets ?? 0,
      ).padStart(5)} f=${String(r.failures ?? 0).padStart(3)}  ${String(r.strategy).padEnd(34)}  ${
        r.batchUid
      }`,
    )
  }
  await closeDb()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
