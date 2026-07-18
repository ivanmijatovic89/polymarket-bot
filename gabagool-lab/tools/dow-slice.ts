/**
 * dow-slice.ts — DIAGNOSTIC weekday/weekend EL split for a run
 * (A-10 fold, KB A59/A63: the favorite-lean payload is
 * weekday-native and collapses on weekends; g00's edge IS that
 * payload, so the weekend cells are a falsification probe).
 *
 * NOT part of any frozen criteria — a narrative readout only.
 * Buckets by UTC day-of-week of market_start_ms (Sat/Sun =
 * weekend), plus the full 7-day row for resolution.
 *
 * Usage:
 *   npx tsx gabagool-lab/tools/dow-slice.ts --runs 728,725[,708,703]
 */
import { loadMarketRows, computeMarketEcon, mean, closeDb } from './lib.ts'

const argv = process.argv.slice(2)
const i = argv.indexOf('--runs')
const runsArg = i >= 0 ? argv[i + 1] : undefined
if (!runsArg) {
  console.error('usage: dow-slice.ts --runs <id[,id...]>')
  process.exit(1)
}
const runIds = runsArg.split(',').map((s) => Number(s.trim()))

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function fmt(els: number[]): string {
  if (!els.length) return 'n=0'
  const n = els.length
  const mu = mean(els)
  const sd = Math.sqrt(mean(els.map((x) => (x - mu) ** 2)) * (n / Math.max(1, n - 1)))
  const se = sd / Math.sqrt(n)
  return `n=${String(n).padStart(4)}  EL ${mu.toFixed(4).padStart(8)} ±${se.toFixed(4)}  t ${(mu / Math.max(se, 1e-12)).toFixed(1).padStart(6)}`
}

for (const runId of runIds) {
  const rows = await loadMarketRows(runId)
  const econ = rows.map(computeMarketEcon)
  const byDay = new Map<number, number[]>()
  for (let k = 0; k < rows.length; k++) {
    const d = new Date(rows[k]!.marketStartMs).getUTCDay()
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d)!.push(econ[k]!.el)
  }
  const weekday = [1, 2, 3, 4, 5].flatMap((d) => byDay.get(d) ?? [])
  const weekend = [0, 6].flatMap((d) => byDay.get(d) ?? [])
  console.log(`\n== run ${runId} — dow slice (UTC market_start day) ==`)
  console.log(`weekday  ${fmt(weekday)}`)
  console.log(`weekend  ${fmt(weekend)}`)
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    console.log(`  ${DAYS[d]}    ${fmt(byDay.get(d) ?? [])}`)
  }
}
await closeDb()
