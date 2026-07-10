/**
 * Venue-drift aggregator (DECISIONS D17): parses `[diag-venue]` lines from
 * one or more run logs and prints a per-calendar-month (UTC) table of
 * cross-market medians. Outcome-free: consumes only the diagnostic
 * fixture's book statistics.
 *
 *   npx tsx fable-lab/tools/venue-drift.ts <log-file> [<log-file> ...]
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

const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: venue-drift.ts <log-file> [...]')
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
