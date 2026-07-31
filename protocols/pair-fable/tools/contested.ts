/**
 * contested.ts — per-start "contested vs decided" analysis for pair runs.
 * Read-only (DB + local Binance aggTrades day files). Phase 0 of pair-v3:
 * pre-registered hypothesis + verdict criteria in memory/experiments/pair-v3.md.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/contested.ts --run 872 [--json]
 *
 * For every 'S' fill in the run (intent_meta), computes at fill time:
 *   distBps    = |spot(asof ts) − priceToBeat| / priceToBeat * 1e4
 *   drift60Bps = |spot(asof ts) − spot(asof ts−60s)| / priceToBeat * 1e4
 * and labels it doomed = it is the LAST 'S' fill of a market that ended
 * imbalanced (residue median = p90 = 1 increment ⇒ that start IS the doom).
 * Spot comes from the same aggTrades day files the backtest binance feed
 * replays (as-of semantics; see src/backtest/feeds/binanceAggTradesSource.ts).
 * NOTE the one-sided bias recorded in pair-v3.md: features at FILL time
 * overstate what a QUOTE-time gate can see — failing here kills a fortiori.
 */
import '../../../src/config/env.js'
import { openDb, toNum, fetchRunsByIds, type RunIdentity } from './lib/runQueries.js'
import { getInMemoryDuckDb, sqlQuote } from '../../../src/utils/duckdb.js'
import { aggTradesDayPath, utcDatesCovering } from '../../../src/binance/paths.js'
import { fileExists } from '../../../src/utils/fs.js'
import type mysql from 'mysql2/promise'

