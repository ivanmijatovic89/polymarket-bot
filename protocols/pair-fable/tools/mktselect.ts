/**
 * mktselect.ts — liquidity-structure MARKET selection scan (ruling axis 6).
 * v1: E-022 (pair-v11, pre-registered at commit 0187972, session 10).
 * v2: E-034 (pair-v15 §13, pre-registered at commit d4da4e1, session 20):
 * adds F6 upRange + F7 upNetDriftAbs (+ exploratory f7Signed, excluded from
 * analysis), drops `run` from the checkpoint meta (features are
 * run-independent — one scan joins to any reference run), and reports
 * selected-vs-complement separation (Welch SE) per rule. Read-only.
 *
 * Per pinned market, replays the delta-typed parquet through the engine's own
 * replayTelonexDeltaParquetForMarket and computes the FROZEN feature set over
 * the market's first 3 minutes (window = [slugEpoch, slugEpoch+3min); replay
 * aborts at window end via shouldStop — early-window only, no lookahead):
 *   F1 mean two-sided spread   — time-weighted mean of ((ask0−bid0)+(ask1−bid1))/2
 *   F2 mean top-of-book depth  — time-weighted mean of the 4 best-level sizes summed
 *   F3 book-sum level          — time-weighted mean of bestAsk_up + bestAsk_down
 *   F4 oscillation count       — direction changes of up-side bestBid, in-window moves only
 *   F5 quote intensity         — in-window events / 180 s
 * Time-weighting: each event integrates the PRE-event state over the elapsed
 * segment clipped to the window; a feature's mean divides by its own
 * defined-time (state components non-null). "Mean" was not weighting-frozen in
 * the pre-registration; time-weighted is chosen here, before any data is seen.
 *
 * Analysis (runs when every target market is scanned): joins features to the
 * reference run's backtest_run_markets (pnl; doom = |up−down| shares > 1e-6),
 * splits markets by epoch-sorted 0-based index (ODD = exploration, EVEN =
 * confirmation, frozen), buckets each feature into exploration-half quintiles
 * (edges FROZEN from exploration, applied unchanged to confirmation), and
 * searches contiguous quintile ranges for selection rules meeting the frozen
 * economics bar: subset ev ≥ 0 on BOTH halves at ≥ 25% retention per half.
 * ev is total-denominator (sum pnl / subset size, flats included). Per-day ev
 * reported for the joined universe and for every exploration-passing rule
 * (confounder (a) of the pre-registration).
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/mktselect.ts [--run 872] [--latest 800]
 *     [--to-ms 1784762100000] [--max-markets N] [--json]
 *     [--checkpoint <file.jsonl>] [--time-budget-s N]
 *
 * --checkpoint / --time-budget-s follow bookscan.ts: one JSONL line per
 * scanned market, params header enforced, {"partial":true,...} + exit 0 when
 * the budget is hit — rerun the same command to continue.
 */
import '../../../src/config/env.js'
import fs from 'node:fs'
import { listEligibleTelonexMarkets, type Market } from '../../../src/db/telonexMarkets.js'
import { closeDb } from '../../../src/db/index.js'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'
import { openDb, fetchMarkets, fetchRunsByIds, type MarketRow } from './lib/runQueries.js'

const PROTOCOL_FLOOR_MS = 1775088000000 // 2026-04-02, RULES universe floor
const PINNED_TO_MS = 1784762100000 // E-022 pinned-800 upper bound (= runs 872/873 screen window)
const WINDOW_MS = 3 * 60 * 1000 // frozen: first 3 minutes
const RETENTION_BAR = 0.25 // frozen economics bar
const QUINTILES = 5

