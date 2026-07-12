/**
 * rsc-table.ts — RESCUE-025 sweep table + mechanical winner derivation.
 *
 * Reads the 40 sweep runs (batchUids RSC-025-V01..V40) via results.ts
 * --json and prints one ranked markdown table plus the FROZEN winner
 * rule applied mechanically (RESCUE-025.md):
 *   eligible(v) = completed ∧ failures=0 ∧ played ≥ 100 ∧ q̂ > 0
 *   winner      = eligible variant with highest t, REQUIRING t ≥ +1.5;
 *                 ties (t to 4dp): higher q̂, then lower variant number.
 *   none eligible at t ≥ +1.5 → "DEAD FOR GOOD at sweep stage".
 * Ranking: by t desc (the selection statistic). Read-only; also prints
 * a window-integrity summary column source (maxStartMs) when --windows
 * is passed (queries backtest run segments via results.ts is not
 * possible — windows are checked by the separate integrity query in the
 * session, see RESCUE-025.md integrity requirements).
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

type Report = {
  runId: number
  status: string
  N: number
  played: number
  failures: number
  evPerMarket: number
  quality_q: number
  t_stat: number
  winRatePlayed: number | null
  wonLost: string
  makerTrades: number
  takerTrades: number
}

function fetchReport(batchUid: string): Report | null {
  try {
    const out = execFileSync('npx', ['tsx', join(HERE, 'results.ts'), '--batch', batchUid, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const jsonStart = out.indexOf('{')
    if (jsonStart < 0) return null
    return JSON.parse(out.slice(jsonStart)) as Report
  } catch {
    return null
  }
}

function f(x: number | null | undefined, d = 4): string {
  return x == null || Number.isNaN(x) ? '—' : x.toFixed(d)
}

async function main() {
  const rows: { v: string; r: Report | null }[] = []
  for (let i = 1; i <= 40; i++) {
    const v = `V${String(i).padStart(2, '0')}`
    rows.push({ v, r: fetchReport(`RSC-025-${v}`) })
  }
  const pending = rows.filter((x) => !x.r || x.r.status !== 'completed').map((x) => x.v)
  const done = rows.filter((x) => x.r && x.r.status === 'completed') as { v: string; r: Report }[]
  done.sort((a, b) => b.r.t_stat - a.r.t_stat || a.v.localeCompare(b.v))

  console.log('| rank | variant | run | N | played | fail | q̂ | t | EV/mkt | winRate | eligible |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|')
  done.forEach((x, i) => {
    const el = x.r.failures === 0 && x.r.played >= 100 && x.r.quality_q > 0
    console.log(
      `| ${i + 1} | ${x.v} | ${x.r.runId} | ${x.r.N} | ${x.r.played} | ${x.r.failures} | ${f(x.r.quality_q)} | ${f(x.r.t_stat, 2)} | ${f(x.r.evPerMarket, 3)} | ${f(x.r.winRatePlayed, 3)} (${x.r.wonLost}) | ${el ? 'yes' : 'no'} |`,
    )
  })
  console.log(`\ncompleted: ${done.length}/40  pending: ${pending.join(' ') || 'none'}`)
  if (pending.length > 0) return

  const eligible = done.filter((x) => x.r.failures === 0 && x.r.played >= 100 && x.r.quality_q > 0)
  const candidates = eligible.filter((x) => x.r.t_stat >= 1.5)
  if (candidates.length === 0) {
    console.log('WINNER: none — no eligible variant reaches t ≥ +1.5 → DEAD FOR GOOD at sweep stage (frozen rule)')
    return
  }
  candidates.sort(
    (a, b) =>
      Number(b.r.t_stat.toFixed(4)) - Number(a.r.t_stat.toFixed(4)) ||
      b.r.quality_q - a.r.quality_q ||
      a.v.localeCompare(b.v),
  )
  const w = candidates[0]
  console.log(
    `WINNER: ${w.v} (run ${w.r.runId}) q̂=${f(w.r.quality_q)} t=${f(w.r.t_stat, 2)} played=${w.r.played} — proceed to the frozen confirmation`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
