/**
 * doomhazard.ts — v17t doom-hazard feature analysis at S-fill time.
 * Read-only (DB + local Binance aggTrades day files). Adapted from
 * contested.ts for the v17t family, where doom is a COMPLETION PATHWAY
 * (market has D fills and no C fills), not end-of-market residue.
 *
 * Question (pair-v17t.md §21 design input): conditional on the S fill's own
 * price band — which the controller can already condition on, and which the
 * gross-EV matrix shows is ~uniformly priced outside the late >=0.40 band —
 * does spot-vs-priceToBeat adverse distance / 60s adverse drift at fill time
 * add doom discrimination and EV separation? If NO region separates, the
 * feed-based hazard lever dies a fortiori (fill-time features overstate what
 * a quote-time gate can see — same one-sided bias note as contested.ts).
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/doomhazard.ts --run 1052 [--json]
 *
 * Per S fill: advBps  = signed spot distance from priceToBeat, positive when
 *                       spot is on the side ADVERSE to the fill (fill side is
 *                       losing at fill time);
 *             advDrift60Bps = signed 60s spot move, positive when moving
 *                       AGAINST the fill side.
 * Aggregation: per price band, within-band quartiles of each feature →
 * doom-market fill fraction, share-weighted win rate, gross EV/share.
 */
import '../../../src/config/env.js'
import { openDb, toNum } from './lib/runQueries.js'
import { getInMemoryDuckDb, sqlQuote } from '../../../src/utils/duckdb.js'
import { aggTradesDayPath, utcDatesCovering } from '../../../src/binance/paths.js'
import { fileExists } from '../../../src/utils/fs.js'

function fail(msg: string): never {
  console.error(`[doomhazard] ERROR: ${msg}`)
  process.exit(2)
}

const runIdArg = process.argv.indexOf('--run')
if (runIdArg === -1 || !process.argv[runIdArg + 1]) fail('--run <id> is required')
const runId = Number(process.argv[runIdArg + 1])
if (!Number.isInteger(runId) || runId <= 0) fail('--run expects a positive integer')
const asJson = process.argv.includes('--json')
// --half first|second: split played markets at the median market_start_ms —
// disjoint-halves confirmation for any positive found on the full run.
const halfArg = process.argv.indexOf('--half')
const half = halfArg === -1 ? null : process.argv[halfArg + 1]
if (half !== null && half !== 'first' && half !== 'second') fail("--half expects 'first' or 'second'")

type MetaEntry = { side?: string; s?: number; ts?: number; m?: string; p?: number }
type MarketRow = {
  slug: string
  marketStartMs: number
  finalOutcome: string
  priceToBeat: number | null
  meta: MetaEntry[]
}

type Series = { ts: Float64Array; px: Float64Array }
const PRE_MS = 180_000
const POST_MS = 990_000

async function loadSeries(pair: string, fromMs: number, toMs: number): Promise<Series> {
  const dates = utcDatesCovering(fromMs, toMs)
  const paths: string[] = []
  for (const d of dates) {
    const p = aggTradesDayPath(pair, d)
    if (!(await fileExists(p))) fail(`missing aggTrades day file: ${p}`)
    paths.push(p)
  }
  const db = await getInMemoryDuckDb()
  const conn = await db.connect()
  try {
    const fileList = paths.map(sqlQuote).join(', ')
    const result = await conn.run(
      `SELECT ts_ms, price FROM read_parquet([${fileList}])
       WHERE ts_ms BETWEEN ${Math.floor(fromMs)} AND ${Math.floor(toMs)}
       ORDER BY agg_trade_id`,
    )
    const tsChunks: Float64Array[] = []
    const pxChunks: Float64Array[] = []
    let total = 0
    for (let c = 0; c < result.chunkCount; c++) {
      const rows = result.getChunk(c).getRows()
      const ts = new Float64Array(rows.length)
      const px = new Float64Array(rows.length)
      for (let i = 0; i < rows.length; i++) {
        ts[i] = Number(rows[i]?.[0])
        px[i] = Number(rows[i]?.[1])
      }
      tsChunks.push(ts)
      pxChunks.push(px)
      total += rows.length
    }
    const ts = new Float64Array(total)
    const px = new Float64Array(total)
    let off = 0
    for (let i = 0; i < tsChunks.length; i++) {
      ts.set(tsChunks[i]!, off)
      px.set(pxChunks[i]!, off)
      off += tsChunks[i]!.length
    }
    return { ts, px }
  } finally {
    conn.closeSync()
  }
}

