/**
 * calib.ts — E-028 (pair-v14) unconditional book-vs-outcome calibration
 * scan. Read-only: DB for market rows, local delta-typed parquet for books.
 * Pre-registered hypotheses, cells, views and verdict bars:
 * memory/experiments/pair-v14.md (design-ts 276e1dd, committed BEFORE this
 * tool existed).
 *
 * Measurement: at fixed clock times t_k = market_start + k·15s (k = 0..59),
 * for each side, record the best ask as-of t_k (last book state with
 * ts ≤ t_k) and the ask as-of t_k+140ms (executable companion: a marketable
 * limit at ask(t_k) fills iff ask(t_k+140) ≤ ask(t_k), at the arrival ask).
 * Per-observation edge = 1{side wins} − (p + 0.07·p·(1−p)). Cells =
 * minute-of-window (0..14) × 0.05-wide price band (0..19). Inference is
 * cluster-robust with cluster = slug.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/calib.ts [--latest 800] [--to-ms <ms>]
 *     [--max-markets N] [--latency-ms 140] [--checkpoint <file.jsonl>]
 *     [--time-budget-s N] [--json]
 *
 * --checkpoint persists each scanned market's per-cell aggregates as one
 * JSONL line and resumes by slug (params recorded in a header line and must
 * match). --time-budget-s stops after N seconds with {"partial":true} —
 * rerun the same command to continue.
 */
import '../../../src/config/env.js'
import fs from 'node:fs'
import { listEligibleTelonexMarkets, type Market } from '../../../src/db/telonexMarkets.js'
import { closeDb } from '../../../src/db/index.js'
import { getMarketResolution } from '../../../src/backtest/stats/telonexMarketResolution.js'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const PROTOCOL_FLOOR_MS = 1775088000000 // 2026-04-02, RULES universe floor
const SAMPLE_STEP_MS = 15_000 // frozen: 4 samples/minute
const SAMPLES = 60 // k = 0..59 (full 15m window)
const N_MIN = 15 // minute buckets
const N_BAND = 20 // 0.05-wide price bands
const MIN_REGION_MARKETS = 100 // frozen: per-half pooled n_markets floor
// E-028b frozen first-touch regions (minutes 0–9, i.e. k ≤ 39): [X1, X2)
const FT_REGIONS: Array<[string, number, number]> = [
  ['R1_0.90-1.00', 0.9, 1.0],
  ['R2_0.90-0.95', 0.9, 0.95],
  ['R3_0.95-1.00', 0.95, 1.0],
]
const FT_MAX_K = 39 // minutes 0–9

function fail(msg: string): never {
  console.error(`[calib] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = {
  latest: number
  toMs: number | null
  maxMarkets: number | null
  offset: number
  latencyMs: number
  checkpoint: string | null
  timeBudgetS: number | null
  json: boolean
  firstTouch: boolean
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    latest: 800,
    toMs: null,
    maxMarkets: null,
    offset: 0,
    latencyMs: 140,
    checkpoint: null,
    timeBudgetS: null,
    json: false,
    firstTouch: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${flag} requires a value`)
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) fail(`${flag} expects a positive number, got '${v}'`)
      return n
    }
    switch (flag) {
      case '--latest':
        o.latest = next()
        break
      case '--to-ms':
        o.toMs = next()
        break
      case '--max-markets':
        o.maxMarkets = next()
        break
      case '--offset': {
        // E-035 sharding: start index into the epoch-ordered withOutcome
        // list. NOT part of the checkpoint meta — slicing is an execution
        // detail; per-market results are slice-invariant. Unlike next(),
        // zero is valid here.
        const v = argv[++i]
        if (v === undefined) fail(`${flag} requires a value`)
        const n = Number(v)
        if (!Number.isInteger(n) || n < 0) fail(`${flag} expects an integer ≥ 0, got '${v}'`)
        o.offset = n
        break
      }
      case '--latency-ms':
        o.latencyMs = next()
        break
      case '--checkpoint': {
        const v = argv[++i]
        if (v === undefined) fail(`${flag} requires a value`)
        o.checkpoint = v
        break
      }
      case '--time-budget-s':
        o.timeBudgetS = next()
        break
      case '--json':
        o.json = true
        break
      case '--first-touch':
        o.firstTouch = true
        break
      default:
        fail(`unknown flag '${flag}'`)
    }
  }
  return o
}

