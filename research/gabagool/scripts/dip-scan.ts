/**
 * dip-scan.ts — D1 (P38 re-scope / OPEN-QUESTIONS #10): how often does
 * sum-of-best-asks drop below $1.00 on btc-15m, for how long, how deep,
 * and does the discount clear taker fees on both legs?
 *
 * Per book: track bestAsk price+size for both assets; an EPISODE is a
 * maximal time span with askUp + askDn < 1.00 (both sides present).
 * Records: duration, min sum, max instantaneous executable pair value
 * (min(bestAskSize_up, bestAskSize_dn) × (1 − sum) at the best moment,
 * top-of-book only — conservative), and whether the best moment cleared
 * two-leg taker fees (0.07·p(1−p) per share per leg).
 *
 * Usage: npx tsx research/gabagool/scripts/dip-scan.ts \
 *   [--dir research/gabagool/data/telonex-r2] [--recursive] [--by-day]
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const dir = argOf('dir') ?? 'research/gabagool/data/telonex-r2'
const recursive = args.includes('--recursive')
const byDay = args.includes('--by-day')

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
files.sort()
console.log(`books (stubs excluded): ${files.length}`)

type Ep = { durMs: number; minSum: number; maxPairValue: number; feeClearing: boolean }
type MarketStat = {
  day: string
  dipTimeMs: number
  windowMs: number
  episodes: Ep[]
}
const stats: MarketStat[] = []

for (const path of files) {
  const slug = path.slice(path.lastIndexOf('/') + 1).replace('.parquet', '')
  const epochMs = Number(slug.split('-').pop()) * 1000
  const endMs = epochMs + 900_000
  const assets = new Map<string, { ask: number | null; size: number }>()
  let lastTs: number | null = null
  let inDip = false
  let dipStart = 0
  let minSum = Infinity
  let maxPairValue = 0
  let feeClearing = false
  let dipTimeMs = 0
  const episodes: Ep[] = []

  const closeEpisode = (ts: number) => {
    if (!inDip) return
    episodes.push({ durMs: ts - dipStart, minSum, maxPairValue, feeClearing })
    dipTimeMs += ts - dipStart
    inDip = false
    minSum = Infinity
    maxPairValue = 0
    feeClearing = false
  }

  await replayTelonexDeltaParquetForMarket({
    filePath: path,
    onSnapshot: (snapshot) => {
      const ts = Math.min(Math.max(snapshot.timestamp, epochMs), endMs)
      for (const [assetId, book] of Object.entries(snapshot.byAssetId)) {
        const b = book as { bestAsk: number | null; asks: Array<{ price: number; size: number }> }
        assets.set(assetId, {
          ask: b.bestAsk,
          size: b.asks.length ? b.asks[0].size : 0,
        })
      }
      if (assets.size < 2) return
      const [a1, a2] = [...assets.values()]
      const ok = a1.ask !== null && a2.ask !== null
      const sum = ok ? a1.ask! + a2.ask! : Infinity
      const below = ok && sum < 0.9999
      if (below) {
        if (!inDip) {
          inDip = true
          dipStart = ts
        }
        if (sum < minSum) minSum = sum
        const pairs = Math.min(a1.size, a2.size)
        const value = pairs * (1 - sum)
        if (value > maxPairValue) maxPairValue = value
        const fee = 0.07 * a1.ask! * (1 - a1.ask!) + 0.07 * a2.ask! * (1 - a2.ask!)
        if (1 - sum > fee) feeClearing = true
      } else {
        closeEpisode(ts)
      }
      lastTs = ts
    },
  })
  closeEpisode(lastTs ?? endMs)
  stats.push({
    day: new Date(epochMs).toISOString().slice(0, 10),
    dipTimeMs,
    windowMs: 900_000,
    episodes,
  })
}

const q = (a: number[], p: number) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const summarize = (label: string, g: MarketStat[]) => {
  const allEps = g.flatMap((m) => m.episodes)
  const withDip = g.filter((m) => m.episodes.length > 0)
  const feeEps = allEps.filter((e) => e.feeClearing)
  const marketsWithFeeClearing = g.filter((m) => m.episodes.some((e) => e.feeClearing))
  console.log(
    `${label} | mkts ${g.length} | with-dip ${withDip.length} (${((100 * withDip.length) / g.length).toFixed(0)}%) | eps/mkt p50 ${q(g.map((m) => m.episodes.length), 0.5)} | ep dur p50/p90 ${(q(allEps.map((e) => e.durMs), 0.5) / 1000).toFixed(2)}/${(q(allEps.map((e) => e.durMs), 0.9) / 1000).toFixed(2)}s | dip-time/mkt p90 ${(q(g.map((m) => m.dipTimeMs), 0.9) / 1000).toFixed(1)}s | minSum p10 ${q(allEps.map((e) => e.minSum), 0.1)?.toFixed(3)} | pairValue/ep p50 $${q(allEps.map((e) => e.maxPairValue), 0.5)?.toFixed(2)} p90 $${q(allEps.map((e) => e.maxPairValue), 0.9)?.toFixed(2)} | totValue/mkt p50/p90 $${q(g.map((m) => m.episodes.reduce((a, e) => a + e.maxPairValue, 0)), 0.5)?.toFixed(2)}/$${q(g.map((m) => m.episodes.reduce((a, e) => a + e.maxPairValue, 0)), 0.9)?.toFixed(2)} | fee-clearing eps ${feeEps.length}/${allEps.length} | mkts w/ fee-clearing ${marketsWithFeeClearing.length} (${((100 * marketsWithFeeClearing.length) / g.length).toFixed(0)}%)`,
  )
}
summarize('ALL', stats)
if (byDay) {
  for (const day of [...new Set(stats.map((m) => m.day))].sort()) {
    summarize(day, stats.filter((m) => m.day === day))
  }
}
process.exit(0)
