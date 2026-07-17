/**
 * uids.ts — print batch/submission uids + status for run ids.
 *
 * The judgment-time uid check (every experiment): verify each run's
 * submission_uid matches the uuid frozen in LEDGER at launch.
 *
 * Usage: npx tsx gabagool-lab/tools/uids.ts <runId> [<runId> ...]
 */
import { inArray } from 'drizzle-orm'
import { closeDb, getDb, backtestRuns } from '../../src/db/index.js'

async function main(): Promise<void> {
  const ids = process.argv.slice(2).map(Number)
  const db = getDb()
  const rows = await db
    .select({
      id: backtestRuns.id,
      batchUid: backtestRuns.batchUid,
      submissionUid: backtestRuns.submissionUid,
      status: backtestRuns.status,
      markets: backtestRuns.marketsPersisted,
      failures: backtestRuns.failuresCount,
    })
    .from(backtestRuns)
    .where(inArray(backtestRuns.id, ids))
  for (const r of rows)
    console.log(
      `${r.id} ${r.status} m=${r.markets} f=${r.failures} ${r.batchUid} sub=${r.submissionUid}`,
    )
  await closeDb()
}
void main()