const fee = (p: number) => 0.07 * p * (1 - p)
const cellOf = (minute: number, p: number) =>
  minute * N_BAND + Math.min(N_BAND - 1, Math.floor(p / 0.05))

// Per-market per-cell aggregates. Arrays indexed by cell = minute*20+band:
// n/wins/costSum = View 1 (calibration, cost at sample-time ask);
// n2/wins2/cost2Sum = View 2 (executable: arrival ask ≤ sample ask, cost at
// arrival ask). sizeSum = displayed ask size at sample time (descriptive).
type FtFill = { k: number; side: 0 | 1; win: boolean; cost: number; size: number }

type MarketAgg = {
  slug: string
  marketStartMs: number
  events: number
  samplesTaken: number
  cells: Record<string, [number, number, number, number, number, number, number]>
  ft?: Record<string, FtFill | null> // E-028b first-touch fills per frozen region
}

type PendingSample = {
  side: 0 | 1
  minute: number
  askAtT: number
  resolveTs: number // t_k + latencyMs
}

async function scanMarket(m: Market, opts: Opts, won0: boolean): Promise<MarketAgg> {
  const a0 = m.assetId0!
  const a1 = m.assetId1!
  const agg: MarketAgg = {
    slug: m.slug,
    marketStartMs: m.marketStartMs,
    events: 0,
    samplesTaken: 0,
    cells: {},
  }
  const won: [boolean, boolean] = [won0, !won0]

  const bump = (
    cell: number,
    view: 1 | 2,
    win: boolean,
    cost: number,
    size: number,
  ): void => {
    const key = String(cell)
    let row = agg.cells[key]
    if (!row) {
      row = [0, 0, 0, 0, 0, 0, 0]
      agg.cells[key] = row
    }
    if (view === 1) {
      row[0] += 1
      row[1] += win ? 1 : 0
      row[2] += cost
      row[6] += size
    } else {
      row[3] += 1
      row[4] += win ? 1 : 0
      row[5] += cost
    }
  }

  type Best = { ask: number | null; askSize: number }
  const prev: [Best, Best] = [
    { ask: null, askSize: 0 },
    { ask: null, askSize: 0 },
  ]
  let lastTs = 0
  let k0 = 0 // next base-sample index
  const pendings: PendingSample[] = []

  // E-028b first-touch state (only when --first-touch): at most one pending
  // attempt per region; retry on later samples until the first FILL.
  type FtPending = { side: 0 | 1; k: number; trigAsk: number; resolveTs: number }
  const ftFilled: Array<FtFill | null> = FT_REGIONS.map(() => null)
  const ftPending: Array<FtPending | null> = FT_REGIONS.map(() => null)

  const takeBase = (k: number) => {
    const minute = Math.min(N_MIN - 1, Math.floor((k * SAMPLE_STEP_MS) / 60_000))
    for (const side of [0, 1] as const) {
      const p = prev[side].ask
      if (p === null || p <= 0 || p > 1) continue
      agg.samplesTaken += 1
      bump(cellOf(minute, p), 1, won[side], p + fee(p), prev[side].askSize)
      pendings.push({
        side,
        minute,
        askAtT: p,
        resolveTs: m.marketStartMs + k * SAMPLE_STEP_MS + opts.latencyMs,
      })
      if (opts.firstTouch && k <= FT_MAX_K) {
        for (let ri = 0; ri < FT_REGIONS.length; ri++) {
          const [, x1, x2] = FT_REGIONS[ri]!
          if (p >= x1 && p < x2 && ftFilled[ri] === null && ftPending[ri] === null) {
            ftPending[ri] = {
              side,
              k,
              trigAsk: p,
              resolveTs: m.marketStartMs + k * SAMPLE_STEP_MS + opts.latencyMs,
            }
          }
        }
      }
    }
  }

  const resolvePendingsBefore = (ts: number) => {
    // first-touch attempts resolve BEFORE new base samples are taken (both
    // use the same pre-apply state; order only affects retry bookkeeping)
    for (let ri = 0; ri < FT_REGIONS.length; ri++) {
      const pd = ftPending[ri]
      if (pd && pd.resolveTs < ts) {
        const ask = prev[pd.side].ask
        if (ask !== null && ask <= pd.trigAsk) {
          ftFilled[ri] = {
            k: pd.k,
            side: pd.side,
            win: won[pd.side],
            cost: ask + fee(ask),
            size: prev[pd.side].askSize,
          }
        }
        ftPending[ri] = null
      }
    }
    for (let i = pendings.length - 1; i >= 0; i--) {
      const pd = pendings[i]!
      if (pd.resolveTs < ts) {
        const ask = prev[pd.side].ask
        if (ask !== null && ask <= pd.askAtT) {
          bump(cellOf(pd.minute, pd.askAtT), 2, won[pd.side], ask + fee(ask), 0)
        }
        pendings.splice(i, 1)
      }
    }
  }

  await replayTelonexDeltaParquetForMarket({
    filePath: m.dataset!,
    onSnapshot: (snapshot) => {
      agg.events += 1
      const ts = Math.max(lastTs, snapshot.timestamp)
      lastTs = ts
      // capture every base sample due strictly before this event, with the
      // pre-apply state (= book as-of all events with event ts ≤ t_k).
      // Pendings due before a sample time resolve first (latency 140ms <
      // step 15s, so an attempt from sample k settles before sample k+1).
      while (k0 < SAMPLES && m.marketStartMs + k0 * SAMPLE_STEP_MS < ts) {
        resolvePendingsBefore(m.marketStartMs + k0 * SAMPLE_STEP_MS + 1)
        takeBase(k0)
        k0 += 1
      }
      resolvePendingsBefore(ts)
      const s0 = snapshot.byAssetId[a0]
      const s1 = snapshot.byAssetId[a1]
      if (s0) prev[0] = { ask: s0.bestAsk ?? null, askSize: s0.asks[0]?.size ?? 0 }
      if (s1) prev[1] = { ask: s1.bestAsk ?? null, askSize: s1.asks[0]?.size ?? 0 }
    },
  })
  // end-of-stream flush: the final book IS the as-of state for any later t_k
  // inside the window (frozen in the design)
  while (k0 < SAMPLES) {
    resolvePendingsBefore(m.marketStartMs + k0 * SAMPLE_STEP_MS + 1)
    takeBase(k0)
    k0 += 1
  }
  resolvePendingsBefore(Infinity)
  if (opts.firstTouch) {
    agg.ft = {}
    for (let ri = 0; ri < FT_REGIONS.length; ri++) agg.ft[FT_REGIONS[ri]![0]] = ftFilled[ri]
  }
  return agg
}

