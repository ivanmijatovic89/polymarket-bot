/**
 * Venue-drift aggregator (DECISIONS D17): parses `[diag-venue]` lines from
 * one or more run logs and prints a per-calendar-month (UTC) table of
 * cross-market medians. Outcome-free: consumes only the diagnostic
 * fixture's book statistics.
 *
 *   npx tsx fable-lab/tools/venue-drift.ts <log-file> [<log-file> ...]
 *
 * Pooled mode (U46, audit finding 3 — makes re-baselining mechanical):
 *   npx tsx fable-lab/tools/venue-drift.ts --pooled 2025-12:2026-04 <log-file> [...]
 * prints ONE row pooled over ALL per-market values in the inclusive month
 * range (median for spread/depth/rate, mean for crossedFrac) — the exact
 * convention behind the published baseline reference values (479.4 etc.,
 * verified to reproduce them on logs/venue-drift-baseline.log).
 */
import { readFileSync } from 'node:fs'

type Row = {
  slug: string
  epochSec: number
  rate: number | null
  crossedFrac: number | null
  spreadMed: number | null
  depthMed: number | null
}

const num = (s: string | undefined): number | null => {
  if (s == null || s === 'n/a') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const argv = process.argv.slice(2)
let pooledRange: [string, string] | null = null
const pooledIdx = argv.indexOf('--pooled')
if (pooledIdx !== -1) {
  const spec = argv[pooledIdx + 1] ?? ''
  const m = spec.match(/^(\d{4}-\d{2}):(\d{4}-\d{2})$/)
  if (!m) {
    console.error('--pooled requires an inclusive month range like 2025-12:2026-04')
    process.exit(1)
  }
  pooledRange = [m[1], m[2]]
  argv.splice(pooledIdx, 2)
}
const files = argv
if (!files.length) {
  console.error('usage: venue-drift.ts [--pooled YYYY-MM:YYYY-MM] <log-file> [...]')
  process.exit(1)
}

const rows: Row[] = []
const seen = new Set<string>()
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const i = line.indexOf('[diag-venue] ')
    if (i === -1) continue
    const kv = new Map<string, string>()
    for (const part of line.slice(i + '[diag-venue] '.length).trim().split(/\s+/)) {
      const eq = part.indexOf('=')
      if (eq > 0) kv.set(part.slice(0, eq), part.slice(eq + 1))
    }
    const slug = kv.get('slug')
    const epochSec = num(kv.get('epoch'))
    if (!slug || !epochSec || seen.has(slug)) continue
    seen.add(slug)
    rows.push({
      slug,
      epochSec,
      rate: num(kv.get('rate')),
      crossedFrac: num(kv.get('crossedFrac')),
      spreadMed: num(kv.get('spreadMed')),
      depthMed: num(kv.get('depthMed')),
    })
  }
}

const byMonth = new Map<string, Row[]>()
for (const r of rows) {
  const d = new Date(r.epochSec * 1000)
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const arr = byMonth.get(key) ?? []
  arr.push(r)
  byMonth.set(key, arr)
}

const fmt = (v: number | null, digits: number): string => (v == null ? 'n/a' : v.toFixed(digits))
console.log(`parsed ${rows.length} unique markets from ${files.length} file(s)`)

if (pooledRange) {
  const [from, to] = pooledRange
  const pool = rows.filter((r) => {
    const d = new Date(r.epochSec * 1000)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    return key >= from && key <= to
  })
  const pick = (sel: (r: Row) => number | null): number[] =>
    pool.map(sel).filter((v): v is number => v != null)
  const crossed = pick((r) => r.crossedFrac)
  const crossedMean = crossed.length ? crossed.reduce((a, b) => a + b, 0) / crossed.length : null
  console.log(`pooled ${from}..${to}: markets=${pool.length}`)
  console.log(
    `pooled  ${String(pool.length).padStart(7)}  ${fmt(median(pick((r) => r.spreadMed)), 4).padStart(9)}  ` +
      `${fmt(median(pick((r) => r.depthMed)), 1).padStart(8)}  ${fmt(median(pick((r) => r.rate)), 2).padStart(7)}  ` +
      `${fmt(crossedMean, 4)}`,
  )
  process.exit(0)
}

console.log('month    markets  spreadMed  depthMed  rateMed  crossedFracMean')
for (const key of [...byMonth.keys()].sort()) {
  const ms = byMonth.get(key)!
  const pick = (sel: (r: Row) => number | null): number[] =>
    ms.map(sel).filter((v): v is number => v != null)
  const crossed = pick((r) => r.crossedFrac)
  const crossedMean = crossed.length ? crossed.reduce((a, b) => a + b, 0) / crossed.length : null
  console.log(
    `${key}  ${String(ms.length).padStart(7)}  ${fmt(median(pick((r) => r.spreadMed)), 4).padStart(9)}  ` +
      `${fmt(median(pick((r) => r.depthMed)), 1).padStart(8)}  ${fmt(median(pick((r) => r.rate)), 2).padStart(7)}  ` +
      `${fmt(crossedMean, 4)}`,
  )
}