function fail(msg: string): never {
  console.error(`[contested] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = { runIds: number[]; json: boolean; lastOnly: boolean }

function parseArgs(argv: string[]): Opts {
  const o: Opts = { runIds: [], json: false, lastOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    switch (flag) {
      case '--run': {
        const v = argv[++i]
        if (!v) fail('--run requires a value')
        o.runIds = v.split(',').map((s) => {
          const n = Number(s.trim())
          if (!Number.isInteger(n) || n <= 0) fail(`--run expects positive ids, got '${s}'`)
          return n
        })
        break
      }
      case '--json':
        o.json = true
        break
      // Only the LAST start of a market can end up as the residue increment;
      // this restricts the per-start pool to last starts (baseline doom rate
      // ≈ dooms/played) to remove the structural dilution by non-last starts.
      case '--last-only':
        o.lastOnly = true
        break
      default:
        fail(`unknown flag '${flag}'`)
    }
  }
  if (o.runIds.length === 0) fail('--run is required')
  return o
}

type MetaEntry = { side?: string; s?: number; ts?: number; m?: string; p?: number }

type MarketRow = {
  slug: string
  marketStartMs: number
  finalOutcome: string
  pnl: number
  cost: number
  upShares: number
  downShares: number
  avgUp: number | null
  avgDown: number | null
  priceToBeat: number | null
  meta: MetaEntry[]
}

async function fetchMarkets(conn: mysql.Connection, runId: number): Promise<MarketRow[]> {
  const [rows] = (await conn.query(
    `SELECT brm.slug, brm.market_start_ms, brm.final_outcome, brm.pnl, brm.cost,
            brm.up_shares, brm.down_shares, brm.avg_entry_price_up, brm.avg_entry_price_down,
            brm.intent_meta, tm.price_to_beat
       FROM backtest_run_markets brm
       LEFT JOIN telonex_markets tm ON tm.slug = brm.slug
      WHERE brm.run_id = ? ORDER BY brm.market_start_ms`,
    [runId],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map((r) => ({
    slug: String(r.slug),
    marketStartMs: Number(r.market_start_ms),
    finalOutcome: String(r.final_outcome),
    pnl: toNum(r.pnl) ?? 0,
    cost: toNum(r.cost) ?? 0,
    upShares: toNum(r.up_shares) ?? 0,
    downShares: toNum(r.down_shares) ?? 0,
    avgUp: toNum(r.avg_entry_price_up),
    avgDown: toNum(r.avg_entry_price_down),
    priceToBeat: toNum(r.price_to_beat),
    meta: (typeof r.intent_meta === 'string'
      ? JSON.parse(r.intent_meta)
      : (r.intent_meta ?? [])) as MetaEntry[],
  }))
}

/** Spot series covering a contiguous ms range, sorted by exchange order. */
type Series = { ts: Float64Array; px: Float64Array }

const PRE_MS = 180_000 // lookback before window start (drift60 needs ts−60s; margin for quiet seconds)
const POST_MS = 990_000 // 16.5 min past start covers the 15m window + tail

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

/** Last price at or before t; NaN when no trade ≤ t in the series. */
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

type StartRec = {
  slug: string
  tsMs: number
  minute: number
  distBps: number
  drift60Bps: number
  doomed: boolean
}

type MarketRec = {
  slug: string
  doomed: boolean
  dist60Bps: number
  dist120Bps: number
  pairsPnl: number
  residuePnl: number
  pairedIncrements: number
}

type Bucket = { label: string; n: number; dooms: number; rate: number; evPerStart: number }

function bucketize(
  recs: StartRec[],
  key: (r: StartRec) => number,
  edges: number[],
  g: number,
  L: number,
): Bucket[] {
  const out: Bucket[] = []
  for (let i = 0; i < edges.length; i++) {
    const lo = i === 0 ? 0 : edges[i - 1]!
    const hi = edges[i]!
    const inB = recs.filter((r) => key(r) >= lo && (i === edges.length - 1 || key(r) < hi))
    const label = i === edges.length - 1 ? `${lo}+` : `[${lo},${hi})`
    const dooms = inB.filter((r) => r.doomed).length
    const rate = inB.length > 0 ? dooms / inB.length : 0
    out.push({ label, n: inB.length, dooms, rate, evPerStart: (1 - rate) * g - rate * L })
  }
  return out
}

function pairForSlug(slug: string): string {
  if (slug.startsWith('btc-')) return 'BTCUSDT'
  if (slug.startsWith('eth-')) return 'ETHUSDT'
  if (slug.startsWith('sol-')) return 'SOLUSDT'
  if (slug.startsWith('xrp-')) return 'XRPUSDT'
  fail(`cannot derive Binance pair from slug '${slug}'`)
}

async function analyzeRun(
  identity: RunIdentity,
  markets: MarketRow[],
  lastOnly: boolean,
): Promise<void> {
  const incrementSize = Number(identity.params.incrementSize ?? 10)

  // --- labels + run economics (g, L, break-even) from the run itself ---
  let pairsPnlTotal = 0
  let pairedIncrements = 0
  let residuePnlTotal = 0
  let residueMarkets = 0
  let skippedNoPtb = 0
  let startsNoTs = 0
  const played = markets.filter((m) => m.cost > 0 || m.meta.length > 0)
  const marketRecs: MarketRec[] = []
  const startRecs: StartRec[] = []

  // group markets by UTC date of start to load each day's series once
  const byDate = new Map<string, MarketRow[]>()
  for (const m of played) {
    const d = new Date(m.marketStartMs).toISOString().slice(0, 10)
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d)!.push(m)
  }

  for (const [, group] of [...byDate.entries()].sort()) {
    const pair = pairForSlug(group[0]!.slug)
    const fromMs = Math.min(...group.map((m) => m.marketStartMs)) - PRE_MS
    const toMs = Math.max(...group.map((m) => m.marketStartMs)) + POST_MS
    const series = await loadSeries(pair, fromMs, toMs)

    for (const m of group) {
      const paired = Math.min(m.upShares, m.downShares)
      const residue = Math.abs(m.upShares - m.downShares)
      const avgUp = m.avgUp ?? 0
      const avgDown = m.avgDown ?? 0
      const mPairsPnl = paired > 0 ? paired * (1 - avgUp - avgDown) : 0
      let mResiduePnl = 0
      if (residue > 0) {
        const residueSide = m.upShares > m.downShares ? 'UP' : 'DOWN'
        const wins = residueSide === m.finalOutcome
        const avgE = residueSide === 'UP' ? avgUp : avgDown
        mResiduePnl = wins ? residue * (1 - avgE) : -residue * avgE
        residueMarkets += 1
      }
      pairsPnlTotal += mPairsPnl
      residuePnlTotal += mResiduePnl
      pairedIncrements += paired / incrementSize

      if (m.priceToBeat === null || m.priceToBeat <= 0) {
        skippedNoPtb += 1
        continue
      }
      const ptb = m.priceToBeat

      // market-level early-window features
      const s60 = asof(series, m.marketStartMs + 60_000)
      const s120 = asof(series, m.marketStartMs + 120_000)
      marketRecs.push({
        slug: m.slug,
        doomed: residue > 0,
        dist60Bps: Number.isNaN(s60) ? NaN : (Math.abs(s60 - ptb) / ptb) * 1e4,
        dist120Bps: Number.isNaN(s120) ? NaN : (Math.abs(s120 - ptb) / ptb) * 1e4,
        pairsPnl: mPairsPnl,
        residuePnl: mResiduePnl,
        pairedIncrements: paired / incrementSize,
      })

      // per-start records
      let lastStartTs: number | null = null
      for (const e of m.meta) if (e.m === 'S' && e.ts !== undefined) lastStartTs = e.ts
      for (const e of m.meta) {
        if (e.m !== 'S') continue
        if (lastOnly && e.ts !== lastStartTs) continue
        if (e.ts === undefined) {
          startsNoTs += 1
          continue
        }
        const spot = asof(series, e.ts)
        const spotPrev = asof(series, e.ts - 60_000)
        if (Number.isNaN(spot) || Number.isNaN(spotPrev)) {
          startsNoTs += 1
          continue
        }
        const minute = Math.max(0, Math.min(15, Math.floor((e.ts - m.marketStartMs) / 60_000)))
        startRecs.push({
          slug: m.slug,
          tsMs: e.ts,
          minute,
          distBps: (Math.abs(spot - ptb) / ptb) * 1e4,
          drift60Bps: (Math.abs(spot - spotPrev) / ptb) * 1e4,
          doomed: residue > 0 && e.ts === lastStartTs,
        })
      }
    }
  }

  const g = pairedIncrements > 0 ? pairsPnlTotal / pairedIncrements : 0
  const L = residueMarkets > 0 ? -residuePnlTotal / residueMarkets : 0
  const breakEven = g + L > 0 ? L > 0 ? g / (g + L) : 1 : 0
  const dooms = startRecs.filter((r) => r.doomed).length

  const f = (n: number, d = 2): string => n.toFixed(d)
  console.log(`\n=== run ${identity.runId} — ${identity.strategy} ${JSON.stringify(identity.params)} ===`)
  console.log(
    `played ${played.length} (noPtb skipped ${skippedNoPtb})  starts ${startRecs.length} (noTs/noSpot ${startsNoTs})  dooms ${dooms} (${f((100 * dooms) / Math.max(1, startRecs.length), 1)}%)`,
  )
  console.log(
    `economics: g=+${f(g, 3)}/paired increment (${f(pairedIncrements, 0)} incs, pairsPnl ${f(pairsPnlTotal)})  ` +
      `L=${f(L, 3)}/doom (${residueMarkets} residue mkts, residuePnl ${f(residuePnlTotal)})  ` +
      `break-even doom rate ${f(100 * breakEven, 1)}%`,
  )

  const distEdges = [1, 2, 4, 8, 16, 32, 64, Infinity]
  const printBuckets = (title: string, bs: Bucket[]): void => {
    console.log(`\n${title}`)
    console.log('bucket(bps)   n     dooms  rate    ev/start')
    for (const b of bs)
      console.log(
        `${b.label.padEnd(12)} ${String(b.n).padStart(5)} ${String(b.dooms).padStart(6)}  ${f(100 * b.rate, 1).padStart(5)}%  ${f(b.evPerStart, 3).padStart(8)}`,
      )
  }

  printBuckets('per-start doom rate by distBps (|spot−ptb| at fill):', bucketize(startRecs, (r) => r.distBps, distEdges, g, L))
  printBuckets('per-start doom rate by drift60Bps (|spot−spot(−60s)| at fill):', bucketize(startRecs, (r) => r.drift60Bps, distEdges, g, L))

  const min0 = startRecs.filter((r) => r.minute === 0)
  const minLater = startRecs.filter((r) => r.minute > 0)
  printBuckets(
    `minute-0 stratum (${min0.length} starts, ${min0.filter((r) => r.doomed).length} dooms) by distBps:`,
    bucketize(min0, (r) => r.distBps, distEdges, g, L),
  )
  printBuckets(
    `minute≥1 stratum (${minLater.length} starts, ${minLater.filter((r) => r.doomed).length} dooms) by distBps:`,
    bucketize(minLater, (r) => r.distBps, distEdges, g, L),
  )

  // threshold sweep: keep starts with distBps ≤ T (the v3 gate candidate)
  console.log('\nthreshold sweep — keep starts with distBps ≤ T:')
  console.log('T(bps)  kept     kept%  doomsKept  rate    ev/start(kept)')
  for (const T of [2, 4, 6, 8, 12, 16, 24, 32, 48, 64]) {
    const kept = startRecs.filter((r) => r.distBps <= T)
    const kd = kept.filter((r) => r.doomed).length
    const rate = kept.length > 0 ? kd / kept.length : 0
    console.log(
      `${String(T).padStart(5)}  ${String(kept.length).padStart(5)}  ${f((100 * kept.length) / Math.max(1, startRecs.length), 1).padStart(5)}%  ${String(kd).padStart(8)}  ${f(100 * rate, 1).padStart(5)}%  ${f((1 - rate) * g - rate * L, 3).padStart(8)}`,
    )
  }
  console.log('\nthreshold sweep — keep starts with drift60Bps ≤ D:')
  console.log('D(bps)  kept     kept%  doomsKept  rate    ev/start(kept)')
  for (const D of [2, 4, 6, 8, 12, 16, 24, 32, 48, 64]) {
    const kept = startRecs.filter((r) => r.drift60Bps <= D)
    const kd = kept.filter((r) => r.doomed).length
    const rate = kept.length > 0 ? kd / kept.length : 0
    console.log(
      `${String(D).padStart(5)}  ${String(kept.length).padStart(5)}  ${f((100 * kept.length) / Math.max(1, startRecs.length), 1).padStart(5)}%  ${String(kd).padStart(8)}  ${f(100 * rate, 1).padStart(5)}%  ${f((1 - rate) * g - rate * L, 3).padStart(8)}`,
    )
  }

  // joint 2×2 at 8bps
  const q = (a: boolean, b: boolean): StartRec[] =>
    startRecs.filter((r) => (r.distBps <= 8) === a && (r.drift60Bps <= 8) === b)
  console.log('\njoint (dist≤8 × drift60≤8): quadrant n / doomRate')
  for (const [a, b, name] of [
    [true, true, 'near+calm '],
    [true, false, 'near+fast '],
    [false, true, 'far+calm  '],
    [false, false, 'far+fast  '],
  ] as Array<[boolean, boolean, string]>) {
    const s = q(a, b)
    const d = s.filter((r) => r.doomed).length
    console.log(`  ${name} n=${String(s.length).padStart(5)}  doomRate=${f((100 * d) / Math.max(1, s.length), 1)}%`)
  }

  // market-level: dist@60s quartiles vs market doom + kept-region pair margin
  const withD60 = marketRecs.filter((r) => !Number.isNaN(r.dist60Bps)).sort((x, y) => x.dist60Bps - y.dist60Bps)
  console.log('\nmarket-level dist@60s quartiles (played mkts): doomRate / pairMargin per inc:')
  for (let qi = 0; qi < 4; qi++) {
    const seg = withD60.slice(
      Math.floor((qi * withD60.length) / 4),
      Math.floor(((qi + 1) * withD60.length) / 4),
    )
    const dr = seg.filter((r) => r.doomed).length / Math.max(1, seg.length)
    const incs = seg.reduce((s, r) => s + r.pairedIncrements, 0)
    const marg = incs > 0 ? seg.reduce((s, r) => s + r.pairsPnl, 0) / incs : 0
    const lo = seg[0]?.dist60Bps ?? NaN
    const hi = seg[seg.length - 1]?.dist60Bps ?? NaN
    console.log(
      `  Q${qi + 1} dist60 ${f(lo, 1)}–${f(hi, 1)}bps  n=${seg.length}  doomRate=${f(100 * dr, 1)}%  pairMargin=+${f(marg, 3)}/inc`,
    )
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const conn = await openDb()
  try {
    const runs = await fetchRunsByIds(conn, opts.runIds)
    if (runs.length !== opts.runIds.length) {
      const found = new Set(runs.map((r) => r.runId))
      fail(`runs not found: ${opts.runIds.filter((id) => !found.has(id)).join(', ')}`)
    }
    for (const run of runs) {
      const rows = await fetchMarkets(conn, run.runId)
      await analyzeRun(run, rows, opts.lastOnly)
    }
  } finally {
    await conn.end()
  }
}

await main()
