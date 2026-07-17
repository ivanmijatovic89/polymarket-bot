/**
 * fill-density.ts — OPEN-QUESTIONS #2: maker-only fill density by depth
 * offset on btc-15m, under the engine's conservative worst_queue rule.
 *
 * For each market book (Telonex delta-typed parquet) and each side
 * (Up/Down asset): simulate ONE resting BUY level maintained at
 * (bestBid_at_last_requote − offset), requoted every R seconds. A fill
 * is granted when bestAsk drops STRICTLY below the level (worst_queue:
 * price goes through), max one fill per requote interval per side
 * (clip re-arms at the next requote). Final minute (>=840s) not quoted.
 * Levels below $0.01 are not quoted.
 *
 * Reports, per (offset, requote): fills/market (both sides summed)
 * p25/p50/p75, implied maker notional at $4 clips, and % of markets
 * reaching the $143 rebate-step threshold (A28). A k-rung ladder is
 * approximately the sum of its rungs (rungs are not independent in
 * fast sweeps — treat as an upper-ish bound for deep rungs).
 *
 * This is a MEASUREMENT of book dynamics (like D2), not an evidence
 * backtest: no strategy code, no engine run, no EV conclusion.
 *
 * Usage: npx tsx research/gabagool/scripts/fill-density.ts \
 *   [--dir research/gabagool/data/telonex-r2] [--clip 4]
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const dir = argOf('dir') ?? 'research/gabagool/data/telonex-r2'
const clip = Number(argOf('clip') ?? 4)

const OFFSETS = [0, 0.01, 0.02, 0.05, 0.1]
const REQUOTES = [1, 5, 15]

const files = readdirSync(dir)
  .filter((f) => f.startsWith('btc-updown-15m-') && f.endsWith('.parquet'))
  .sort()
console.log(`markets: ${files.length}`)

// fillsPerMarket[oi][ri] -> array over markets of summed fills (both sides)
const fillsPerMarket: number[][][] = OFFSETS.map(() => REQUOTES.map(() => []))

for (const f of files) {
  const slug = f.replace('.parquet', '')
  const epochMs = Number(slug.split('-').pop()) * 1000
  const endQuoteMs = epochMs + 840_000
  const series = new Map<string, Array<{ ts: number; bid: number | null; ask: number | null }>>()
  const last = new Map<string, { bid: number | null; ask: number | null }>()
  await replayTelonexDeltaParquetForMarket({
    filePath: join(dir, f),
    onSnapshot: (snapshot) => {
      for (const [assetId, book] of Object.entries(snapshot.byAssetId)) {
        const bid = (book as { bestBid: number | null }).bestBid
        const ask = (book as { bestAsk: number | null }).bestAsk
        const prev = last.get(assetId)
        if (!prev || prev.bid !== bid || prev.ask !== ask) {
          last.set(assetId, { bid, ask })
          let arr = series.get(assetId)
          if (!arr) series.set(assetId, (arr = []))
          arr.push({ ts: snapshot.timestamp, bid, ask })
        }
      }
    },
  })
  for (let oi = 0; oi < OFFSETS.length; oi++) {
    for (let ri = 0; ri < REQUOTES.length; ri++) {
      let total = 0
      for (const s of series.values()) {
        const R = REQUOTES[ri] * 1000
        const d = OFFSETS[oi]
        let ptr = 0
        for (let t = epochMs; t + R <= endQuoteMs; t += R) {
          // book state at requote time t (advance pointer to last event <= t)
          while (ptr + 1 < s.length && s[ptr + 1].ts <= t) ptr++
          if (s[ptr].ts > t) continue // no state yet
          const bid = s[ptr].bid
          if (bid === null) continue
          const level = Math.round((bid - d) * 100) / 100
          if (level < 0.01) continue
          // min ask in (t, t+R]
          let p = ptr
          let filled = false
          while (p + 1 < s.length && s[p + 1].ts <= t + R) {
            p++
            const a = s[p].ask
            if (a !== null && a < level) {
              filled = true
              break
            }
          }
          if (filled) total++
        }
      }
      fillsPerMarket[oi][ri].push(total)
    }
  }
}

const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
console.log(`\noffset | requote | fills/mkt p25/p50/p75 | $${clip}-clip notional p50 | % mkts >= $143`)
for (let oi = 0; oi < OFFSETS.length; oi++) {
  for (let ri = 0; ri < REQUOTES.length; ri++) {
    const a = fillsPerMarket[oi][ri]
    const notional = a.map((x) => x * clip)
    const pct = (100 * notional.filter((x) => x >= 143).length) / a.length
    console.log(
      `-${(OFFSETS[oi] * 100).toFixed(0)}c | ${REQUOTES[ri]}s | ${q(a, 0.25)}/${q(a, 0.5)}/${q(a, 0.75)} | $${q(notional, 0.5).toFixed(0)} | ${pct.toFixed(0)}%`,
    )
  }
}
process.exit(0)
