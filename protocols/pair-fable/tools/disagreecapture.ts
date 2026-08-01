/**
 * disagreecapture.ts — quote-time capture of the spot-disagreement flag (§21.2).
 * Read-only (DB + local Binance aggTrades day files). Adapted from doomhazard.ts.
 *
 * Question (pair-v17t.md §21.3 freeze input): the FLAG (advBps <= T at FILL
 * time) separates toxic S fills, but a live maker quote is dosed at QUOTE
 * time — the fill executes against a quote priced with information from some
 * lead time earlier. For each S fill, evaluate advBps at t-LEAD for LEAD in
 * {0.5s, 1s, 2s, 5s}: (a) persistence P(flag@lag | flag@fill), (b) the EV
 * separation using the LAGGED flag as the classifier (the honest quote-time
 * version of §21.2), (c) band x half split for the headline lead 1s.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/disagreecapture.ts --run 1052 [--json]
 */
import '../../../src/config/env.js'
import { openDb, toNum } from './lib/runQueries.js'
import { getInMemoryDuckDb, sqlQuote } from '../../../src/utils/duckdb.js'
import { aggTradesDayPath, utcDatesCovering } from '../../../src/binance/paths.js'
import { fileExists } from '../../../src/utils/fs.js'

function fail(msg: string): never {
  console.error(`[disagreecapture] ERROR: ${msg}`)
  process.exit(2)
}

const runIdArg = process.argv.indexOf('--run')
if (runIdArg === -1 || !process.argv[runIdArg + 1]) fail('--run <id> is required')
const runId = Number(process.argv[runIdArg + 1])
if (!Number.isInteger(runId) || runId <= 0) fail('--run expects a positive integer')
const asJson = process.argv.includes('--json')

const LEADS_MS = [500, 1000, 2000, 5000] as const
const THRESHOLDS = [0, -5] as const
const HEADLINE_LEAD = 1000

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
  advAtFill: number
  advAtLead: number[] // parallel to LEADS_MS
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

const played = markets.filter((m) => m.meta.some((e) => e.m === 'S'))
let skippedNoPtb = 0
let startsNoTs = 0
const fills: FillRec[] = []

// extinction-pool input: per played market, the fill-time advBps of every S
// fill — a market whose EVERY S fill is flagged is the structurally-at-risk
// pool for a disagreeTighten noActivity tripwire (E-052 flipPool analog).
const perMarketFlags = new Map<string, number[]>()
for (const m of played) perMarketFlags.set(m.slug, [])

const byDate = new Map<string, MarketRow[]>()
for (const m of played) {
  const d = new Date(m.marketStartMs).toISOString().slice(0, 10)
  if (!byDate.has(d)) byDate.set(d, [])
  byDate.get(d)!.push(m)
}

let dayN = 0
for (const [, group] of [...byDate.entries()].sort()) {
  dayN++
  if (dayN % 25 === 0) console.error(`[disagreecapture] day ${dayN}/${byDate.size}`)
  const fromMs = Math.min(...group.map((m) => m.marketStartMs)) - PRE_MS
  const toMs = Math.max(...group.map((m) => m.marketStartMs)) + POST_MS
  const series = await loadSeries('BTCUSDT', fromMs, toMs)

  for (const m of group) {
    if (m.priceToBeat === null || m.priceToBeat <= 0) {
      skippedNoPtb += 1
      continue
    }
    const ptb = m.priceToBeat
    for (const e of m.meta) {
      if (e.m !== 'S') continue
      if (e.ts === undefined || e.p === undefined || e.s === undefined || !e.side) {
        startsNoTs += 1
        continue
      }
      const sgn = e.side === 'DOWN' ? 1 : -1
      const adv = (t: number): number => {
        const spot = asof(series, t)
        return Number.isNaN(spot) ? NaN : sgn * ((spot - ptb) / ptb) * 1e4
      }
      const advAtFill = adv(e.ts)
      const advAtLead = LEADS_MS.map((L) => adv(e.ts - L))
      if (Number.isNaN(advAtFill) || advAtLead.some(Number.isNaN)) {
        startsNoTs += 1
        continue
      }
      fills.push({ p: e.p, s: e.s, advAtFill, advAtLead, win: e.side === m.finalOutcome, startMs: m.marketStartMs })
      perMarketFlags.get(m.slug)?.push(advAtFill)
    }
  }
}

function evOf(seg: FillRec[]): { n: number; sh: number; evPerShare: number; grossUsd: number } {
  let sh = 0
  let winSh = 0
  let cost = 0
  for (const r of seg) {
    sh += r.s
    cost += r.s * r.p
    if (r.win) winSh += r.s
  }
  return {
    n: seg.length,
    sh: Math.round(sh),
    evPerShare: sh > 0 ? Number(((winSh - cost) / sh).toFixed(4)) : NaN,
    grossUsd: Math.round(winSh - cost),
  }
}

