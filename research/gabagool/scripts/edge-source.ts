/**
 * edge-source.ts — what does an edge wallet's btc-15m flow look like
 * against the book? Per BUY fill: level class (taker / at-touch / inside /
 * deeper), offset vs touch, minute-of-window, and post-fill mid drift
 * (+10s/+60s) — the adverse-selection read. Compare wallets side by side.
 *
 * Usage: npx tsx research/gabagool/scripts/edge-source.ts \
 *   --activity <jsonl> --dir research/gabagool/data/telonex-r2 \
 *   [--prefix btc-updown-15m] [--from <iso>] [--to <iso>]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const activityPath = argOf('activity')!
const dir = argOf('dir') ?? 'research/gabagool/data/telonex-r2'
const prefix = argOf('prefix') ?? 'btc-updown-15m'
const fromSec = argOf('from') ? Date.parse(argOf('from')!) / 1000 : 0
const toSec = argOf('to') ? Date.parse(argOf('to')!) / 1000 : Infinity

type Fill = { tsMs: number; price: number; size: number; assetId: string }
const fillsBySlug = new Map<string, Fill[]>()
for (const line of readFileSync(activityPath, 'utf8').split('\n')) {
  if (!line) continue
  const r = JSON.parse(line)
  if (r.type !== 'TRADE' || r.side !== 'BUY') continue
  if (!r.slug?.startsWith(prefix)) continue
  if (r.timestamp < fromSec || r.timestamp > toSec) continue
  if (!r.asset || !r.price || !r.size) continue
  let arr = fillsBySlug.get(r.slug)
  if (!arr) fillsBySlug.set(r.slug, (arr = []))
  arr.push({ tsMs: r.timestamp * 1000, price: r.price, size: r.size, assetId: String(r.asset) })
}

const slugs = readdirSync(dir)
  .filter((f) => f.startsWith(prefix) && f.endsWith('.parquet'))
  .map((f) => f.replace('.parquet', ''))
  .filter((s) => fillsBySlug.has(s))
  .sort()
console.log(`markets joined: ${slugs.length}`)

type Cls = 'taker' | 'touch' | 'inside' | 'deeper'
type ClsAcc = { n: number; usd: number; drift10: number[]; drift60: number[]; prices: number[]; fee: number }
const mk = (): ClsAcc => ({ n: 0, usd: 0, drift10: [], drift60: [], prices: [], fee: 0 })
const cls: Record<Cls, ClsAcc> = { taker: mk(), touch: mk(), inside: mk(), deeper: mk() }
// depth buckets for deeper-class fills (offset = price − bestBid, cents)
const depthBuckets: Array<{ name: string; min: number; max: number; n: number; usd: number; drift10: number[]; drift60: number[] }> = [
  { name: '-1c', min: -0.015, max: -0.005, n: 0, usd: 0, drift10: [], drift60: [] },
  { name: '-2c', min: -0.025, max: -0.015, n: 0, usd: 0, drift10: [], drift60: [] },
  { name: '-3..-5c', min: -0.055, max: -0.025, n: 0, usd: 0, drift10: [], drift60: [] },
  { name: '<=-6c', min: -Infinity, max: -0.055, n: 0, usd: 0, drift10: [], drift60: [] },
]
const offsets: number[] = []
const byMinute = Array.from({ length: 15 }, () => ({ n: 0, usd: 0 }))
let unmatched = 0

for (const slug of slugs) {
  const epochMs = Number(slug.split('-').pop()) * 1000
  const fills = fillsBySlug.get(slug)!.sort((a, b) => a.tsMs - b.tsMs)
  const series = new Map<string, Array<{ ts: number; bid: number | null; ask: number | null }>>()
  const last = new Map<string, { bid: number | null; ask: number | null }>()
  await replayTelonexDeltaParquetForMarket({
    filePath: join(dir, `${slug}.parquet`),
    onSnapshot: (snapshot) => {
      for (const [assetId, book] of Object.entries(snapshot.byAssetId)) {
        const prev = last.get(assetId)
        const bid = (book as { bestBid: number | null }).bestBid
        const ask = (book as { bestAsk: number | null }).bestAsk
        if (!prev || prev.bid !== bid || prev.ask !== ask) {
          last.set(assetId, { bid, ask })
          let arr = series.get(assetId)
          if (!arr) series.set(assetId, (arr = []))
          arr.push({ ts: snapshot.timestamp, bid, ask })
        }
      }
    },
  })
  const stateAtOrBefore = (s: Array<{ ts: number; bid: number | null; ask: number | null }>, t: number) => {
    let lo = 0,
      hi = s.length - 1,
      at = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (s[mid].ts <= t) {
        at = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return at >= 0 ? s[at] : null
  }
  const midAt = (s: Array<{ ts: number; bid: number | null; ask: number | null }>, t: number) => {
    const st = stateAtOrBefore(s, t)
    return st && st.bid !== null && st.ask !== null ? (st.bid + st.ask) / 2 : null
  }
  for (const f of fills) {
    const s = series.get(f.assetId)
    if (!s || s.length === 0) {
      unmatched++
      continue
    }
    const st = stateAtOrBefore(s, f.tsMs)
    if (!st || st.bid === null || st.ask === null) {
      unmatched++
      continue
    }
    const usd = f.price * f.size
    let c: Cls
    if (f.price >= st.ask) c = 'taker'
    else if (f.price <= st.bid) c = f.price === st.bid ? 'touch' : 'deeper'
    else c = 'inside'
    // deeper: price < bid means the book moved; count anything <= bid-0.001 as deeper
    if (f.price < st.bid) c = 'deeper'
    cls[c].n++
    cls[c].usd += usd
    cls[c].prices.push(f.price)
    cls[c].fee += 0.07 * f.price * (1 - f.price) * f.size
    offsets.push(f.price - st.bid)
    const m0 = midAt(s, f.tsMs)
    const m10 = midAt(s, f.tsMs + 10_000)
    const m60 = midAt(s, f.tsMs + 60_000)
    if (m0 !== null && m10 !== null) cls[c].drift10.push(m10 - m0)
    if (m0 !== null && m60 !== null) cls[c].drift60.push(m60 - m0)
    if (c === 'deeper') {
      const off = f.price - st.bid
      const b = depthBuckets.find((x) => off > x.min - 1e-9 && off <= x.max + 1e-9)
      if (b) {
        b.n++
        b.usd += usd
        if (m0 !== null && m10 !== null) b.drift10.push(m10 - m0)
        if (m0 !== null && m60 !== null) b.drift60.push(m60 - m0)
      }
    }
    const minute = Math.min(14, Math.max(0, Math.floor((f.tsMs - epochMs) / 60_000)))
    byMinute[minute].n++
    byMinute[minute].usd += usd
  }
}

const q = (a: number[], p: number) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const f4 = (x: number) => (Number.isFinite(x) ? x.toFixed(4) : '-')
const totN = Object.values(cls).reduce((a, b) => a + b.n, 0)
const totUsd = Object.values(cls).reduce((a, b) => a + b.usd, 0)
console.log(`fills matched: ${totN} (unmatched ${unmatched}); notional $${totUsd.toFixed(0)}`)
console.log('\nclass | fills% | notional% | drift10 mean | drift60 mean | px p25/p50/p75 | fee%ofNotional')
for (const [k, v] of Object.entries(cls)) {
  const d10 = v.drift10.length ? v.drift10.reduce((a, b) => a + b, 0) / v.drift10.length : NaN
  const d60 = v.drift60.length ? v.drift60.reduce((a, b) => a + b, 0) / v.drift60.length : NaN
  console.log(
    `${k.padEnd(6)} | ${((100 * v.n) / totN).toFixed(1).padStart(5)}% | ${((100 * v.usd) / totUsd).toFixed(1).padStart(5)}% | ${f4(d10)} | ${f4(d60)} | ${f4(q(v.prices, 0.25))}/${f4(q(v.prices, 0.5))}/${f4(q(v.prices, 0.75))} | ${v.usd ? ((100 * v.fee) / v.usd).toFixed(2) : '-'}%`,
  )
}
console.log(`\noffset vs touch (price − bestBid): p10=${f4(q(offsets, 0.1))} p25=${f4(q(offsets, 0.25))} p50=${f4(q(offsets, 0.5))} p75=${f4(q(offsets, 0.75))} p90=${f4(q(offsets, 0.9))}`)
console.log('\ndeeper-class by depth bucket | n | notional | drift10 mean | drift60 mean')
for (const b of depthBuckets) {
  const d10 = b.drift10.length ? b.drift10.reduce((a, x) => a + x, 0) / b.drift10.length : NaN
  const d60 = b.drift60.length ? b.drift60.reduce((a, x) => a + x, 0) / b.drift60.length : NaN
  console.log(`${b.name.padEnd(8)} | ${b.n} | $${b.usd.toFixed(0)} | ${f4(d10)} | ${f4(d60)}`)
}
console.log('\nminute | fills% | notional%')
for (let i = 0; i < 15; i++) {
  console.log(
    `${String(i).padStart(2)} | ${((100 * byMinute[i].n) / totN).toFixed(1).padStart(5)}% | ${((100 * byMinute[i].usd) / totUsd).toFixed(1).padStart(5)}%`,
  )
}
process.exit(0)
