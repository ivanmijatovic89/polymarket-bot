/**
 * exp001-check.ts — mechanical check of EXP-001's falsifiable prediction.
 *
 * Prediction (spec): among entered markets, realized win rate > mean entry
 * ask, and gross EV per entered market > 0 before fees. Entry data comes
 * from intent_meta (side, entryAsk); outcome from final_outcome.
 *
 * Read-only diagnostic. Decisive q/t/EV numbers still come from
 * tools/results.ts — this tool answers only the prediction clause.
 *
 * Usage: npx tsx fable-lab/tools/exp001-check.ts --run <id>
 *        npx tsx fable-lab/tools/exp001-check.ts --batch EXP-001-probe
 */
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '../../src/db/index.js'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

type EntryRow = {
  slug: string
  outcome: string | null
  side: string
  entryAsk: number
  elapsedSec: number | null
  pnl: number
}

async function main() {
  const runId = argValue('--run')
  const batch = argValue('--batch')
  if (!runId && !batch) throw new Error('usage: exp001-check.ts --run <id> | --batch <uid>')

  const db = getDb()
  const where = runId
    ? sql`m.run_id = ${Number(runId)}`
    : sql`m.run_id = (SELECT MAX(id) FROM backtest_runs WHERE batch_uid = ${batch})`
  const rows: any = await db.execute(sql`
    SELECT m.slug, m.final_outcome, m.pnl, m.intent_meta
    FROM backtest_run_markets m
    WHERE ${where} AND m.trade_count > 0`)

  const entries: EntryRow[] = []
  for (const r of rows[0]) {
    const metas = Array.isArray(r.intent_meta) ? r.intent_meta : []
    for (const meta of metas) {
      if (meta?.exp !== 'EXP-001') continue
      entries.push({
        slug: r.slug,
        outcome: r.final_outcome,
        side: String(meta.side),
        entryAsk: Number(meta.entryAsk),
        elapsedSec: meta.elapsedSec != null ? Number(meta.elapsedSec) : null,
        pnl: Number(r.pnl),
      })
    }
  }

  const n = entries.length
  if (n === 0) {
    console.log('entered markets: 0 — prediction untestable (design failure per spec)')
    return
  }
  const wins = entries.filter((e) => e.outcome === e.side)
  const meanAsk = entries.reduce((s, e) => s + e.entryAsk, 0) / n
  const winRate = wins.length / n
  // Gross EV per entered market per share: win pays (1 - ask), loss pays -ask.
  const grossEvPerShare =
    entries.reduce((s, e) => s + (e.outcome === e.side ? 1 - e.entryAsk : -e.entryAsk), 0) / n

  console.log(`entered markets: ${n}`)
  console.log(`mean entry ask:  ${meanAsk.toFixed(4)}`)
  console.log(`win rate:        ${winRate.toFixed(4)}  (${wins.length}/${n})`)
  console.log(`win rate − mean ask: ${(winRate - meanAsk).toFixed(4)}`)
  console.log(`gross EV/share (pre-fee): ${grossEvPerShare.toFixed(5)}`)
  console.log(
    `PREDICTION ${winRate > meanAsk && grossEvPerShare > 0 ? 'HOLDS' : 'CONTRADICTED'}: ` +
      `win rate ${winRate > meanAsk ? '>' : '<='} mean entry ask AND gross EV ${grossEvPerShare > 0 ? '>' : '<='} 0`,
  )

  // Bucketed diagnostic: win rate by entry-ask bucket (width 0.02).
  const buckets = new Map<string, { n: number; w: number }>()
  for (const e of entries) {
    const b = (Math.floor(e.entryAsk / 0.02) * 0.02).toFixed(2)
    const cur = buckets.get(b) ?? { n: 0, w: 0 }
    cur.n += 1
    if (e.outcome === e.side) cur.w += 1
    buckets.set(b, cur)
  }
  console.log('\nask bucket -> win rate (n):')
  for (const [b, v] of [...buckets.entries()].sort()) {
    console.log(`  ${b}-${(Number(b) + 0.02).toFixed(2)}: ${(v.w / v.n).toFixed(3)} (${v.n})`)
  }

  // Crossed-book sanity (LESSONS E6): entries at suspiciously low asks for a
  // "near-certain" mechanism would show up as low buckets here.
  const low = entries.filter((e) => e.entryAsk < 0.85)
  if (low.length > 0) {
    console.log(`\nWARN ${low.length} entries below ask 0.85 — inspect for crossed-book artifacts (E6)`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
