/**
 * runs.ts — list recent backtest runs (id, batchUid, strategy, size, status).
 * Read-only. Useful to find run ids for results.ts / validate-experiment.ts.
 *
 * Usage: npx tsx fable-lab/tools/runs.ts [--limit 20] [--strategy <id>] [--exp EXP-012]
 */
import { desc, eq, like, and, type SQL } from 'drizzle-orm'
import { getDb, closeDb, backtestRuns } from '../../src/db/index.js'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const db = getDb()
  const conds: SQL[] = []
  const strategy = argValue('--strategy')
  const exp = argValue('--exp')
  if (strategy) conds.push(eq(backtestRuns.strategy, strategy))
  if (exp) conds.push(like(backtestRuns.batchUid, `${exp}%`))
  const rows = await db
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
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(backtestRuns.id))
    .limit(Number(argValue('--limit') ?? '20'))
  for (const r of rows) {
    console.log(
      `${String(r.id).padStart(6)}  ${String(r.batchUid).padEnd(40)} ${String(r.strategy).padEnd(28)} ${String(r.status).padEnd(10)} markets=${r.markets} fail=${r.failures} ${r.createdAt?.toISOString?.() ?? r.createdAt}`,
    )
  }
  if (rows.length === 0) console.log('(no runs matched)')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
