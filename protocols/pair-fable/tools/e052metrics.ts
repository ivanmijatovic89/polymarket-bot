/**
 * E-052 readout metrics from intent_meta (§19 watch + degeneracy metrics).
 * Usage: tsx protocols/pair-fable/tools/e052metrics.ts --run <id>[,<id>...]
 * Per run: late (>=5min) >=0.40 S fill count + avg in-band fill price,
 * noActivity count, flip-risk pool (played markets whose EVERY S fill is
 * late >=0.40), C+D dollars, fees, S fill count total.
 * Read-only. Known-answer base on 1052: inBand=1091, noActivity=5308,
 * flipPool=719, S=6658, C+D$=417.6k.
 */
import '../../../src/config/env.js'
import { openDb } from './lib/runQueries.js'

const EARLY_MS = 5 * 60_000
const LATE_BAND = 0.4 - 1e-9

interface MetaEntry {
  m?: string
  ts?: number
  p?: number
  s?: number
  side?: string
}

const runsArg = process.argv[process.argv.indexOf('--run') + 1]
if (!runsArg) {
  console.error('usage: --run <id>[,<id>...]')
  process.exit(2)
}

const conn = await openDb()

for (const runId of runsArg.split(',').map((s) => Number(s.trim()))) {
  const [rows] = await conn.query(
    `SELECT slug, market_start_ms, intent_meta, skip_reason, fees_paid, trade_count
     FROM backtest_run_markets WHERE run_id = ?`,
    [runId],
  )
  let inBand = 0
  let inBandSharesPx = 0
  let inBandShares = 0
  let sTotal = 0
  let cdDollars = 0
  let fees = 0
  let noActivity = 0
  let flipPool = 0
  let played = 0
  for (const r of rows as any[]) {
    fees += Number(r.fees_paid ?? 0)
    if (r.skip_reason === 'no_in_window_activity') noActivity += 1
    if (Number(r.trade_count ?? 0) > 0) played += 1
    const meta: MetaEntry[] =
      typeof r.intent_meta === 'string' ? JSON.parse(r.intent_meta) : (r.intent_meta ?? [])
    const startMs = Number(r.market_start_ms)
    let sFills = 0
    let sLateBand = 0
    for (const e of meta) {
      if (e.m === 'C' || e.m === 'D') {
        if (e.p !== undefined && e.s !== undefined) cdDollars += e.p * e.s
        continue
      }
      if (e.m !== 'S') continue
      sTotal += 1
      sFills += 1
      if (e.ts === undefined || e.p === undefined) continue
      const late = e.ts - startMs >= EARLY_MS
      if (late && e.p >= LATE_BAND) {
        inBand += 1
        sLateBand += 1
        if (e.s !== undefined) {
          inBandSharesPx += e.p * e.s
          inBandShares += e.s
        }
      }
    }
    if (sFills > 0 && sLateBand === sFills) flipPool += 1
  }
  console.log(
    JSON.stringify({
      runId,
      markets: (rows as any[]).length,
      played,
      noActivity,
      sTotal,
      inBandLateS: inBand,
      inBandAvgPx: inBandShares > 0 ? +(inBandSharesPx / inBandShares).toFixed(4) : null,
      flipPool,
      cdDollars: +cdDollars.toFixed(0),
      fees: +fees.toFixed(0),
    }),
  )
}
await conn.end()
