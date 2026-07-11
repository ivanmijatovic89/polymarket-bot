/**
 * parity.ts — per-market row parity between two backtest runs (U62, D36).
 *
 * Purpose: the engine is deterministic, so two runs of the same strategy +
 * params + markets + latency env must persist identical per-market rows
 * regardless of WHERE they executed (local wrapper `--sequential` vs the
 * worker fleet). This tool proves or refutes that, slug by slug, across every
 * outcome-bearing deterministic column.
 *
 * Outcome safety: on full parity it prints ONLY counts ("n rows identical
 * across k fields") — no outcome values are shown, so running it on a live
 * mechanism leaks nothing. On mismatch it prints slug + field + both values
 * (needed for diagnosis); mismatch output on a live mechanism is outcome
 * exposure — prefer killed/published strategies for parity checks, and treat
 * any mismatch printout as a lineage event to disclose.
 *
 * Rows are matched by slug. Slugs present in only one run are reported as
 * coverage mismatches (count + slugs; no values). Exit 0 = full parity over
 * the slug intersection AND identical slug sets; exit 2 = any mismatch;
 * exit 1 = usage/DB error. With --intersection, slug-set differences are
 * still printed but do not fail the exit code (for comparing a run against
 * a superset run, e.g. one local run covering two fleet smokes); the
 * intersection must still be non-empty and field-identical.
 *
 * Usage: npx tsx fable-lab/tools/parity.ts <runIdA> <runIdB> [--intersection]
 *        (runIdA convention: the reference/fleet run; runIdB: the candidate)
 */
import { inArray } from 'drizzle-orm'
import { getDb, closeDb } from '../../src/db/index.js'
import { backtestRunMarkets, backtestRuns } from '../../src/db/schema.js'

const argv = process.argv.slice(2)
const intersectionMode = argv.includes('--intersection')
const [aArg, bArg] = argv.filter((a) => a !== '--intersection')
const runA = Number(aArg)
const runB = Number(bArg)
if (!Number.isFinite(runA) || !Number.isFinite(runB) || runA === runB) {
  console.error('usage: npx tsx fable-lab/tools/parity.ts <runIdA> <runIdB>  (two distinct run ids)')
  process.exit(1)
}

// Deterministic engine outputs. Excluded on purpose: machineId, workerChildId,
// startedAtMs/finishedAtMs/durationMs (wall clock), commitSha (provenance,
// checked separately by the caller), idx (submission-order dependent under
// --random), id/runId.
const FIELDS = [
  'marketStartMs',
  'finalOutcome',
  'skipReason',
  'pnl',
  'tradeCount',
  'tradeAsMaker',
  'tradeAsTaker',
  'feesPaid',
  'avgEntryPriceUp',
  'avgEntryPriceDown',
  'upShares',
  'downShares',
  'mergableShares',
  'cost',
  'splitCost',
  'eventsProcessed',
  'eventsByType',
  'intentMeta',
] as const

function canon(field: string, v: unknown): string {
  if (v === null || v === undefined) return 'null'
  // decimal columns arrive as strings; compare numerically so scale
  // differences ("0.95" vs "0.950000") are not false mismatches
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return String(Number(v))
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const db = getDb()
const runs = await db
  .select({ id: backtestRuns.id, strategy: backtestRuns.strategy, params: backtestRuns.params })
  .from(backtestRuns)
  .where(inArray(backtestRuns.id, [runA, runB]))
if (runs.length !== 2) {
  console.error(`FAIL: expected both runs in backtest_runs, found ids [${runs.map((r) => r.id).join(', ')}]`)
  await closeDb()
  process.exit(1)
}
const byId = new Map(runs.map((r) => [r.id, r]))
const stratA = byId.get(runA)!
const stratB = byId.get(runB)!
if (stratA.strategy !== stratB.strategy || JSON.stringify(stratA.params) !== JSON.stringify(stratB.params)) {
  console.error(
    `FAIL: runs are not comparable — strategy/params differ (${stratA.strategy} vs ${stratB.strategy}); parity is only defined for identical specs`,
  )
  await closeDb()
  process.exit(1)
}

const rows = await db.select().from(backtestRunMarkets).where(inArray(backtestRunMarkets.runId, [runA, runB]))
const mapA = new Map(rows.filter((r) => r.runId === runA).map((r) => [r.slug, r]))
const mapB = new Map(rows.filter((r) => r.runId === runB).map((r) => [r.slug, r]))

const onlyA = [...mapA.keys()].filter((s) => !mapB.has(s)).sort()
const onlyB = [...mapB.keys()].filter((s) => !mapA.has(s)).sort()
const shared = [...mapA.keys()].filter((s) => mapB.has(s)).sort()

let mismatchCount = 0
for (const slug of shared) {
  const a = mapA.get(slug)! as Record<string, unknown>
  const b = mapB.get(slug)! as Record<string, unknown>
  for (const f of FIELDS) {
    const ca = canon(f, a[f])
    const cb = canon(f, b[f])
    if (ca !== cb) {
      mismatchCount++
      console.log(`MISMATCH ${slug} ${f}: run${runA}=${ca} run${runB}=${cb}`)
    }
  }
}

console.log(
  `parity ${runA} vs ${runB} (${stratA.strategy}): shared=${shared.length} onlyIn${runA}=${onlyA.length} onlyIn${runB}=${onlyB.length} fields=${FIELDS.length} mismatches=${mismatchCount}`,
)
if (onlyA.length > 0) console.log(`  slugs only in ${runA}: ${onlyA.join(', ')}`)
if (onlyB.length > 0) console.log(`  slugs only in ${runB}: ${onlyB.join(', ')}`)
const coverageOk = intersectionMode || (onlyA.length === 0 && onlyB.length === 0)
if (mismatchCount === 0 && coverageOk && shared.length > 0) {
  console.log(
    `PARITY${intersectionMode ? ' (intersection)' : ''}: ${shared.length} rows identical across ${FIELDS.length} fields (no outcome values printed)`,
  )
}
await closeDb()
process.exit(mismatchCount === 0 && coverageOk && shared.length > 0 ? 0 : 2)