// ---------- summaries ----------

type CellStat = {
  n: number
  nMkts: number
  winRate: number | null
  meanCost: number | null
  edge: number | null
  se: number | null // cluster-robust (cluster = slug)
}

// Per-market 2-D prefix sums over the 15×20 grid (6 channels: n, wins,
// costSum, n2, wins2, cost2Sum) so any rectangle pools in O(1) per market.
const PW = N_BAND + 1
const PH = N_MIN + 1
type Prefixed = { agg: MarketAgg; ps: Float64Array[] }

function prefix(agg: MarketAgg): Prefixed {
  const ps = Array.from({ length: 6 }, () => new Float64Array(PH * PW))
  for (const [key, row] of Object.entries(agg.cells)) {
    const cell = Number(key)
    const mi = Math.floor(cell / N_BAND)
    const b = cell % N_BAND
    for (let ch = 0; ch < 6; ch++) ps[ch]![(mi + 1) * PW + (b + 1)] = row[ch]!
  }
  for (let ch = 0; ch < 6; ch++) {
    const a = ps[ch]!
    for (let i = 1; i < PH; i++)
      for (let j = 1; j < PW; j++)
        a[i * PW + j]! += a[(i - 1) * PW + j]! + a[i * PW + (j - 1)]! - a[(i - 1) * PW + (j - 1)]!
  }
  return { agg, ps }
}