function fail(msg: string): never {
  console.error(`[mktselect] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = {
  run: number
  latest: number
  toMs: number
  maxMarkets: number | null
  json: boolean
  checkpoint: string | null
  timeBudgetS: number | null
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    run: 872,
    latest: 800,
    toMs: PINNED_TO_MS,
    maxMarkets: null,
    json: false,
    checkpoint: null,
    timeBudgetS: null,
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
      case '--run':
        o.run = next()
        break
      case '--latest':
        o.latest = next()
        break
      case '--to-ms':
        o.toMs = next()
        break
      case '--max-markets':
        o.maxMarkets = next()
        break
      case '--json':
        o.json = true
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
      default:
        fail(`unknown flag '${flag}'`)
    }
  }
  return o
}

type Features = {
  slug: string
  epochMs: number
  events: number // in-window events
  f1SpreadMean: number | null
  f2DepthMean: number | null
  f3BookSumMean: number | null
  f4Oscillations: number
  f5EventsPerSec: number
  f6UpRange: number | null
  f7UpNetDriftAbs: number | null
  f7Signed: number | null // exploratory only — never analyzed in E-034
  f1DefinedMs: number
  f3DefinedMs: number
  coveredMs: number // last integrated point − window start (recording coverage)
}

function slugEpochMs(slug: string): number {
  const epoch = Number(slug.split('-').pop())
  if (!Number.isFinite(epoch) || epoch <= 0) fail(`cannot parse epoch from slug '${slug}'`)
  return epoch * 1000
}

async function scanMarket(m: Market): Promise<Features> {
  const a0 = m.assetId0!
  const a1 = m.assetId1!
  const w0 = slugEpochMs(m.slug)
  const w1 = w0 + WINDOW_MS

  type Best = { bid: number | null; ask: number | null; bidSize: number; askSize: number }
  const prev: [Best, Best] = [
    { bid: null, ask: null, bidSize: 0, askSize: 0 },
    { bid: null, ask: null, bidSize: 0, askSize: 0 },
  ]
  let lastTs = 0
  let done = false
  let events = 0
  let f1Int = 0 // ∫ two-sided spread dt
  let f1Ms = 0
  let f2Int = 0 // ∫ depth dt (same defined condition as f1)
  let f3Int = 0 // ∫ ask-sum dt
  let f3Ms = 0
  let osc = 0
  let lastDir = 0
  let coveredTo = w0
  // F6/F7: in-window up-side bestBid series (post-event values, non-null)
  let bidFirst: number | null = null
  let bidLast: number | null = null
  let bidMin = Infinity
  let bidMax = -Infinity

  await replayTelonexDeltaParquetForMarket({
    filePath: m.dataset!,
    shouldStop: () => done,
    onSnapshot: (snapshot) => {
      const ts = Math.max(lastTs, snapshot.timestamp)
      // integrate PRE-event state over [lastTs, ts] ∩ [w0, w1]
      const t0 = Math.max(lastTs, w0)
      const t1 = Math.min(ts, w1)
      if (t1 > t0) {
        const dt = t1 - t0
        coveredTo = t1
        const [p0, p1] = prev
        if (p0.bid !== null && p0.ask !== null && p1.bid !== null && p1.ask !== null) {
          f1Int += (((p0.ask - p0.bid) + (p1.ask - p1.bid)) / 2) * dt
          f1Ms += dt
          f2Int += (p0.bidSize + p0.askSize + p1.bidSize + p1.askSize) * dt
        }
        if (p0.ask !== null && p1.ask !== null) {
          f3Int += (p0.ask + p1.ask) * dt
          f3Ms += dt
        }
      }
      lastTs = ts
      if (ts >= w1) {
        done = true
        return
      }

      const s0 = snapshot.byAssetId[a0]
      const s1 = snapshot.byAssetId[a1]
      const cur: [Best, Best] = [
        {
          bid: s0?.bestBid ?? null,
          ask: s0?.bestAsk ?? null,
          bidSize: s0?.bids[0]?.size ?? 0,
          askSize: s0?.asks[0]?.size ?? 0,
        },
        {
          bid: s1?.bestBid ?? null,
          ask: s1?.bestAsk ?? null,
          bidSize: s1?.bids[0]?.size ?? 0,
          askSize: s1?.asks[0]?.size ?? 0,
        },
      ]

      if (ts >= w0) {
        events += 1
        // F4: direction changes of up-side (asset0) bestBid, in-window moves only
        const pb = prev[0].bid
        const cb = cur[0].bid
        if (pb !== null && cb !== null && cb !== pb) {
          const dir = cb > pb ? 1 : -1
          if (lastDir !== 0 && dir !== lastDir) osc += 1
          lastDir = dir
        }
        // F6/F7 series
        if (cb !== null) {
          if (bidFirst === null) bidFirst = cb
          bidLast = cb
          if (cb < bidMin) bidMin = cb
          if (cb > bidMax) bidMax = cb
        }
      }

      prev[0] = cur[0]
      prev[1] = cur[1]
    },
  })

  return {
    slug: m.slug,
    epochMs: w0,
    events,
    f1SpreadMean: f1Ms > 0 ? f1Int / f1Ms : null,
    f2DepthMean: f1Ms > 0 ? f2Int / f1Ms : null,
    f3BookSumMean: f3Ms > 0 ? f3Int / f3Ms : null,
    f4Oscillations: osc,
    f5EventsPerSec: events / (WINDOW_MS / 1000),
    f6UpRange: bidFirst === null ? null : bidMax - bidMin,
    f7UpNetDriftAbs: bidFirst === null || bidLast === null ? null : Math.abs(bidLast - bidFirst),
    f7Signed: bidFirst === null || bidLast === null ? null : bidLast - bidFirst,
    f1DefinedMs: Math.round(f1Ms),
    f3DefinedMs: Math.round(f3Ms),
    coveredMs: Math.round(coveredTo - w0),
  }
}

// ---------- analysis ----------

type Joined = Features & { pnl: number; doom: boolean; played: boolean; day: string }

const FEATURE_KEYS = [
  'f1SpreadMean',
  'f2DepthMean',
  'f3BookSumMean',
  'f4Oscillations',
  'f5EventsPerSec',
  'f6UpRange',
  'f7UpNetDriftAbs',
  // f7Signed deliberately excluded (E-034 §13.1: exploratory only)
] as const
type FeatureKey = (typeof FEATURE_KEYS)[number]

const r4 = (x: number | null) => (x === null ? null : Math.round(x * 1e4) / 1e4)
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / (v.length || 1)
const se = (v: number[]) => {
  if (v.length < 2) return null
  const m = mean(v)
  const varSum = v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1)
  return Math.sqrt(varSum / v.length)
}

function quintileEdges(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const edges: number[] = []
  for (let q = 1; q < QUINTILES; q++) {
    edges.push(sorted[Math.min(sorted.length - 1, Math.floor((q / QUINTILES) * sorted.length))]!)
  }
  return edges
}

function bucketOf(v: number, edges: number[]): number {
  for (let b = 0; b < edges.length; b++) if (v < edges[b]!) return b
  return edges.length
}

function bucketStats(markets: Joined[], key: FeatureKey, edges: number[]) {
  const buckets: Joined[][] = Array.from({ length: QUINTILES }, () => [])
  for (const m of markets) {
    const v = m[key]
    if (v === null) continue
    buckets[bucketOf(v, edges)]!.push(m)
  }
  return buckets.map((b) => {
    const pnls = b.map((m) => m.pnl)
    const playedN = b.filter((m) => m.played).length
    return {
      n: b.length,
      ev: r4(b.length ? mean(pnls) : null),
      se: r4(b.length >= 2 ? se(pnls) : null),
      doomRateOfPlayed: r4(playedN ? b.filter((m) => m.doom).length / playedN : null),
      playedN,
    }
  })
}

function trendLabel(evs: (number | null)[]): string {
  const xs = evs.filter((v): v is number => v !== null)
  if (xs.length < QUINTILES) return 'undefined-buckets'
  const deltas = xs.slice(1).map((v, i) => Math.sign(v - xs[i]!))
  if (deltas.every((d) => d >= 0)) return 'monotone-up'
  if (deltas.every((d) => d <= 0)) return 'monotone-down'
  const firstDown = deltas.findIndex((d) => d < 0)
  const firstUp = deltas.findIndex((d) => d > 0)
  if (firstDown >= 0 && deltas.slice(firstDown).every((d) => d <= 0)) return 'single-peak'
  if (firstUp >= 0 && deltas.slice(firstUp).every((d) => d >= 0)) return 'single-trough'
  return 'non-monotone'
}

function byDayEv(markets: Joined[]) {
  const byDay = new Map<string, { n: number; pnl: number }>()
  for (const m of markets) {
    const d = byDay.get(m.day) ?? { n: 0, pnl: 0 }
    d.n += 1
    d.pnl += m.pnl
    byDay.set(m.day, d)
  }
  return Object.fromEntries(
    [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => [day, { markets: d.n, evPerMarket: r4(d.pnl / d.n) }]),
  )
}

function subsetStats(markets: Joined[], halfN: number) {
  const pnls = markets.map((m) => m.pnl)
  return {
    n: markets.length,
    retention: r4(markets.length / (halfN || 1)),
    ev: r4(markets.length ? mean(pnls) : null),
    se: r4(markets.length >= 2 ? se(pnls) : null),
  }
}

function analyze(features: Features[], runRows: MarketRow[]) {
  const bySlug = new Map(runRows.map((r) => [r.slug, r]))
  const joined: Joined[] = []
  let unjoined = 0
  for (const f of features.slice().sort((a, b) => a.epochMs - b.epochMs)) {
    const r = bySlug.get(f.slug)
    if (!r) {
      unjoined += 1
      continue
    }
    joined.push({
      ...f,
      pnl: r.pnl,
      doom: Math.abs(r.upShares - r.downShares) > 1e-6,
      played: r.tradeCount > 0,
      day: new Date(f.epochMs).toISOString().slice(0, 10),
    })
  }
  // frozen split: 0-based index over epoch-sorted joined markets; ODD = exploration
  const explore = joined.filter((_, i) => i % 2 === 1)
  const confirm = joined.filter((_, i) => i % 2 === 0)

  const perFeature: Record<string, unknown> = {}
  for (const key of FEATURE_KEYS) {
    const exploreVals = explore
      .map((m) => m[key])
      .filter((v): v is number => v !== null)
    const edges = quintileEdges(exploreVals)
    const eBuckets = bucketStats(explore, key, edges)
    const cBuckets = bucketStats(confirm, key, edges)
    const eTrend = trendLabel(eBuckets.map((b) => b.ev))
    const cTrend = trendLabel(cBuckets.map((b) => b.ev))

    // rule search: contiguous quintile ranges. A rule is reported when the
    // exploration half passes EITHER frozen filter (E-034 §13.1):
    //   B1 economics — subset ev ≥ 0 at ≥ 25% retention
    //   B2 separation — (ev_in − ev_out) ≥ 2·sepSE (Welch) at ≥ 25% retention
    // Each reported rule is then evaluated UNCHANGED on confirmation.
    const rules: unknown[] = []
    for (let lo = 0; lo < QUINTILES; lo++) {
      for (let hi = lo; hi < QUINTILES; hi++) {
        if (lo === 0 && hi === QUINTILES - 1) continue // select-all is not a rule
        const inRange = (m: Joined) => {
          const v = m[key]
          if (v === null) return false
          const b = bucketOf(v, edges)
          return b >= lo && b <= hi
        }
        const sep = (ms: Joined[]) => {
          const inn = ms.filter(inRange)
          const out = ms.filter((m) => m[key] !== null && !inRange(m))
          const inSub = subsetStats(inn, ms.length)
          const outSub = subsetStats(out, ms.length)
          const seIn = inn.length >= 2 ? se(inn.map((m) => m.pnl)) : null
          const seOut = out.length >= 2 ? se(out.map((m) => m.pnl)) : null
          const sepSE =
            seIn !== null && seOut !== null ? Math.sqrt(seIn * seIn + seOut * seOut) : null
          const sepDiff =
            inSub.ev !== null && outSub.ev !== null ? r4(inSub.ev - outSub.ev) : null
          return { inSub, outSub, sepDiff, sepSE: r4(sepSE), picked: inn }
        }
        const e = sep(explore)
        const eB1 =
          e.inSub.ev !== null && e.inSub.ev >= 0 && (e.inSub.retention ?? 0) >= RETENTION_BAR
        const eB2 =
          e.sepDiff !== null &&
          e.sepSE !== null &&
          Math.abs(e.sepDiff) >= 2 * e.sepSE &&
          (e.inSub.retention ?? 0) >= RETENTION_BAR
        if (!eB1 && !eB2) continue
        const c = sep(confirm)
        const cB1 =
          c.inSub.ev !== null && c.inSub.ev >= 0 && (c.inSub.retention ?? 0) >= RETENTION_BAR
        const cB2 =
          c.sepDiff !== null &&
          c.sepSE !== null &&
          e.sepDiff !== null &&
          Math.sign(c.sepDiff) === Math.sign(e.sepDiff) &&
          Math.abs(c.sepDiff) >= 2 * c.sepSE &&
          (c.inSub.retention ?? 0) >= RETENTION_BAR
        rules.push({
          quintiles: `Q${lo + 1}..Q${hi + 1}`,
          exploration: { ...e.inSub, evOut: e.outSub.ev, sepDiff: e.sepDiff, sepSE: e.sepSE },
          confirmation: { ...c.inSub, evOut: c.outSub.ev, sepDiff: c.sepDiff, sepSE: c.sepSE },
          B1_exploration: eB1,
          B1_PASS: eB1 && cB1,
          B2_exploration: eB2,
          B2_PASS: eB2 && cB2,
          byDay: byDayEv([...e.picked, ...c.picked]),
        })
      }
    }

    perFeature[key] = {
      edges: edges.map((e) => r4(e)),
      exploration: { trend: eTrend, buckets: eBuckets },
      confirmation: { trend: cTrend, buckets: cBuckets },
      trendReproduces:
        (eTrend === 'monotone-up' && cTrend === 'monotone-up') ||
        (eTrend === 'monotone-down' && cTrend === 'monotone-down') ||
        (eTrend === 'single-peak' && cTrend === 'single-peak') ||
        (eTrend === 'single-trough' && cTrend === 'single-trough'),
      rulesPassingExploration: rules,
    }
  }

  const passes = (flag: 'B1_PASS' | 'B2_PASS') =>
    FEATURE_KEYS.some((k) => {
      const f = perFeature[k] as {
        rulesPassingExploration: Array<{ B1_PASS: boolean; B2_PASS: boolean }>
      }
      return f.rulesPassingExploration.some((r) => r[flag])
    })
  const anyB1Pass = passes('B1_PASS')
  const anyB2Pass = passes('B2_PASS')

  return {
    joined: joined.length,
    unjoined,
    played: joined.filter((m) => m.played).length,
    doomed: joined.filter((m) => m.doom).length,
    evAllJoined: r4(mean(joined.map((m) => m.pnl))),
    halves: {
      exploration: { n: explore.length, ev: r4(mean(explore.map((m) => m.pnl))) },
      confirmation: { n: confirm.length, ev: r4(mean(confirm.map((m) => m.pnl))) },
    },
    byDayAllJoined: byDayEv(joined),
    retentionBar: RETENTION_BAR,
    perFeature,
    economicsBarMetByAnyRule: anyB1Pass,
    separationBarMetByAnyRule: anyB2Pass,
  }
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const rows = await listEligibleTelonexMarkets({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'local',
    fromMs: PROTOCOL_FLOOR_MS,
    toMs: opts.toMs,
    limit: opts.latest,
    latest: true,
  })
  const usable = rows.filter(
    (m) => m.dataset && fs.existsSync(m.dataset) && m.assetId0 && m.assetId1,
  )
  const skipped = rows.length - usable.length
  const target = opts.maxMarkets ? usable.slice(0, opts.maxMarkets) : usable
  console.error(
    `[mktselect] universe latest=${opts.latest} toMs=${opts.toMs} rows=${rows.length} usable=${usable.length} skipped=${skipped} scanning=${target.length} run=${opts.run}`,
  )

  const ckptMeta = { v: 2, toMs: opts.toMs, latest: opts.latest, windowMs: WINDOW_MS }
  const cached = new Map<string, Features>()
  if (opts.checkpoint && fs.existsSync(opts.checkpoint)) {
    for (const line of fs.readFileSync(opts.checkpoint, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue // truncated tail line — market will be re-scanned
      }
      const rec = obj as { __meta?: typeof ckptMeta } & Features
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
    console.error(`[mktselect] checkpoint: ${cached.size} markets already scanned`)
  } else if (opts.checkpoint) {
    fs.appendFileSync(opts.checkpoint, JSON.stringify({ __meta: ckptMeta }) + '\n')
  }

  const t0 = Date.now()
  const feats: Features[] = []
  let scannedNow = 0
  let timedOut = false
  for (let i = 0; i < target.length; i++) {
    const mkt = target[i]!
    const hit = cached.get(mkt.slug)
    if (hit) {
      feats.push(hit)
      continue
    }
    if (opts.timeBudgetS !== null && (Date.now() - t0) / 1000 > opts.timeBudgetS) {
      timedOut = true
      break
    }
    const f = await scanMarket(mkt)
    feats.push(f)
    scannedNow += 1
    if (opts.checkpoint) fs.appendFileSync(opts.checkpoint, JSON.stringify(f) + '\n')
    if (scannedNow % 50 === 0 || i + 1 === target.length) {
      const dt = (Date.now() - t0) / 1000
      console.error(
        `[mktselect] ${feats.length}/${target.length} markets (${scannedNow} this pass), ${dt.toFixed(0)}s elapsed (${(scannedNow / dt).toFixed(1)} mkts/s)`,
      )
    }
  }

  if (timedOut) {
    console.error(
      `[mktselect] time budget ${opts.timeBudgetS}s hit: ${feats.length}/${target.length} done — rerun with the same --checkpoint to continue`,
    )
    console.log(JSON.stringify({ partial: true, done: feats.length, total: target.length }))
    await closeDb()
    return
  }

  const conn = await openDb()
  let runRows: MarketRow[]
  try {
    const [identity] = await fetchRunsByIds(conn, [opts.run])
    if (!identity) fail(`run ${opts.run} not found`)
    runRows = await fetchMarkets(conn, opts.run)
  } finally {
    await conn.end()
  }

  const result = {
    scannedAt: new Date().toISOString(),
    universe: {
      latest: opts.latest,
      toMs: opts.toMs,
      scanned: feats.length,
      skipped,
      firstSlug: target[0]?.slug ?? null,
      lastSlug: target[target.length - 1]?.slug ?? null,
    },
    referenceRun: opts.run,
    windowMs: WINDOW_MS,
    coverage: {
      fullWindow: feats.filter((f) => f.coveredMs >= WINDOW_MS - 1000).length,
      minCoveredMs: Math.min(...feats.map((f) => f.coveredMs)),
    },
    analysis: analyze(feats, runRows),
  }
  console.log(JSON.stringify(result, null, 2))
  await closeDb()
}

main().catch((err) => {
  console.error('[mktselect] FATAL', err)
  process.exit(1)
})
