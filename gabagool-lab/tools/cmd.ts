/**
 * Print the stored launch cmd (and batch_uid) for one or more runs.
 * Usage: npx tsx gabagool-lab/tools/cmd.ts <runId> [<runId> ...]
 */
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '../../src/db/index.js'

const ids = process.argv.slice(2).map(Number).filter(Number.isFinite)
if (!ids.length) {
  console.error('usage: cmd.ts <runId> [...]')
  process.exit(1)
}

const db = await getDb()
const rows: any = await db.execute(
  sql`SELECT id, batch_uid, cmd FROM backtest_runs WHERE id IN ${ids}`,
)
for (const r of rows[0] ?? []) {
  console.log(`=== run ${r.id} — ${r.batch_uid}`)
  console.log(r.cmd)
  console.log()
}
await closeDb()
process.exit(0)