const rectSum = (a: Float64Array, m1: number, m2: number, b1: number, b2: number) =>
  a[(m2 + 1) * PW + (b2 + 1)]! - a[m1 * PW + (b2 + 1)]! - a[(m2 + 1) * PW + b1]! + a[m1 * PW + b1]!

// Pool a rectangle over markets; cluster-robust SE (cluster = slug).
function pool(
  markets: Prefixed[],
  m1: number,
  m2: number,
  b1: number,
  b2: number,
  view: 1 | 2,
): CellStat {
  const [ci, wi, si] = view === 1 ? [0, 1, 2] : [3, 4, 5]
  let n = 0
  let wins = 0
  let costSum = 0
  const perMkt: Array<{ n: number; edgeSum: number }> = []
  for (const mk of markets) {
    const mn = rectSum(mk.ps[ci]!, m1, m2, b1, b2)
    if (mn <= 0) continue
    const mw = rectSum(mk.ps[wi]!, m1, m2, b1, b2)
    const mc = rectSum(mk.ps[si]!, m1, m2, b1, b2)
    perMkt.push({ n: mn, edgeSum: mw - mc })
    n += mn
    wins += mw
    costSum += mc
  }
  if (n === 0) return { n: 0, nMkts: 0, winRate: null, meanCost: null, edge: null, se: null }
  const edge = (wins - costSum) / n
  let vsum = 0
  for (const pm of perMkt) vsum += (pm.edgeSum - pm.n * edge) ** 2
  return {
    n,
    nMkts: perMkt.length,
    winRate: wins / n,
    meanCost: costSum / n,
    edge,
    se: perMkt.length > 1 ? Math.sqrt(vsum) / n : null,
  }
}

const r4 = (x: number | null) => (x === null ? null : Math.round(x * 1e4) / 1e4)

function cellTable(markets: Prefixed[], view: 1 | 2) {
  const out: Record<string, unknown> = {}
  for (let mi = 0; mi < N_MIN; mi++) {
    for (let b = 0; b < N_BAND; b++) {
      const s = pool(markets, mi, mi, b, b, view)
      if (s.n === 0) continue
      out[`m${mi}_p${(b * 0.05).toFixed(2)}`] = {
        n: s.n,
        nMkts: s.nMkts,
        winRate: r4(s.winRate),
        meanCost: r4(s.meanCost),
        edge: r4(s.edge),
        se: r4(s.se),
      }
    }
  }
  return out
}

function bandCurve(markets: Prefixed[]) {
  const out: Record<string, unknown> = {}
  for (let b = 0; b < N_BAND; b++) {
    const v1 = pool(markets, 0, N_MIN - 1, b, b, 1)
    const v2 = pool(markets, 0, N_MIN - 1, b, b, 2)
    if (v1.n === 0) continue
    out[`p${(b * 0.05).toFixed(2)}`] = {
      n: v1.n,
      nMkts: v1.nMkts,
      winRate: r4(v1.winRate),
      meanCost: r4(v1.meanCost),
      edge: r4(v1.edge),
      se: r4(v1.se),
      z: v1.se ? r4(v1.edge! / v1.se) : null,
      execFillFrac: v1.n > 0 ? r4(v2.n / v1.n) : null,
      execEdge: r4(v2.edge),
      execSe: r4(v2.se),
    }
  }
  return out
}

type Region = {
  m1: number
  m2: number
  b1: number
  b2: number
  full: CellStat
  z: number
}

