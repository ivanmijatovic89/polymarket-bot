/**
 * window-lifecycle.ts — D3 + D5 over Telonex btc-15m books.
 *
 * One replay pass per market, two outputs:
 *  D5: per-minute lifecycle of the UP book — spread, L1 depth, top-of-book
 *      update rate, mid movement, |mid−0.5| (how decided the window is).
 *  D3: endgame reversal table — P(leading side at time t loses at
 *      resolution) by (leading-prob band × seconds-left bucket).
 *      Outcome = final observed UP mid (>0.9 UP, <0.1 DOWN, else
 *      ambiguous → excluded, counted).
 *
 * Descriptive priors only (samples within a market are correlated; no
 * significance claims). Usage:
 *   npx tsx research/gabagool/scripts/window-lifecycle.ts \
 *     --dir data/events/telonex/delta-typed/btc/15m \
 *     --from 2026-06-01T00:00:00Z --to 2026-06-14T09:30:00Z --sample 288
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const dir = argOf('dir') ?? 'data/events/telonex/delta-typed/btc/15m'
const prefix = argOf('prefix') ?? 'btc-updown-15m'
const fromSec = argOf('from') ? Date.parse(argOf('from')!) / 1000 : 0
const toSec = argOf('to') ? Date.parse(argOf('to')!) / 1000 : Infinity
const sampleN = Math.min(300, Number(argOf('sample') ?? 288))

const all = readdirSync(dir)
  .filter((f) => f.startsWith(prefix) && f.endsWith('.parquet'))
  .map((f) => f.replace('.parquet', ''))
  .filter((s) => {
    const ep = Number(s.split('-').pop())
    return ep >= fromSec && ep < toSec
  })
  .sort()
const step = Math.max(1, all.length / sampleN)
const slugs: string[] = []
for (let i = 0; i < all.length && slugs.length < sampleN; i += step) slugs.push(all[Math.floor(i)])
console.log(`eligible ${all.length}, sampled ${slugs.length}`)

type Pt = { ts: number; bid: number | null; ask: number | null; bidSz: number; askSz: number }

// D5 accumulators, per minute 0..14
const perMin = Array.from({ length: 15 }, () => ({
  spread: [] as number[],
  bidSz: [] as number[],
  askSz: [] as number[],
  updates: [] as number[],
  midTravel: [] as number[], // sum of |Δmid| within the minute
  dist05: [] as number[],
}))

// D3: leading-prob bands × seconds-left buckets
const bandEdges = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0001]
const bandLabel = ['0.50-0.60', '0.60-0.70', '0.70-0.80', '0.80-0.90', '0.90-0.95', '0.95-1.00']
const tlEdges = [0, 30, 60, 120, 300, 600, 900] // seconds left
const tlLabel = ['0-30s', '30-60s', '60-120s', '120-300s', '300-600s', '600-900s']
const flip = Array.from({ length: bandLabel.length }, () =>
  Array.from({ length: tlLabel.length }, () => ({ n: 0, flips: 0 })),
)

let ambiguous = 0
let replayed = 0
let upWins = 0

for (const slug of slugs) {
  const epochMs = Number(slug.split('-').pop()) * 1000
  const endMs = epochMs + 15 * 60_000
  // Track asset0 (first-seen; NOT necessarily UP — all stats below are
  // side-symmetric: spread/depth mirror across legs, flips use leading side).
  let upAsset: string | null = null
  const series: Pt[] = []
  let lastKey = ''
  try {
    await replayTelonexDeltaParquetForMarket({
      filePath: join(dir, `${slug}.parquet`),
      onSnapshot: (snapshot) => {
        const ids = Object.keys(snapshot.byAssetId)
        if (!upAsset && ids.length > 0) upAsset = ids[0]
        if (!upAsset) return
        const book = snapshot.byAssetId[upAsset]
        if (!book) return
        const bid = book.bestBid
        const ask = book.bestAsk
        const bidSz = book.bids.length > 0 ? book.bids[0].size : 0
        const askSz = book.asks.length > 0 ? book.asks[0].size : 0
        const key = `${bid}|${ask}|${bidSz}|${askSz}`
        if (key !== lastKey) {
          lastKey = key
          series.push({ ts: snapshot.timestamp, bid, ask, bidSz, askSz })
        }
      },
    })
  } catch (e) {
    console.error(`replay failed ${slug}: ${(e as Error).message}`)
    continue
  }
  if (series.length < 10) continue
  replayed++

  const stateAtOrBefore = (t: number): Pt | null => {
    let lo = 0,
      hi = series.length - 1,
      at = -1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (series[m].ts <= t) {
        at = m
        lo = m + 1
      } else hi = m - 1
    }
    return at >= 0 ? series[at] : null
  }
  const midOf = (p: Pt | null) => (p && p.bid !== null && p.ask !== null ? (p.bid + p.ask) / 2 : null)

  // Outcome from post-window book state: after the window ends the winning
  // side pins (bid ~0.99, asks empty) and the losing side collapses (asks
  // ~0.01) before the final wipe. Scan the last 60s of observed points.
  // Walk backwards; the LATEST decisive observation wins (a last-second
  // flip can put both signals inside the same final minute).
  let outcomeUp: boolean | null = null
  for (let i = series.length - 1; i >= 0; i--) {
    const p = series[i]
    if (p.ts < endMs - 30_000) break
    if (p.bid !== null && p.bid >= 0.9) {
      outcomeUp = true
      break
    }
    if (p.ask !== null && p.ask <= 0.1) {
      outcomeUp = false
      break
    }
  }
  if (outcomeUp === null) ambiguous++
  if (outcomeUp === true) upWins++

  // D5 per-minute stats
  for (let m = 0; m < 15; m++) {
    const t0 = epochMs + m * 60_000
    const t1 = t0 + 60_000
    const st = stateAtOrBefore(t0 + 30_000)
    if (st && st.bid !== null && st.ask !== null) {
      perMin[m].spread.push(st.ask - st.bid)
      perMin[m].bidSz.push(st.bidSz)
      perMin[m].askSz.push(st.askSz)
      const mid = (st.bid + st.ask) / 2
      perMin[m].dist05.push(Math.abs(mid - 0.5))
    }
    let updates = 0
    let travel = 0
    let prevMid: number | null = null
    for (const p of series) {
      if (p.ts < t0 || p.ts >= t1) continue
      updates++
      const mid = midOf(p)
      if (mid !== null && prevMid !== null) travel += Math.abs(mid - prevMid)
      if (mid !== null) prevMid = mid
    }
    perMin[m].updates.push(updates)
    perMin[m].midTravel.push(travel)
  }

  // D3 flip table: sample every 15s
  if (outcomeUp !== null) {
    for (let k = 0; k < 60; k++) {
      const t = epochMs + k * 15_000
      const mid = midOf(stateAtOrBefore(t))
      if (mid === null) continue
      const leadUp = mid >= 0.5
      const q = leadUp ? mid : 1 - mid
      const secLeft = (endMs - t) / 1000
      let bi = -1
      for (let b = 0; b < bandLabel.length; b++)
        if (q >= bandEdges[b] && q < bandEdges[b + 1]) bi = b
      let ti = -1
      for (let b = 0; b < tlLabel.length; b++)
        if (secLeft > tlEdges[b] && secLeft <= tlEdges[b + 1]) ti = b
      if (bi < 0 || ti < 0) continue
      flip[bi][ti].n++
      if (leadUp !== outcomeUp) flip[bi][ti].flips++
    }
  }
}

const q = (a: number[], p: number) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '-')

console.log(
  `\nreplayed ${replayed}, outcome ambiguous ${ambiguous}, asset0 wins ${upWins}/${replayed - ambiguous} (asset0 = first-seen, sanity only)`,
)
console.log('\nD5 lifecycle (asset0 book; side-symmetric), per minute — p50s across markets')
console.log('min | spread p50/p90 | L1 bid sz p50 | L1 ask sz p50 | updates p50 | midTravel p50 | |mid-.5| p50')
for (let m = 0; m < 15; m++) {
  const pm = perMin[m]
  console.log(
    `${String(m).padStart(3)} | ${f(q(pm.spread, 0.5))}/${f(q(pm.spread, 0.9))} | ${f(q(pm.bidSz, 0.5), 0).padStart(6)} | ${f(q(pm.askSz, 0.5), 0).padStart(6)} | ${f(q(pm.updates, 0.5), 0).padStart(4)} | ${f(q(pm.midTravel, 0.5))} | ${f(q(pm.dist05, 0.5))}`,
  )
}

console.log('\nD3 P(flip) = P(leading side at t loses) — rows: leading prob band; cols: seconds left')
console.log(`band | ${tlLabel.join(' | ')}`)
for (let b = 0; b < bandLabel.length; b++) {
  const cells = flip[b].map((c) => (c.n > 0 ? `${((100 * c.flips) / c.n).toFixed(1)}% (${c.n})` : '-'))
  console.log(`${bandLabel[b]} | ${cells.join(' | ')}`)
}
process.exit(0)
