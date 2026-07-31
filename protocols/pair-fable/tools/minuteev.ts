/**
 * minuteev.ts — E-027 (pair-v13 axis 5) per-start-minute EV scan. Read-only.
 *
 * Pre-registered in memory/experiments/pair-v13.md (design-ts 743d0be,
 * BEFORE this tool existed). Reads existing runs' per-market rows +
 * intent_meta and reports EV keyed by start minute:
 *
 *   View 1 (rules the verdict): markets with EXACTLY ONE 'S' fill —
 *     bucket = that start's minute-of-window. n, ev/mkt, SE, doom frac.
 *   View 2: all played markets with ≥1 'S' fill — bucket = FIRST-start
 *     minute (approximate attribution for multi-start markets).
 *   Cumulative: markets with first start in minute ≥ m ("forbid starts
 *     before m" policy proxy).
 *   Split halves: universe sorted by market_start_ms, first half vs
 *     second half (E-022 methodology) — View 1 buckets per half.
 *   Region search: all contiguous minute regions [a..b] in View 1 with
 *     pooled mean ≥ 2·SE (the frozen positive bar) are listed; absence
 *     of any such region on the full sample = KILL condition met.
 *
 * Usage: tsx protocols/pair-fable/tools/minuteev.ts --run 872,873
 */
import '../../../src/config/env.js'
import { openDb, toNum, fetchRunsByIds, type RunIdentity } from './lib/runQueries.js'
import type mysql from 'mysql2/promise'

function fail(msg: string): never {
  console.error(`[minuteev] ERROR: ${msg}`)
  process.exit(2)
}

function parseArgs(argv: string[]): { runIds: number[] } {
  const o = { runIds: [] as number[] }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    if (flag === '--run') {
      const v = argv[++i]
      if (!v) fail('--run requires a value')
      o.runIds = v.split(',').map((s) => {
        const n = Number(s.trim())
        if (!Number.isInteger(n) || n <= 0) fail(`--run expects positive ids, got '${s}'`)
        return n
      })
    } else fail(`unknown flag '${flag}'`)
  }
  if (o.runIds.length === 0) fail('--run is required')
  return o
}

type MetaEntry = { side?: string; s?: number; ts?: number; m?: string; p?: number }

type Row = {
  slug: string
  marketStartMs: number
  pnl: number
  cost: number
  upShares: number
  downShares: number
  meta: MetaEntry[]
}