function regionSearch(all: Prefixed[], h1: Prefixed[], h2: Prefixed[]) {
  // Frozen design: the search space is rectangles with pooled n_markets ≥ 100
  // in EACH split half; rank those by full-sample edge/SE. (Tiny-n rectangles
  // have degenerate cluster SEs and are excluded by construction, not by z.)
  type Cand = Region & { sH1: CellStat; sH2: CellStat }
  const regions: Cand[] = []
  let evaluated = 0
  for (let m1 = 0; m1 < N_MIN; m1++)
    for (let m2 = m1; m2 < N_MIN; m2++)
      for (let b1 = 0; b1 < N_BAND; b1++)
        for (let b2 = b1; b2 < N_BAND; b2++) {
          evaluated += 1
          const sH1 = pool(h1, m1, m2, b1, b2, 1)
          if (sH1.nMkts < MIN_REGION_MARKETS) continue
          const sH2 = pool(h2, m1, m2, b1, b2, 1)
          if (sH2.nMkts < MIN_REGION_MARKETS) continue
          const s = pool(all, m1, m2, b1, b2, 1)
          if (s.n === 0 || s.se === null || s.edge === null) continue
          regions.push({ m1, m2, b1, b2, full: s, z: s.edge / s.se, sH1, sH2 })
        }
  regions.sort((a, b) => b.z - a.z)
  const positive = regions.filter((r) => {
    const passFull = r.full.edge! >= 2 * r.full.se!
    const passH1 = r.sH1.se !== null && r.sH1.edge !== null && r.sH1.edge >= 2 * r.sH1.se
    const passH2 = r.sH2.se !== null && r.sH2.edge !== null && r.sH2.edge >= 2 * r.sH2.se
    return passFull && passH1 && passH2
  })
  const fmt = (r: Cand) => {
    const exec = pool(all, r.m1, r.m2, r.b1, r.b2, 2)
    const passExec = exec.edge !== null && exec.edge > 0
    return {
      minutes: [r.m1, r.m2],
      bands: [r4(r.b1 * 0.05), r4((r.b2 + 1) * 0.05)],
      full: { n: r.full.n, nMkts: r.full.nMkts, edge: r4(r.full.edge), se: r4(r.full.se), z: r4(r.z) },
      half1: { n: r.sH1.n, nMkts: r.sH1.nMkts, edge: r4(r.sH1.edge), se: r4(r.sH1.se) },
      half2: { n: r.sH2.n, nMkts: r.sH2.nMkts, edge: r4(r.sH2.edge), se: r4(r.sH2.se) },
      exec: { n: exec.n, edge: r4(exec.edge), se: r4(exec.se) },
      POSITIVE_SIGNAL:
        r.full.edge! >= 2 * r.full.se! &&
        r.sH1.se !== null &&
        r.sH1.edge! >= 2 * r.sH1.se &&
        r.sH2.se !== null &&
        r.sH2.edge! >= 2 * r.sH2.se &&
        passExec,
    }
  }
  return {
    rectanglesEvaluated: evaluated,
    eligible: regions.length,
    positiveCount: positive.length,
    positiveRegions: positive.slice(0, 20).map(fmt),
    top: regions.slice(0, 20).map(fmt),
  }
}

