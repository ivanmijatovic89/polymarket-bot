/**
 * measure-fill-gap.ts — D2: the passive-fill reality gap.
 *
 * For a wallet's ACTUAL maker fills (data-api /activity, BUY side), replay
 * the Telonex delta-typed book for the same market and ask: would the
 * backtest engine's maker fill rules have granted this fill?
 *   worst_queue: ∃ t' in [t−W, t+W] with bestAsk(t') <  fillPrice
 *   touch:       ∃ t' in [t−W, t+W] with bestAsk(t') <= fillPrice
 * Also measures where the fill sat relative to the prevailing book
 * (fillPrice − bestBid at/before fill: 0 = at the touch, <0 = deeper).
 *
 * Usage:
 *   npx tsx research/gabagool/scripts/measure-fill-gap.ts \
 *     --activity research/gabagool/data/activity-gabagool22.jsonl \
 *     --dir data/events/telonex/delta-typed/btc/15m \
 *     --prefix btc-updown-15m --limit 40 [--from <iso>] [--to <iso>]
 *
 * Read-only outside research/gabagool/. Windows: 1s / 3s / 10s reported.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const activityPath = argOf('activity')!
const dir = argOf('dir') ?? 'data/events/telonex/delta-typed/btc/15m'
const prefix = argOf('prefix') ?? 'btc-updown-15m'
const limit = Number(argOf('limit') ?? 40)
const fromSec = argOf('from') ? Date.parse(argOf('from')!) / 1000 : 0
const toSec = argOf('to') ? Date.parse(argOf('to')!) / 1000 : Infinity

type Fill = { tsMs: number; price: number; size: number; assetId: string }
const fillsBySlug = new Map<string, Fill[]>()

for (const line of readFileSync(activityPath, 'utf8').split('\n')) {
  if (!line) continue
  const r = JSON.parse(line)
  if (r.type !== 'TRADE' || r.side !== 'BUY') continue
  const slug: string = r.slug ?? ''
  if (!slug.startsWith(prefix)) continue
  if (r.timestamp < fromSec || r.timestamp > toSec) continue
  if (!r.asset || !r.price || !r.size) continue
  let arr = fillsBySlug.get(slug)
  if (!arr) fillsBySlug.set(slug, (arr = []))
  arr.push({ tsMs: r.timestamp * 1000, price: r.price, size: r.size, assetId: String(r.asset) })
}

// prefer markets with many fills but keep a spread: sort by slug (time) and
// take every k-th so the sample spans the window rather than one burst hour
const slugsAll = [...fillsBySlug.keys()].filter((s) => existsSync(join(dir, `${s}.parquet`)))
slugsAll.sort()
const step = Math.max(1, Math.floor(slugsAll.length / limit))
const slugs = slugsAll.filter((_, i) => i % step === 0).slice(0, limit)
console.log(
  `markets with fills: ${fillsBySlug.size}; with local parquet: ${slugsAll.length}; sampled: ${slugs.length}`,
)

const WINDOWS_MS = [1000, 3000, 10000]

type FillResult = {
  price: number
  size: number
  // per window: min bestAsk seen in [t-W, t+W]
  minAsk: number[]
  // book state at/just before fill time
  bidAtFill: number | null
  askAtFill: number | null
}

const results: FillResult[] = []
let marketsDone = 0
let fillsUnmatched = 0

for (const slug of slugs) {
  const fills = fillsBySlug.get(slug)!.sort((a, b) => a.tsMs - b.tsMs)
  // per-asset best bid/ask change series
  const series = new Map<string, Array<{ ts: number; bid: number | null; ask: number | null }>>()
  const last = new Map<string, { bid: number | null; ask: number | null }>()

  await replayTelonexDeltaParquetForMarket({
    filePath: join(dir, `${slug}.parquet`),
    onSnapshot: (snapshot) => {
      for (const [assetId, book] of Object.entries(snapshot.byAssetId)) {
        const prev = last.get(assetId)
        const bid = book.bestBid
        const ask = book.bestAsk
        if (!prev || prev.bid !== bid || prev.ask !== ask) {
          last.set(assetId, { bid, ask })
          let arr = series.get(assetId)
          if (!arr) series.set(assetId, (arr = []))
          arr.push({ ts: snapshot.timestamp, bid, ask })
        }
      }
    },
  })

  for (const f of fills) {
    const s = series.get(f.assetId)
    if (!s || s.length === 0) {
      fillsUnmatched++
      continue
    }
    // state at/just before fill
    let lo = 0
    let hi = s.length - 1
    let at = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (s[mid].ts <= f.tsMs) {
        at = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    const stateAt = at >= 0 ? s[at] : null
    const minAsk: number[] = []
    for (const W of WINDOWS_MS) {
      let m = Infinity
      // scan backward from `at` while ts >= t-W (include state entering the window)
      for (let i = at; i >= 0 && s[i].ts >= f.tsMs - W; i--) {
        if (s[i].ask !== null) m = Math.min(m, s[i].ask!)
      }
      // the level in force entering the window
      // (the change strictly before t-W is still the standing ask at t-W)
      let entering = -1
      for (let i = at; i >= 0; i--) {
        if (s[i].ts < f.tsMs - W) {
          entering = i
          break
        }
      }
      if (entering >= 0 && s[entering].ask !== null) m = Math.min(m, s[entering].ask!)
      // forward
      for (let i = at + 1; i < s.length && s[i].ts <= f.tsMs + W; i++) {
        if (s[i].ask !== null) m = Math.min(m, s[i].ask!)
      }
      minAsk.push(m)
    }
    results.push({
      price: f.price,
      size: f.size,
      minAsk,
      bidAtFill: stateAt?.bid ?? null,
      askAtFill: stateAt?.ask ?? null,
    })
  }
  marketsDone++
  if (marketsDone % 10 === 0) console.log(`  ...${marketsDone}/${slugs.length} markets`)
}

const n = results.length
console.log(`\nfills evaluated: ${n} (unmatched asset/series: ${fillsUnmatched})`)

const EPS = 1e-9
for (let w = 0; w < WINDOWS_MS.length; w++) {
  let worst = 0
  let touch = 0
  let worstSz = 0
  let touchSz = 0
  let totSz = 0
  for (const r of results) {
    totSz += r.size
    if (r.minAsk[w] < r.price - EPS) {
      worst++
      worstSz += r.size
    }
    if (r.minAsk[w] <= r.price + EPS) {
      touch++
      touchSz += r.size
    }
  }
  console.log(
    `W=${WINDOWS_MS[w] / 1000}s: worst_queue admits ${((100 * worst) / n).toFixed(1)}% of fills (${((100 * worstSz) / totSz).toFixed(1)}% by size); touch_or_better ${((100 * touch) / n).toFixed(1)}% (${((100 * touchSz) / totSz).toFixed(1)}% by size)`,
  )
}

// placement relative to prevailing book
let atTouch = 0
let insideSpread = 0
let deeper = 0
let above = 0
let noBook = 0
const offsets: number[] = []
for (const r of results) {
  if (r.bidAtFill === null) {
    noBook++
    continue
  }
  const d = r.price - r.bidAtFill
  offsets.push(d)
  if (Math.abs(d) < 0.0005) atTouch++
  else if (d < 0) deeper++
  else if (r.askAtFill !== null && r.price < r.askAtFill - 0.0005) insideSpread++
  else above++
}
offsets.sort((a, b) => a - b)
const q = (p: number) => offsets[Math.min(offsets.length - 1, Math.floor(p * offsets.length))]
console.log(
  `\nplacement vs prevailing bestBid (fillPrice − bestBid): at-touch ${((100 * atTouch) / n).toFixed(1)}%, deeper(<bid) ${((100 * deeper) / n).toFixed(1)}%, inside-spread(>bid,<ask) ${((100 * insideSpread) / n).toFixed(1)}%, at/above-ask ${((100 * above) / n).toFixed(1)}%, no-book ${((100 * noBook) / n).toFixed(1)}%`,
)
if (offsets.length)
  console.log(
    `offset quantiles: p10=${q(0.1).toFixed(3)} p25=${q(0.25).toFixed(3)} p50=${q(0.5).toFixed(3)} p75=${q(0.75).toFixed(3)} p90=${q(0.9).toFixed(3)}`,
  )