function asof(s: Series, t: number): number {
  let lo = 0
  let hi = s.ts.length - 1
  if (hi < 0 || s.ts[0]! > t) return NaN
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (s.ts[mid]! <= t) lo = mid
    else hi = mid - 1
  }
  return s.px[lo]!
}

type FillRec = {
  p: number
  s: number
  minute: number
  advBps: number
  advDrift60Bps: number
  doom: boolean
  win: boolean
  startMs: number
}

const conn = await openDb()
let markets: MarketRow[]
try {
  const [rows] = (await conn.query(
    `SELECT brm.slug, brm.market_start_ms, brm.final_outcome, brm.intent_meta, tm.price_to_beat
       FROM backtest_run_markets brm
       LEFT JOIN telonex_markets tm ON tm.slug = brm.slug
      WHERE brm.run_id = ? ORDER BY brm.market_start_ms`,
    [runId],
  )) as [Array<Record<string, unknown>>, unknown]
  markets = rows.map((r) => ({
    slug: String(r.slug),
    marketStartMs: Number(r.market_start_ms),
    finalOutcome: String(r.final_outcome),
    priceToBeat: toNum(r.price_to_beat),
    meta: (typeof r.intent_meta === 'string'
      ? JSON.parse(r.intent_meta)
      : (r.intent_meta ?? [])) as MetaEntry[],
  }))
} finally {
  await conn.end()
}

let played = markets.filter((m) => m.meta.some((e) => e.m === 'S'))
if (half !== null) {
  const starts = played.map((m) => m.marketStartMs).sort((a, b) => a - b)
  const median = starts[Math.floor(starts.length / 2)]!
  played = played.filter((m) => (half === 'first' ? m.marketStartMs < median : m.marketStartMs >= median))
}
let skippedNoPtb = 0
let startsNoTs = 0
const fills: FillRec[] = []

const byDate = new Map<string, MarketRow[]>()
for (const m of played) {
  const d = new Date(m.marketStartMs).toISOString().slice(0, 10)
  if (!byDate.has(d)) byDate.set(d, [])
  byDate.get(d)!.push(m)
}

let dayN = 0
for (const [, group] of [...byDate.entries()].sort()) {
  dayN++
  if (dayN % 25 === 0) console.error(`[doomhazard] day ${dayN}/${byDate.size}`)
  const fromMs = Math.min(...group.map((m) => m.marketStartMs)) - PRE_MS
  const toMs = Math.max(...group.map((m) => m.marketStartMs)) + POST_MS
  const series = await loadSeries('BTCUSDT', fromMs, toMs)

  for (const m of group) {
    if (m.priceToBeat === null || m.priceToBeat <= 0) {
      skippedNoPtb += 1
      continue
    }
    const ptb = m.priceToBeat
    const hasD = m.meta.some((e) => e.m === 'D')
    const hasC = m.meta.some((e) => e.m === 'C')
    const doom = hasD && !hasC
    for (const e of m.meta) {
      if (e.m !== 'S') continue
      if (e.ts === undefined || e.p === undefined || e.s === undefined || !e.side) {
        startsNoTs += 1
        continue
      }
      const spot = asof(series, e.ts)
      const spotPrev = asof(series, e.ts - 60_000)
      if (Number.isNaN(spot) || Number.isNaN(spotPrev)) {
        startsNoTs += 1
        continue
      }
      const signedBps = ((spot - ptb) / ptb) * 1e4
      const driftBps = ((spot - spotPrev) / ptb) * 1e4
      const sgn = e.side === 'DOWN' ? 1 : -1
      fills.push({
        p: e.p,
        s: e.s,
        minute: Math.max(0, Math.min(15, Math.floor((e.ts - m.marketStartMs) / 60_000))),
        advBps: sgn * signedBps,
        advDrift60Bps: sgn * driftBps,
        doom,
        win: e.side === m.finalOutcome,
        startMs: m.marketStartMs,
      })
    }
  }
}

