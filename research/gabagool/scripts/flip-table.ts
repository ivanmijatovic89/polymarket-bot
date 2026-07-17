/**
 * flip-table.ts — W4 remainder: endgame flip probabilities at scale.
 *
 * For each btc-15m book and each checkpoint of remaining time, record
 * the Up-asset mid (favorite side + its implied probability), then
 * P(current favorite loses) by (favorite-mid bucket × time left),
 * using telonex DB result_id as ground truth.
 *
 * Usage: npx tsx research/gabagool/scripts/flip-table.ts \
 *   [--dir research/gabagool/data/telonex-r2-w4] [--recursive]
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'
import { listEligibleTelonexMarkets } from '../../../src/db/telonexMarkets.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const dir = argOf('dir') ?? 'research/gabagool/data/telonex-r2-w4'
const recursive = args.includes('--recursive')

const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (recursive && statSync(p).isDirectory()) walk(p)
    else if (e.startsWith('btc-updown-15m-') && e.endsWith('.parquet') && statSync(p).size > 100_000)
      files.push(p)
  }
}
walk(dir)
const slugOf = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace('.parquet', '')
const epochs = files.map((p) => Number(slugOf(p).split('-').pop()))
const fromMs = Math.min(...epochs) * 1000 - 3600_000
const toMs = Math.max(...epochs) * 1000 + 3600_000
console.log(`books: ${files.length}`)

// winner per slug; Up won iff resultId maps to outcome 'Up'
const winnerOf = new Map<string, string>()
for (const m of await listEligibleTelonexMarkets({
  symbol: 'btc',
  timeframe: '15m',
  converter: 'delta-typed',
  readFrom: 'r2',
  fromMs,
  toMs,
  limit: 20000,
})) {
  if (m.resultId === '0') winnerOf.set(m.slug, m.outcome0)
  else if (m.resultId === '1') winnerOf.set(m.slug, m.outcome1)
}

const CHECKPOINTS = [600, 300, 120, 60, 30, 10] // seconds remaining
const BUCKETS: Array<[string, number, number]> = [
  ['0.50-0.60', 0.5, 0.6],
  ['0.60-0.70', 0.6, 0.7],
  ['0.70-0.80', 0.7, 0.8],
  ['0.80-0.90', 0.8, 0.9],
  ['0.90-0.99', 0.9, 0.99],
  ['0.99+', 0.99, 1.01],
]
// counts[cpIdx][bucketIdx] = {n, flips}
const counts = CHECKPOINTS.map(() => BUCKETS.map(() => ({ n: 0, flips: 0 })))

for (const path of files) {
  const slug = slugOf(path)
  const winner = winnerOf.get(slug)
  if (!winner) continue
  const epochMs = Number(slug.split('-').pop()) * 1000
  const endMs = epochMs + 900_000
  // build Up-asset mid series: identify Up asset via DB? snapshot has assetIds only.
  // Use both assets: favorite = asset with mid > 0.5; flip = favorite's side != winner side.
  // Map assetId -> outcome via DB row.
  const row = (await listEligibleTelonexMarkets({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'r2',
    fromMs: epochMs,
    toMs: epochMs + 900_000,
    limit: 5,
  })).find((m) => m.slug === slug)
  if (!row) continue
  const outcomeOfAsset = new Map<string, string>([
    [row.assetId0, row.outcome0],
    [row.assetId1, row.outcome1],
  ])
  const series: Array<{ ts: number; mids: Map<string, number> }> = []
  const lastMid = new Map<string, number>()
  await replayTelonexDeltaParquetForMarket({
    filePath: path,
    onSnapshot: (snapshot) => {
      let changed = false
      for (const [assetId, book] of Object.entries(snapshot.byAssetId)) {
        const b = book as { bestBid: number | null; bestAsk: number | null }
        if (b.bestBid !== null && b.bestAsk !== null) {
          const mid = (b.bestBid + b.bestAsk) / 2
          if (lastMid.get(assetId) !== mid) {
            lastMid.set(assetId, mid)
            changed = true
          }
        }
      }
      if (changed) series.push({ ts: snapshot.timestamp, mids: new Map(lastMid) })
    },
  })
  for (let ci = 0; ci < CHECKPOINTS.length; ci++) {
    const t = endMs - CHECKPOINTS[ci] * 1000
    // last state <= t
    let st: { ts: number; mids: Map<string, number> } | null = null
    for (const s of series) {
      if (s.ts <= t) st = s
      else break
    }
    if (!st || st.mids.size < 2) continue
    // favorite asset = highest mid
    let favAsset = ''
    let favMid = -1
    for (const [a, m] of st.mids) {
      if (m > favMid) {
        favMid = m
        favAsset = a
      }
    }
    if (favMid < 0.5) continue
    const bi = BUCKETS.findIndex(([, lo, hi]) => favMid >= lo && favMid < hi)
    if (bi < 0) continue
    counts[ci][bi].n++
    if (outcomeOfAsset.get(favAsset) !== winner) counts[ci][bi].flips++
  }
}

console.log('\nP(favorite loses) by favorite mid bucket x seconds remaining:')
console.log(`bucket | ${CHECKPOINTS.map((c) => `${c}s`).join(' | ')}`)
for (let bi = 0; bi < BUCKETS.length; bi++) {
  const cells = CHECKPOINTS.map((_, ci) => {
    const { n, flips } = counts[ci][bi]
    return n ? `${((100 * flips) / n).toFixed(1)}% (${n})` : '-'
  })
  console.log(`${BUCKETS[bi][0]} | ${cells.join(' | ')}`)
}
process.exit(0)
