/**
 * holdout-lock-audit.ts — global DB-level audit of the holdout lock.
 *
 * Motivation (U50): STATE.md asserts "Holdout remains locked and unused"
 * every session, but the lock has only ever been spot-checked per-run
 * (U40 verified the four touch-lineage runs; E18 and the U35 hygiene note
 * prove post-boundary draws HAVE happened and were caught by hand). This
 * tool closes that gap mechanically: it sweeps EVERY fable-lab run in the
 * DB (strategy id `fable-%` — all lab strategies and fixtures share the
 * prefix) and reports any replayed or failed market at/past the frozen
 * holdout boundary.
 *
 * Outcome-mining safety (E15 discipline): NO outcome column is ever
 * selected. For flagged rows it prints slug, market_start_ms, and
 * maker/taker FILL COUNTS only (fills.ts precedent) — fill counts assess
 * exposure (zero-trade ⇒ the market cannot have contributed to any
 * aggregate statistic that was read) without reading results.
 *
 * Belt-and-braces: market_start_ms is cross-checked against the epoch in
 * the slug (`btc-updown-15m-<epochSec>`); any mismatch is reported.
 *
 * Usage: npx tsx fable-lab/tools/holdout-lock-audit.ts [--boundary-ms N]
 * Exit code: 0 = no post-boundary rows anywhere; 2 = at least one found
 * (classification against disclosures is the session's job, not the tool's).
 */
import { like, sql } from 'drizzle-orm'
import { getDb, closeDb } from '../../src/db/index.js'
import { backtestRunMarkets, backtestRunFailures, backtestRuns } from '../../src/db/schema.js'

// Frozen holdout boundary (protocol/registry; re-verified against
// tools/universe.ts every session): market_start_ms >= this is holdout.
const DEFAULT_BOUNDARY_MS = 1777237200000

const argv = process.argv.slice(2)
const bIdx = argv.indexOf('--boundary-ms')
const boundaryMs = bIdx >= 0 ? Number(argv[bIdx + 1]) : DEFAULT_BOUNDARY_MS
if (!Number.isFinite(boundaryMs) || boundaryMs <= 0) {
  console.error('bad --boundary-ms')
  process.exit(1)
}

const slugEpochMs = (slug: string | null): number | null => {
  const m = /^btc-updown-15m-(\d+)$/.exec(slug ?? '')
  return m ? Number(m[1]) * 1000 : null
}

const db = getDb()

const runs = await db
  .select({
    id: backtestRuns.id,
    batchUid: backtestRuns.batchUid,
    strategy: backtestRuns.strategy,
    status: backtestRuns.status,
  })
  .from(backtestRuns)
  .where(like(backtestRuns.strategy, 'fable-%'))
  .orderBy(backtestRuns.id)

console.log(`holdout-lock-audit  boundaryMs=${boundaryMs} (${new Date(boundaryMs).toISOString()})`)
console.log(`fable-lab runs found (strategy LIKE 'fable-%'): ${runs.length}\n`)

let flagged = 0
let mismatches = 0

for (const run of runs) {
  const [agg] = await db
    .select({
      n: sql<number>`count(*)`,
      post: sql<number>`sum(case when ${backtestRunMarkets.marketStartMs} >= ${boundaryMs} then 1 else 0 end)`,
      nullStart: sql<number>`sum(case when ${backtestRunMarkets.marketStartMs} is null then 1 else 0 end)`,
    })
    .from(backtestRunMarkets)
    .where(sql`${backtestRunMarkets.runId} = ${run.id}`)

  const header = `run ${String(run.id).padStart(6)}  ${String(run.batchUid).padEnd(42)} ${String(run.strategy).padEnd(24)} ${String(run.status).padEnd(10)} n=${agg.n}`

  const postRows = await db
    .select({
      slug: backtestRunMarkets.slug,
      startMs: backtestRunMarkets.marketStartMs,
      maker: backtestRunMarkets.tradeAsMaker,
      taker: backtestRunMarkets.tradeAsTaker,
    })
    .from(backtestRunMarkets)
    .where(
      sql`${backtestRunMarkets.runId} = ${run.id} and ${backtestRunMarkets.marketStartMs} >= ${boundaryMs}`,
    )

  // slug-epoch cross-check over ALL rows of the run (catches a wrong or
  // null market_start_ms hiding a post-boundary slug).
  const allRows = await db
    .select({ slug: backtestRunMarkets.slug, startMs: backtestRunMarkets.marketStartMs })
    .from(backtestRunMarkets)
    .where(sql`${backtestRunMarkets.runId} = ${run.id}`)
  const badRows = allRows.filter((r) => {
    const e = slugEpochMs(r.slug)
    return e === null || Number(r.startMs) !== e
  })
  const hiddenPost = badRows.filter((r) => {
    const e = slugEpochMs(r.slug)
    return e !== null && e >= boundaryMs && Number(r.startMs) < boundaryMs
  })

  const failRows = await db
    .select({ slug: backtestRunFailures.slug, reason: backtestRunFailures.reason })
    .from(backtestRunFailures)
    .where(sql`${backtestRunFailures.runId} = ${run.id}`)
  const postFails = failRows.filter((r) => {
    const e = slugEpochMs(r.slug)
    return e !== null && e >= boundaryMs
  })

  const clean =
    postRows.length === 0 &&
    postFails.length === 0 &&
    hiddenPost.length === 0 &&
    Number(agg.nullStart) === 0 &&
    badRows.length === 0
  console.log(`${header}  ${clean ? 'CLEAN' : 'FLAGGED'}`)

  for (const r of postRows) {
    flagged++
    console.log(
      `    POST-BOUNDARY REPLAYED: ${r.slug}  startMs=${r.startMs} (${new Date(Number(r.startMs)).toISOString()})  fills maker=${r.maker} taker=${r.taker}`,
    )
  }
  for (const r of postFails) {
    flagged++
    console.log(`    POST-BOUNDARY FAILURE ROW: ${r.slug}  reason=${String(r.reason).slice(0, 80)}`)
  }
  for (const r of badRows) {
    mismatches++
    console.log(
      `    SLUG/START MISMATCH: ${r.slug}  startMs=${r.startMs} slugEpochMs=${slugEpochMs(r.slug)}`,
    )
  }
  if (Number(agg.nullStart) > 0) console.log(`    NULL market_start_ms rows: ${agg.nullStart}`)
  void hiddenPost // subset of badRows; printed via the mismatch line above
}

console.log(
  `\nTOTAL: ${flagged} post-boundary row(s), ${mismatches} slug/start mismatch(es) across ${runs.length} runs`,
)
await closeDb()
process.exit(flagged + mismatches > 0 ? 2 : 0)