const BANDS: Array<[string, (p: number) => boolean]> = [
  ['p<0.30', (p) => p < 0.3],
  ['0.30-0.40', (p) => p >= 0.3 && p < 0.4],
  ['0.40-0.50', (p) => p >= 0.4 && p < 0.5],
  ['p>=0.50', (p) => p >= 0.5],
]

type QRow = {
  band: string
  feature: string
  q: string
  lo: number
  hi: number
  fills: number
  doomFrac: number
  winRate: number
  evPerShare: number
  avgP: number
}

function quartileRows(band: string, inBand: FillRec[], feature: 'advBps' | 'advDrift60Bps'): QRow[] {
  const sorted = [...inBand].sort((a, b) => a[feature] - b[feature])
  const out: QRow[] = []
  for (let q = 0; q < 4; q++) {
    const lo = Math.floor((q * sorted.length) / 4)
    const hi = Math.floor(((q + 1) * sorted.length) / 4)
    const seg = sorted.slice(lo, hi)
    if (seg.length === 0) continue
    let sh = 0
    let winSh = 0
    let cost = 0
    let doomN = 0
    for (const r of seg) {
      sh += r.s
      cost += r.s * r.p
      if (r.win) winSh += r.s
      if (r.doom) doomN += 1
    }
    out.push({
      band,
      feature,
      q: `Q${q + 1}`,
      lo: Math.round(seg[0]![feature]),
      hi: Math.round(seg[seg.length - 1]![feature]),
      fills: seg.length,
      doomFrac: Number((doomN / seg.length).toFixed(3)),
      winRate: Number((winSh / sh).toFixed(3)),
      evPerShare: Number(((winSh - cost) / sh).toFixed(4)),
      avgP: Number((cost / sh).toFixed(3)),
    })
  }
  return out
}

const rows: QRow[] = []
for (const [label, pred] of BANDS) {
  const inBand = fills.filter((r) => pred(r.p))
  if (inBand.length < 40) continue
  rows.push(...quartileRows(label, inBand, 'advBps'))
  rows.push(...quartileRows(label, inBand, 'advDrift60Bps'))
}

const summary = {
  runId,
  playedWithS: played.length,
  skippedNoPtb,
  fillsAnalyzed: fills.length,
  fillsSkippedNoTsOrSpot: startsNoTs,
  doomFillsOverall: fills.filter((r) => r.doom).length,
  rows,
}

const dumpArg = process.argv.indexOf('--dump')
if (dumpArg !== -1 && process.argv[dumpArg + 1]) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.argv[dumpArg + 1]!, JSON.stringify(fills))
  console.error(`[doomhazard] dumped ${fills.length} fills to ${process.argv[dumpArg + 1]}`)
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(
    `run ${runId}: playedWithS=${played.length} noPtb=${skippedNoPtb} fills=${fills.length} skipped=${startsNoTs} doomFills=${summary.doomFillsOverall}`,
  )
  let last = ''
  for (const r of rows) {
    const key = `${r.band}/${r.feature}`
    if (key !== last) {
      console.log(`\n${r.band}  ${r.feature}`)
      last = key
    }
    console.log(
      `  ${r.q} [${r.lo},${r.hi}]bps  n=${r.fills}  doom=${(r.doomFrac * 100).toFixed(1)}%  win=${(r.winRate * 100).toFixed(1)}%  ev/sh=${r.evPerShare.toFixed(4)}  avgP=${r.avgP}`,
    )
  }
}
