// Pre-verdict integrity: each RSC-025-CONFIRM-Sn run's slug set must equal
// the frozen shard file logs/RESCUE-025-shard<n>.slugs. Outcome-free (slugs only).
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { getDb, closeDb, backtestRuns, backtestRunMarkets } from '../../src/db/index.js'

async function main() {
  const db = getDb()
  let bad = 0
  for (let s = 0; s < 8; s++) {
    const uid = `RSC-025-CONFIRM-S${s}`
    const runs = await db.select().from(backtestRuns).where(eq(backtestRuns.batchUid, uid))
    if (runs.length !== 1) { console.log(`${uid}: runs=${runs.length} FAIL`); bad++; continue }
    const rows = await db.select({ slug: backtestRunMarkets.slug })
      .from(backtestRunMarkets).where(eq(backtestRunMarkets.runId, runs[0].id))
    const got = new Set(rows.map(r => r.slug))
    const want = new Set(readFileSync(`fable-lab/logs/RESCUE-025-shard${s}.slugs`, 'utf8').trim().split(','))
    const missing = [...want].filter(x => !got.has(x))
    const extra = [...got].filter(x => !want.has(x))
    const ok = missing.length === 0 && extra.length === 0 && got.size === 500
    console.log(`${uid}: run ${runs[0].id} slugs=${got.size} missing=${missing.length} extra=${extra.length} ${ok ? 'OK' : 'FAIL'}`)
    if (!ok) { bad++; if (missing.length) console.log('  missing:', missing.slice(0, 5).join(',')); if (extra.length) console.log('  extra:', extra.slice(0, 5).join(',')) }
  }
  console.log(bad === 0 ? 'SLUG-SET INTEGRITY: ALL 8 SHARDS OK' : `SLUG-SET INTEGRITY: ${bad} SHARD(S) FAIL`)
  await closeDb()
  process.exit(bad === 0 ? 0 : 2)
}
main()