async function fetchRows(conn: mysql.Connection, runId: number): Promise<Row[]> {
  const [rows] = (await conn.query(
    `SELECT slug, market_start_ms, pnl, cost, up_shares, down_shares, intent_meta
       FROM backtest_run_markets WHERE run_id = ? ORDER BY market_start_ms`,
    [runId],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map((r) => ({
    slug: String(r.slug),
    marketStartMs: Number(r.market_start_ms),
    pnl: toNum(r.pnl) ?? 0,
    cost: toNum(r.cost) ?? 0,
    upShares: toNum(r.up_shares) ?? 0,
    downShares: toNum(r.down_shares) ?? 0,
    meta: (typeof r.intent_meta === 'string'
      ? JSON.parse(r.intent_meta)
      : (r.intent_meta ?? [])) as MetaEntry[],
  }))
}

type Keyed = { minute: number; pnl: number; cost: number; doomed: boolean }

function startMinutes(r: Row): number[] {
  const out: number[] = []
  for (const m of r.meta) {
    if (m.m === 'S' && m.ts !== undefined) {
      const minute = Math.floor((m.ts - r.marketStartMs) / 60_000)
      out.push(minute >= 0 && minute <= 14 ? minute : 15)
    }
  }
  return out
}

function bucketStats(items: Keyed[], minutes: number[]): {
  n: number
  mean: number
  se: number
  doomFrac: number
  investedMean: number
} {
  const sel = items.filter((k) => minutes.includes(k.minute))
  const n = sel.length
  if (n === 0) return { n: 0, mean: NaN, se: NaN, doomFrac: NaN, investedMean: NaN }
  const mean = sel.reduce((a, k) => a + k.pnl, 0) / n
  const varSum = sel.reduce((a, k) => a + (k.pnl - mean) ** 2, 0)
  const se = n > 1 ? Math.sqrt(varSum / (n - 1) / n) : NaN
  return {
    n,
    mean,
    se,
    doomFrac: sel.filter((k) => k.doomed).length / n,
    investedMean: sel.reduce((a, k) => a + k.cost, 0) / n,
  }
}

function fmt(x: number, d = 3): string {
  return Number.isFinite(x) ? x.toFixed(d) : '-'
}

function printView(title: string, items: Keyed[]): void {
  console.log(`\n  ${title}`)
  console.log('  min |    n |  ev/mkt |     SE | doom% | invested')
  for (let m = 0; m <= 12; m++) {
    const s = bucketStats(items, [m])
    if (s.n === 0) continue
    console.log(
      `   ${String(m).padStart(2)} | ${String(s.n).padStart(4)} | ${fmt(s.mean).padStart(7)} | ${fmt(s.se).padStart(6)} | ${fmt(100 * s.doomFrac, 1).padStart(5)} | ${fmt(s.investedMean, 2).padStart(8)}`,
    )
  }
}

function positiveRegions(items: Keyed[]): string[] {
  const found: string[] = []
  for (let a = 0; a <= 14; a++) {
    for (let b = a; b <= 14; b++) {
      const minutes = Array.from({ length: b - a + 1 }, (_, i) => a + i)
      const s = bucketStats(items, minutes)
      if (s.n >= 5 && Number.isFinite(s.se) && s.mean >= 2 * s.se && s.mean >= 0) {
        found.push(`[${a}..${b}] n=${s.n} ev=${fmt(s.mean)} SE=${fmt(s.se)}`)
      }
    }
  }
  return found
}

function analyzeRun(identity: RunIdentity, rows: Row[]): void {
  console.log(
    `\n=== run ${identity.runId} — ${identity.strategy} gate=${String((identity.params as { maxPairCost?: unknown }).maxPairCost)} (${rows.length} markets) ===`,
  )
  const played = rows.filter((r) => r.cost > 0 || r.meta.length > 0)
  const view1: Keyed[] = []
  const view2: Keyed[] = []
  let noTs = 0
  for (const r of played) {
    const mins = startMinutes(r)
    const nS = r.meta.filter((m) => m.m === 'S').length
    if (nS > 0 && mins.length < nS) noTs++
    if (mins.length === 0) continue
    const doomed = Math.abs(r.upShares - r.downShares) > 0
    const item = { pnl: r.pnl, cost: r.cost, doomed }
    if (nS === 1) view1.push({ ...item, minute: mins[0]! })
    view2.push({ ...item, minute: Math.min(...mins) })
  }
  console.log(
    `  played=${played.length}  view1(single-S)=${view1.length}  view2(first-S)=${view2.length}  S-fills-missing-ts markets=${noTs}`,
  )
  printView('View 1 — single-S markets, by start minute (RULES VERDICT)', view1)
  printView('View 2 — all S-markets, by first-start minute', view2)

  console.log('\n  Cumulative — first start in minute ≥ m ("forbid starts before m")')
  console.log('    m |    n |  ev/mkt |     SE')
  for (let m = 0; m <= 12; m++) {
    const minutes = Array.from({ length: 15 - m + 1 }, (_, i) => m + i)
    const s = bucketStats(view2, minutes)
    if (s.n === 0) continue
    console.log(
      `   ${String(m).padStart(2)} | ${String(s.n).padStart(4)} | ${fmt(s.mean).padStart(7)} | ${fmt(s.se).padStart(6)}`,
    )
  }

  // Split halves on the universe order (rows are ORDER BY market_start_ms).
  const half = Math.floor(rows.length / 2)
  const slugToHalf = new Map<string, 0 | 1>()
  rows.forEach((r, i) => slugToHalf.set(r.slug, i < half ? 0 : 1))
  const v1H: [Keyed[], Keyed[]] = [[], []]
  for (const r of played) {
    const mins = startMinutes(r)
    const nS = r.meta.filter((m) => m.m === 'S').length
    if (nS !== 1 || mins.length === 0) continue
    v1H[slugToHalf.get(r.slug)!]!.push({
      pnl: r.pnl,
      cost: r.cost,
      doomed: Math.abs(r.upShares - r.downShares) > 0,
      minute: mins[0]!,
    })
  }

  const full = positiveRegions(view1)
  console.log('\n  Positive regions (View 1, contiguous, mean ≥ 2·SE, n ≥ 5):')
  if (full.length === 0) console.log('    NONE — KILL condition met on the full sample')
  else {
    for (const f of full) console.log(`    full: ${f}`)
    console.log(`    half A: ${positiveRegions(v1H[0]).join(' ; ') || 'NONE'}`)
    console.log(`    half B: ${positiveRegions(v1H[1]).join(' ; ') || 'NONE'}`)
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const conn = await openDb()
  try {
    const runs = await fetchRunsByIds(conn, opts.runIds)
    if (runs.length !== opts.runIds.length) {
      const found = new Set(runs.map((r) => r.runId))
      fail(`runs not found: ${opts.runIds.filter((id) => !found.has(id)).join(', ')}`)
    }
    for (const run of runs) analyzeRun(run, await fetchRows(conn, run.runId))
  } finally {
    await conn.end()
  }
}

await main()