// E-028b first-touch summary: one obs per FILLED market; frozen bars =
// full-sample edge ≥ 2×SE AND edge > 0 in both halves AND ≥6/9 daily > 0.
function firstTouchSummary(sorted: MarketAgg[]) {
  const out: Record<string, unknown> = {}
  const mid = Math.floor(sorted.length / 2)
  for (const [name] of FT_REGIONS) {
    const fills: Array<{ marketStartMs: number; edge: number; size: number; k: number }> = []
    for (const m of sorted) {
      const f = m.ft?.[name]
      if (f) {
        fills.push({
          marketStartMs: m.marketStartMs,
          edge: (f.win ? 1 : 0) - f.cost,
          size: f.size,
          k: f.k,
        })
      }
    }
    const n = fills.length
    if (n === 0) {
      out[name] = { fills: 0 }
      continue
    }
    const mean = fills.reduce((s, f) => s + f.edge, 0) / n
    const sd = Math.sqrt(fills.reduce((s, f) => s + (f.edge - mean) ** 2, 0) / Math.max(1, n - 1))
    const se = sd / Math.sqrt(n)
    const idxOf = (ms: number) => sorted.findIndex((m) => m.marketStartMs === ms)
    const h1 = fills.filter((f) => idxOf(f.marketStartMs) < mid)
    const h2 = fills.filter((f) => idxOf(f.marketStartMs) >= mid)
    const hMean = (a: typeof fills) =>
      a.length ? a.reduce((s, f) => s + f.edge, 0) / a.length : null
    const daily = new Map<string, { n: number; sum: number }>()
    for (const f of fills) {
      const day = new Date(f.marketStartMs).toISOString().slice(5, 10)
      const d = daily.get(day) ?? { n: 0, sum: 0 }
      d.n += 1
      d.sum += f.edge
      daily.set(day, d)
    }
    const dailyTable: Record<string, unknown> = {}
    let daysPos = 0
    for (const [day, d] of [...daily.entries()].sort()) {
      const e = d.sum / d.n
      if (e > 0) daysPos += 1
      dailyTable[day] = { n: d.n, edge: r4(e) }
    }
    const evPerMkt1sh = fills.reduce((s, f) => s + f.edge, 0) / sorted.length
    const evPerMktCap100 = fills.reduce((s, f) => s + f.edge * Math.min(f.size, 100), 0) / sorted.length
    const h1m = hMean(h1)
    const h2m = hMean(h2)
    out[name] = {
      markets: sorted.length,
      fills: n,
      fillFrac: r4(n / sorted.length),
      edge: r4(mean),
      se: r4(se),
      z: r4(mean / se),
      half1: { n: h1.length, edge: r4(h1m) },
      half2: { n: h2.length, edge: r4(h2m) },
      daysPositive: `${daysPos}/${daily.size}`,
      daily: dailyTable,
      meanFillAskSize: r4(fills.reduce((s, f) => s + f.size, 0) / n),
      meanTriggerK: r4(fills.reduce((s, f) => s + f.k, 0) / n),
      evPerMkt_1sh: r4(evPerMkt1sh),
      evPerMkt_cap100sh: r4(evPerMktCap100),
      POSITIVE_POLICY:
        mean >= 2 * se && h1m !== null && h1m > 0 && h2m !== null && h2m > 0 && daysPos >= 6,
    }
  }
  return out
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const rows = await listEligibleTelonexMarkets({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'local',
    fromMs: PROTOCOL_FLOOR_MS,
    ...(opts.toMs !== null ? { toMs: opts.toMs } : {}),
    limit: opts.latest,
    latest: true,
  })
  const usable = rows.filter(
    (m) => m.dataset && fs.existsSync(m.dataset) && m.assetId0 && m.assetId1,
  )
  const skipped = rows.length - usable.length
  // frozen: unknown-outcome markets are excluded and counted
  const withOutcome: Array<{ m: Market; won0: boolean }> = []
  let noOutcome = 0
  for (const m of usable) {
    const outcome = getMarketResolution(m)?.outcome ?? null
    if (outcome === 'UP' || outcome === 'DOWN') withOutcome.push({ m, won0: outcome === 'UP' })
    else noOutcome += 1
  }
  const target = withOutcome.slice(
    opts.offset,
    opts.maxMarkets ? opts.offset + opts.maxMarkets : undefined,
  )
  console.error(
    `[calib] universe latest=${opts.latest} rows=${rows.length} usable=${usable.length} skipped=${skipped} noOutcome=${noOutcome} scanning=${target.length} latency=${opts.latencyMs}ms`,
  )

  const ckptMeta = {
    latencyMs: opts.latencyMs,
    toMs: opts.toMs,
    latest: opts.latest,
    firstTouch: opts.firstTouch,
  }
  const cached = new Map<string, MarketAgg>()
  if (opts.checkpoint && fs.existsSync(opts.checkpoint)) {
    for (const line of fs.readFileSync(opts.checkpoint, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue // truncated tail line — market will be re-scanned
      }
      const rec = obj as { __meta?: typeof ckptMeta } & MarketAgg
      if (rec.__meta) {
        if (JSON.stringify(rec.__meta) !== JSON.stringify(ckptMeta))
          fail(
            `checkpoint ${opts.checkpoint} was written with different params ` +
              `(${JSON.stringify(rec.__meta)} vs ${JSON.stringify(ckptMeta)}) — delete it or match flags`,
          )
        continue
      }
      if (rec.slug) cached.set(rec.slug, rec)
    }
    console.error(`[calib] checkpoint: ${cached.size} markets already scanned`)
  } else if (opts.checkpoint) {
    fs.appendFileSync(opts.checkpoint, JSON.stringify({ __meta: ckptMeta }) + '\n')
  }

  const t0 = Date.now()
  const aggs: MarketAgg[] = []
  let scannedNow = 0
  let timedOut = false
  for (let i = 0; i < target.length; i++) {
    const { m, won0 } = target[i]!
    const hit = cached.get(m.slug)
    if (hit) {
      aggs.push(hit)
      continue
    }
    if (opts.timeBudgetS !== null && (Date.now() - t0) / 1000 > opts.timeBudgetS) {
      timedOut = true
      break
    }
    const agg = await scanMarket(m, opts, won0)
    aggs.push(agg)
    scannedNow += 1
    if (opts.checkpoint) fs.appendFileSync(opts.checkpoint, JSON.stringify(agg) + '\n')
    if (scannedNow % 50 === 0 || i + 1 === target.length) {
      const dt = (Date.now() - t0) / 1000
      console.error(
        `[calib] ${aggs.length}/${target.length} markets (${scannedNow} this pass), ${dt.toFixed(0)}s (${(scannedNow / dt).toFixed(1)} mkts/s)`,
      )
    }
  }

  if (timedOut) {
    console.error(
      `[calib] time budget ${opts.timeBudgetS}s hit: ${aggs.length}/${target.length} done — rerun with the same --checkpoint to continue`,
    )
    console.log(JSON.stringify({ partial: true, done: aggs.length, total: target.length }))
    await closeDb()
    return
  }

  // split halves by market_start_ms (frozen: first 400 vs last 400 of the pin)
  const sorted = [...aggs].sort((a, b) => a.marketStartMs - b.marketStartMs)
  const prefixed = sorted.map(prefix)
  const mid = Math.floor(prefixed.length / 2)
  const h1 = prefixed.slice(0, mid)
  const h2 = prefixed.slice(mid)

  const result = {
    scannedAt: new Date().toISOString(),
    universe: {
      latest: opts.latest,
      scanned: aggs.length,
      skipped,
      noOutcome,
      firstSlug: sorted[0]?.slug ?? null,
      lastSlug: sorted[sorted.length - 1]?.slug ?? null,
    },
    params: { latencyMs: opts.latencyMs, toMs: opts.toMs, sampleStepMs: SAMPLE_STEP_MS },
    totalEvents: aggs.reduce((s, m) => s + m.events, 0),
    totalSamples: aggs.reduce((s, m) => s + m.samplesTaken, 0),
    view3_bandCurve: bandCurve(prefixed),
    view1_cells: cellTable(prefixed, 1),
    view2_cells: cellTable(prefixed, 2),
    halves: {
      half1: { n: h1.length, cells: cellTable(h1, 1) },
      half2: { n: h2.length, cells: cellTable(h2, 1) },
    },
    view5_regionSearch: regionSearch(prefixed, h1, h2),
    ...(opts.firstTouch ? { firstTouch: firstTouchSummary(sorted) } : {}),
  }
  console.log(JSON.stringify(result, null, 2))
  await closeDb()
}

main().catch((err) => {
  console.error('[calib] FATAL', err)
  process.exit(1)
})