// (a) persistence + (b) lagged-flag EV separation, per lead x threshold
const laggedRows: Array<Record<string, unknown>> = []
for (let li = 0; li < LEADS_MS.length; li++) {
  for (const T of THRESHOLDS) {
    const flagFill = fills.filter((r) => r.advAtFill <= T)
    const flagLag = fills.filter((r) => r.advAtLead[li]! <= T)
    const both = fills.filter((r) => r.advAtFill <= T && r.advAtLead[li]! <= T)
    const rest = fills.filter((r) => r.advAtLead[li]! > T)
    laggedRows.push({
      leadMs: LEADS_MS[li],
      threshold: T,
      persistence: flagFill.length > 0 ? Number((both.length / flagFill.length).toFixed(3)) : NaN,
      precision: flagLag.length > 0 ? Number((both.length / flagLag.length).toFixed(3)) : NaN,
      flagged: evOf(flagLag),
      rest: evOf(rest),
    })
  }
}

// (c) band x half at the headline lead, threshold 0 — mirrors §21.2's table
const BANDS: Array<[string, (p: number) => boolean]> = [
  ['p<0.30', (p) => p < 0.3],
  ['0.30-0.40', (p) => p >= 0.3 && p < 0.4],
  ['0.40-0.50', (p) => p >= 0.4 && p < 0.5],
  ['p>=0.50', (p) => p >= 0.5],
]
const li1 = LEADS_MS.indexOf(HEADLINE_LEAD as (typeof LEADS_MS)[number])
const starts = played.map((m) => m.marketStartMs).sort((a, b) => a - b)
const median = starts[Math.floor(starts.length / 2)]!
const halfRows: Array<Record<string, unknown>> = []
for (const [label, pred] of BANDS) {
  for (const h of ['H1', 'H2'] as const) {
    const seg = fills.filter((r) => pred(r.p) && (h === 'H1' ? r.startMs < median : r.startMs >= median))
    halfRows.push({
      band: label,
      half: h,
      flagged: evOf(seg.filter((r) => r.advAtLead[li1]! <= 0)),
      rest: evOf(seg.filter((r) => r.advAtLead[li1]! > 0)),
    })
  }
}

const flagPool = THRESHOLDS.map((T) => ({
  threshold: T,
  allFillsFlaggedMkts: [...perMarketFlags.values()].filter((a) => a.length > 0 && a.every((v) => v <= T)).length,
}))

const summary = {
  runId,
  playedWithS: played.length,
  skippedNoPtb,
  fillsAnalyzed: fills.length,
  fillsSkippedNoTsOrSpot: startsNoTs,
  flagPool,
  fillFlagBaseline: THRESHOLDS.map((T) => ({ threshold: T, ...evOf(fills.filter((r) => r.advAtFill <= T)) })),
  laggedRows,
  headline: { leadMs: HEADLINE_LEAD, threshold: 0, halfRows },
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(
    `run ${runId}: playedWithS=${played.length} noPtb=${skippedNoPtb} fills=${fills.length} skipped=${startsNoTs}`,
  )
  for (const T of summary.fillFlagBaseline) {
    console.log(`  fill-time flag T=${T.threshold}: n=${T.n} sh=${T.sh} ev/sh=${T.evPerShare} gross=$${T.grossUsd}`)
  }
  for (const P of flagPool) {
    console.log(`  pool T=${P.threshold}: all-S-fills-flagged markets=${P.allFillsFlaggedMkts}`)
  }
  console.log('\nlead x threshold (flag evaluated at t-LEAD):')
  for (const r of laggedRows) {
    const f = r.flagged as ReturnType<typeof evOf>
    const rr = r.rest as ReturnType<typeof evOf>
    console.log(
      `  lead=${r.leadMs}ms T=${r.threshold}  persist=${r.persistence} precision=${r.precision}  FLAG n=${f.n} ev/sh=${f.evPerShare} gross=$${f.grossUsd}  REST n=${rr.n} ev/sh=${rr.evPerShare}`,
    )
  }
  console.log(`\nband x half @ lead=${HEADLINE_LEAD}ms T=0:`)
  for (const r of halfRows) {
    const f = r.flagged as ReturnType<typeof evOf>
    const rr = r.rest as ReturnType<typeof evOf>
    console.log(
      `  ${r.band} ${r.half}  FLAG n=${f.n} ev/sh=${f.evPerShare}  REST n=${rr.n} ev/sh=${rr.evPerShare}`,
    )
  }
}
