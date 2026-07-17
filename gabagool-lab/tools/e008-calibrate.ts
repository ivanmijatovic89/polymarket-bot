/**
 * e008-calibrate.ts — pre-registered E008 grid calibration (LEDGER §E008).
 *
 * Measures the pooled |spot − strike|/strike distance (bps) over the quoting
 * window (elapsed 60..840 s, 1 s samples) across the h1 (Apr) market set —
 * defined as run 708's market rows, the exact experiment universe — from the
 * on-disk Binance aggTrades day parquet. Strike = as-of spot at window open
 * (last trade ≤ epoch, forward-filled per-second series; matches the feed's
 * as-of semantics). Read-only: no DB writes, no backtest.
 *
 * Grid rule (frozen in the draft BEFORE this ran): θ grid = {p40, p60, p80}
 * of pooled |d| rounded to nearest 1 bps, dedup; fallback {p50, p70, p85}
 * if p40 rounds to 0. Arms = ref + θ0 (sign-only) + the three quantiles.
 *
 * Usage: npx tsx gabagool-lab/tools/e008-calibrate.ts --run 708
 */
import { getInMemoryDuckDb, sqlQuote } from '../../src/utils/duckdb.js'
import { aggTradesDayPath } from '../../src/binance/paths.js'
import { fileExists } from '../../src/utils/fs.js'
import { closeDb, loadMarketRows, quantile } from './lib.js'

const runId = Number(process.argv[process.argv.indexOf('--run') + 1] || 708)
const START_SEC = 60
const STOP_SEC = 840
const SEED_LOOKBACK_SEC = 3600

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

async function main(): Promise<void> {
  const rows = await loadMarketRows(runId)
  if (!rows.length) throw new Error(`run ${runId}: no market rows`)
  const epochs: number[] = []
  for (const m of rows) {
    const match = m.slug.match(/-(\d+)$/)
    if (match) epochs.push(Number(match[1]) * 1000)
  }
  epochs.sort((a, b) => a - b)
  console.log(`run ${runId}: ${rows.length} markets, ${epochs.length} epochs parsed`)
  console.log(`window span ${isoDate(epochs[0]!)} .. ${isoDate(epochs[epochs.length - 1]!)}`)

  const fromMs = epochs[0]! - SEED_LOOKBACK_SEC * 1000
  const toMs = epochs[epochs.length - 1]! + STOP_SEC * 1000
  const dates: string[] = []
  for (let ms = fromMs; ms <= toMs + 86_400_000; ms += 86_400_000) {
    const d = isoDate(ms)
    if (!dates.includes(d)) dates.push(d)
  }
  const paths: string[] = []
  const missing: string[] = []
  for (const d of dates) {
    const p = aggTradesDayPath('BTCUSDT', d)
    if (await fileExists(p)) paths.push(p)
    else missing.push(d)
  }
  if (missing.length) throw new Error(`missing day files: ${missing.join(', ')}`)
  console.log(`day files: ${paths.length} (${dates[0]} .. ${dates[dates.length - 1]})`)

  // One aggregate pass: last price per second over the whole span.
  const db = await getInMemoryDuckDb()
  const conn = await db.connect()
  const fromSec = Math.floor(fromMs / 1000)
  const toSec = Math.floor(toMs / 1000)
  const secPx = new Map<number, number>()
  try {
    const fileList = paths.map(sqlQuote).join(', ')
    const result = await conn.run(
      `SELECT CAST(floor(ts_ms / 1000) AS BIGINT) AS sec, max_by(price, agg_trade_id) AS px
       FROM read_parquet([${fileList}])
       WHERE ts_ms >= ${fromMs} AND ts_ms <= ${toMs}
       GROUP BY 1`,
    )
    for (let c = 0; c < result.chunkCount; c++) {
      for (const r of result.getChunk(c).getRows()) secPx.set(Number(r[0]), Number(r[1]))
    }
  } finally {
    conn.closeSync()
  }
  console.log(`per-second series: ${secPx.size} seconds with trades of ${toSec - fromSec + 1} span`)

  // Forward-fill into a dense array.
  const span = toSec - fromSec + 1
  const px = new Float64Array(span)
  let last = NaN
  for (let s = 0; s < span; s++) {
    const v = secPx.get(fromSec + s)
    if (v !== undefined) last = v
    px[s] = last
  }

  // Pool |d| bps over elapsed 60..840 per market; also signed profile stats.
  const pooled: number[] = []
  const atElapsed: Record<number, number[]> = { 120: [], 300: [], 600: [], 840: [] }
  const terminal: number[] = []
  let skippedNoStrike = 0
  for (const epoch of epochs) {
    const openIdx = Math.floor(epoch / 1000) - fromSec
    const strike = px[openIdx]
    if (strike === undefined || Number.isNaN(strike)) {
      skippedNoStrike++
      continue
    }
    for (let t = START_SEC; t <= STOP_SEC; t++) {
      const v = px[openIdx + t]
      if (v === undefined || Number.isNaN(v)) continue
      const dBps = (Math.abs(v - strike) / strike) * 1e4
      pooled.push(dBps)
      if (t in atElapsed) atElapsed[t]!.push(dBps)
      if (t === STOP_SEC) terminal.push(dBps)
    }
  }
  if (skippedNoStrike) console.log(`markets skipped (no strike): ${skippedNoStrike}`)
  pooled.sort((a, b) => a - b)
  console.log(`pooled samples: ${pooled.length} (${epochs.length - skippedNoStrike} markets × ~781 s)`)

  console.log('\n-- pooled |d| bps quantiles (elapsed 60..840 s) --')
  for (const q of [0.1, 0.25, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95])
    console.log(`  p${String(Math.round(q * 100)).padStart(2, '0')}  ${quantile(pooled, q).toFixed(2)}`)

  console.log('\n-- |d| bps p50 by elapsed (profile, for the record) --')
  for (const t of [120, 300, 600, 840]) {
    const xs = atElapsed[t]!.sort((a, b) => a - b)
    console.log(
      `  t=${t}s  p50 ${quantile(xs, 0.5).toFixed(2)}  p80 ${quantile(xs, 0.8).toFixed(2)}  n=${xs.length}`,
    )
  }

  // Grid rule, executed verbatim.
  const p40 = Math.round(quantile(pooled, 0.4))
  const primary = [p40, Math.round(quantile(pooled, 0.6)), Math.round(quantile(pooled, 0.8))]
  const fallback = [0.5, 0.7, 0.85].map((q) => Math.round(quantile(pooled, q)))
  const chosen = p40 === 0 ? fallback : primary
  const grid = [...new Set(chosen)]
  console.log(`\n-- grid rule --`)
  console.log(`  primary {p40,p60,p80} = {${primary.join(', ')}} bps`)
  console.log(`  fallback {p50,p70,p85} = {${fallback.join(', ')}} bps`)
  console.log(`  CHOSEN (${p40 === 0 ? 'fallback' : 'primary'}, dedup): {${grid.join(', ')}} bps`)
  console.log(`  arms: ref (no gate), θ0 = 0 bps (sign-only), θ ∈ {${grid.join(', ')}}`)

  // Bind fractions: share of pooled samples the gate would arm at each θ
  // (|d| > θ means ONE side is suppressed at that second).
  console.log('\n-- bind fraction (share of market-seconds with |d| > θ) --')
  for (const th of [0, ...grid]) {
    let lo = 0
    let hi = pooled.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pooled[mid]! > th) hi = mid
      else lo = mid + 1
    }
    console.log(`  θ=${th} bps  bind ${(((pooled.length - lo) / pooled.length) * 100).toFixed(1)}%`)
  }
  await closeDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
