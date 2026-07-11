/**
 * b5-table.ts — BATCH-005 ranked verdict table (FINAL RUN directive).
 *
 * Reads all 40 runs (SCR-010..SCR-029 × samples A/B) via the same DB
 * aggregation as results.ts (spawns it with --json per batchUid) and
 * prints ONE ranked markdown table plus per-screen verdict lines against
 * the frozen BATCH-005 bars:
 *   survive(sample) = q̂ > 0 ∧ t ≥ +1.5 ∧ prediction held (q̂ sign) ∧
 *                     (skewed cells: minority-outcome count ≥ 30)
 *   SURVIVE overall = both samples survive; PARK-DESIGN = both samples
 *   structurally entry-less (played = 0); KILL otherwise (default).
 * Ranking: by the WORSE sample's q̂ (conservative), tiebreak pooled q̂.
 * Read-only.
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const SCREENS: { id: string; label: string; skewed: boolean }[] = [
  { id: 'SCR-010', label: 'momentum + maker TP', skewed: false },
  { id: 'SCR-011', label: 'momentum + taker SL', skewed: false },
  { id: 'SCR-012', label: 'fade + maker TP', skewed: false },
  { id: 'SCR-013', label: 'tight-spread × momentum', skewed: false },
  { id: 'SCR-014', label: 'depth-agree × momentum', skewed: false },
  { id: 'SCR-015', label: 'US-hours × momentum', skewed: false },
  { id: 'SCR-016', label: 'busy-tape × momentum', skewed: false },
  { id: 'SCR-017', label: 'dwell-breakout', skewed: false },
  { id: 'SCR-018', label: 'late big-move continuation', skewed: false },
  { id: 'SCR-019', label: 'late favorite-collapse fade', skewed: false },
  { id: 'SCR-020', label: 'extreme favorite + maker TP', skewed: true },
  { id: 'SCR-021', label: 'mid favorite + maker TP', skewed: false },
  { id: 'SCR-022', label: 'underdog + taker SL', skewed: false },
  { id: 'SCR-023', label: 'quiet-early favorite', skewed: true },
  { id: 'SCR-024', label: 'E21 continuation mirror', skewed: false },
  { id: 'SCR-025', label: 'E22 reversal mirror', skewed: false },
  { id: 'SCR-026', label: 'maker bid + maker TP', skewed: false },
  { id: 'SCR-027', label: 'maker bid + taker SL', skewed: false },
  { id: 'SCR-028', label: 'fill-as-signal inversion', skewed: false },
  { id: 'SCR-029', label: 'second-passage barrier', skewed: false },
]

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

function minorityCount(wonLost: string): number | null {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(wonLost ?? '')
  if (!m) return null
  return Math.min(Number(m[1]), Number(m[2]))
}

function sampleVerdict(r: Report, skewed: boolean): { survives: boolean; why: string } {
  if (r.played === 0) return { survives: false, why: 'entry-less' }
  const q = r.quality_q
  const t = r.t_stat
  if (!(q > 0)) return { survives: false, why: 'q≤0' }
  if (!(t >= 1.5)) return { survives: false, why: 't<1.5' }
  if (skewed) {
    const mc = minorityCount(r.wonLost)
    if (mc == null || mc < 30) return { survives: false, why: `minority<30 (${mc ?? '?'})` }
  }
  return { survives: true, why: 'clears bar' }
}

function f(x: number | null | undefined, d = 4): string {
  return x == null || Number.isNaN(x) ? '—' : x.toFixed(d)
}

async function main() {
  const rows: {
    id: string
    label: string
    a: Report | null
    b: Report | null
    verdict: string
    detail: string
    rankKey: number
  }[] = []
  for (const s of SCREENS) {
    const a = fetchReport(`${s.id}-A`)
    const b = fetchReport(`${s.id}-B`)
    let verdict = 'PENDING'
    let detail = ''
    let rankKey = -Infinity
    if (a && b && a.status === 'completed' && b.status === 'completed') {
      const va = sampleVerdict(a, s.skewed)
      const vb = sampleVerdict(b, s.skewed)
      if (va.survives && vb.survives) verdict = 'SURVIVE'
      else if (a.played === 0 && b.played === 0) verdict = 'PARK-DESIGN'
      else verdict = 'KILL'
      detail = `A:${va.why} B:${vb.why}`
      rankKey = Math.min(a.quality_q, b.quality_q)
    }
    rows.push({ id: s.id, label: s.label, a, b, verdict, detail, rankKey })
  }
  rows.sort((x, y) => y.rankKey - x.rankKey || x.id.localeCompare(y.id))

  console.log('| rank | screen | mechanism | sample | run | N | played | q̂ | t | EV/mkt | winRate | verdict |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|')
  rows.forEach((r, i) => {
    for (const [tag, rep] of [['A', r.a], ['B', r.b]] as const) {
      if (!rep) {
        console.log(`| ${i + 1} | ${r.id} | ${r.label} | ${tag} | — | — | — | — | — | — | — | ${r.verdict} |`)
        continue
      }
      console.log(
        `| ${i + 1} | ${r.id} | ${r.label} | ${tag} | ${rep.runId} | ${rep.N} | ${rep.played} | ${f(rep.quality_q)} | ${f(rep.t_stat, 2)} | ${f(rep.evPerMarket, 3)} | ${f(rep.winRatePlayed, 3)} (${rep.wonLost}) | ${tag === 'A' ? r.verdict : r.detail} |`,
      )
    }
  })
  const pending = rows.filter((r) => r.verdict === 'PENDING').map((r) => r.id)
  console.log(`\ncompleted: ${rows.length - pending.length}/20  pending: ${pending.join(' ') || 'none'}`)
  const survivors = rows.filter((r) => r.verdict === 'SURVIVE').map((r) => r.id)
  console.log(`SURVIVORS (both samples clear the frozen bar): ${survivors.join(' ') || 'NONE'}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
