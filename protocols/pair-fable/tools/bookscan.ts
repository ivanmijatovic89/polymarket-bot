/**
 * bookscan.ts — Phase-0 book-state scanner for pair-v5 (taker pair-arb) and
 * pair-v6 (maker leg + instant taker completion). Read-only: DB for market
 * rows, local delta-typed parquet for books. Pre-registered hypotheses and
 * verdict criteria: memory/experiments/pair-v5.md + pair-v6.md (committed
 * BEFORE this tool ran).
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/bookscan.ts [--latest 800] [--max-markets N]
 *     [--latency-ms 140] [--refractory-ms 5000] [--json]
 *
 * Scan A (pair-v5): episodes where bestAskUp+fee + bestAskDown+fee < 1
 * (fee = 0.07·p·(1−p)/share, RULES rubric 4). Survivable = duration ≥ latency.
 * Executable value per episode = min(minDepth, 100 sh) × minMargin.
 *
 * Scan B (pair-v6): worst-queue trade-through moments (new bestAsk_X < prior
 * bestBid_X ⇒ a joiner bid at prior bestBid filled at P). Completion cost
 * C = P + askY(t+latency) + fee(askY). Residue EV if not completed =
 * 1{X wins} − P per share. 5s per-side refractory ≈ one resting bid + requote.
 */
import '../../../src/config/env.js'
import fs from 'node:fs'
import { listEligibleTelonexMarkets, type Market } from '../../../src/db/telonexMarkets.js'
import { closeDb } from '../../../src/db/index.js'
import { getMarketResolution } from '../../../src/backtest/stats/telonexMarketResolution.js'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const PROTOCOL_FLOOR_MS = 1775088000000 // 2026-04-02, RULES universe floor
const DEPTH_CAP_SHARES = 100 // scan-A executable depth cap (pre-registered)
const INCREMENT_SHARES = 10 // scan-B increment size (RULES-style)
const EXTREME_ASK = 0.05 // scan-A extreme-price stratum bound
const SANE_P_LO = 0.1 // scan-B sane fill-price band
const SANE_P_HI = 0.9

function fail(msg: string): never {
  console.error(`[bookscan] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = {
  latest: number
  maxMarkets: number | null
  latencyMs: number
  refractoryMs: number
  json: boolean
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { latest: 800, maxMarkets: null, latencyMs: 140, refractoryMs: 5000, json: false }
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
      case '--max-markets':
        o.maxMarkets = next()
        break
      case '--latency-ms':
        o.latencyMs = next()
        break
      case '--refractory-ms':
        o.refractoryMs = next()
        break
      case '--json':
        o.json = true
        break
      default:
        fail(`unknown flag '${flag}'`)
    }
  }
  return o
}

const fee = (p: number) => 0.07 * p * (1 - p)

type Best = { bid: number | null; ask: number | null; askSize: number }

type Episode = {
  slug: string
  tsOn: number
  durationMs: number
  entryMargin: number
  minMargin: number
  minDepth: number
  entryExtreme: boolean
}

type Moment = {
  slug: string
  sideX: 0 | 1
  ts: number
  P: number
  askYAtFill: number | null
  askYSizeAtFill: number
  askY140: number | null
  askY140Size: number
  resolved: boolean // askY140 read from book state at t+latency (vs market ended first)
  xWon: boolean | null // null = market outcome unknown
}

type MarketAgg = {
  slug: string
  events: number
  episodes: Episode[]
  feeExclEpisodes: number
  feeExclDurationMs: number
  momentsRawBySide: [number, number]
  moments: Moment[]
}

async function scanMarket(m: Market, opts: Opts): Promise<MarketAgg> {
  const a0 = m.assetId0!
  const a1 = m.assetId1!
  const resolution = getMarketResolution(m)
  const outcome = resolution?.outcome ?? null

  const agg: MarketAgg = {
    slug: m.slug,
    events: 0,
    episodes: [],
    feeExclEpisodes: 0,
    feeExclDurationMs: 0,
    momentsRawBySide: [0, 0],
    moments: [],
  }

  // pre-apply state (updated at the end of every callback)
  const prev: [Best, Best] = [
    { bid: null, ask: null, askSize: 0 },
    { bid: null, ask: null, askSize: 0 },
  ]
  let lastTs = 0

  // scan-A episode state
  let epOn = false
  let epTsOn = 0
  let epEntryMargin = 0
  let epMinMargin = 0
  let epMinDepth = 0
  let epEntryExtreme = false
  let feOn = false // fee-exclusive condition, counts only
  let feTsOn = 0

  // scan-B state
  const pendings: Moment[] = []
  const lastCounted: [number, number] = [-Infinity, -Infinity]

  const closeEpisode = (ts: number) => {
    agg.episodes.push({
      slug: m.slug,
      tsOn: epTsOn,
      durationMs: Math.max(0, ts - epTsOn),
      entryMargin: epEntryMargin,
      minMargin: epMinMargin,
      minDepth: epMinDepth,
      entryExtreme: epEntryExtreme,
    })
    epOn = false
  }

  await replayTelonexDeltaParquetForMarket({
    filePath: m.dataset!,
    onSnapshot: (snapshot) => {
      agg.events += 1
      const ts = Math.max(lastTs, snapshot.timestamp)
      lastTs = ts

      // 1) resolve scan-B pendings due strictly before this event, with the
      // pre-apply state (= book as-of all events with ts ≤ target)
      for (let i = pendings.length - 1; i >= 0; i--) {
        const p = pendings[i]!
        if (p.ts + opts.latencyMs < ts) {
          const y = prev[p.sideX === 0 ? 1 : 0]
          p.askY140 = y.ask
          p.askY140Size = y.askSize
          p.resolved = true
          agg.moments.push(p)
          pendings.splice(i, 1)
        }
      }

      const s0 = snapshot.byAssetId[a0]
      const s1 = snapshot.byAssetId[a1]
      const cur: [Best, Best] = [
        { bid: s0?.bestBid ?? null, ask: s0?.bestAsk ?? null, askSize: s0?.asks[0]?.size ?? 0 },
        { bid: s1?.bestBid ?? null, ask: s1?.bestAsk ?? null, askSize: s1?.asks[0]?.size ?? 0 },
      ]

      // 2) scan-B trade-through detection: new bestAsk_X < pre-event bestBid_X
      for (const sideX of [0, 1] as const) {
        const newAsk = cur[sideX].ask
        const prevBid = prev[sideX].bid
        if (newAsk === null || prevBid === null || !(newAsk < prevBid)) continue
        agg.momentsRawBySide[sideX] += 1
        if (ts - lastCounted[sideX] < opts.refractoryMs) continue
        lastCounted[sideX] = ts
        const y = cur[sideX === 0 ? 1 : 0]
        const xWon =
          outcome === null ? null : (outcome === 'UP') === (sideX === 0) ? true : false
        pendings.push({
          slug: m.slug,
          sideX,
          ts,
          P: prevBid,
          askYAtFill: y.ask,
          askYSizeAtFill: y.askSize,
          askY140: null,
          askY140Size: 0,
          resolved: false,
          xWon,
        })
      }

      // 3) scan-A arb condition on post-apply state
      const a0ask = cur[0].ask
      const a1ask = cur[1].ask
      if (a0ask !== null && a1ask !== null) {
        const feeInclSum = a0ask + fee(a0ask) + a1ask + fee(a1ask)
        const margin = 1 - feeInclSum
        const depth = Math.min(cur[0].askSize, cur[1].askSize)
        if (margin > 0) {
          if (!epOn) {
            epOn = true
            epTsOn = ts
            epEntryMargin = margin
            epMinMargin = margin
            epMinDepth = depth
            epEntryExtreme = a0ask <= EXTREME_ASK || a1ask <= EXTREME_ASK
          } else {
            epMinMargin = Math.min(epMinMargin, margin)
            epMinDepth = Math.min(epMinDepth, depth)
          }
        } else if (epOn) {
          closeEpisode(ts)
        }
        const feeExcl = a0ask + a1ask < 1
        if (feeExcl && !feOn) {
          feOn = true
          feTsOn = ts
        } else if (!feeExcl && feOn) {
          feOn = false
          agg.feeExclEpisodes += 1
          agg.feeExclDurationMs += Math.max(0, ts - feTsOn)
        }
      } else if (epOn) {
        closeEpisode(ts)
      }

      prev[0] = cur[0]
      prev[1] = cur[1]
    },
  })

  if (epOn) closeEpisode(lastTs)
  if (feOn) {
    agg.feeExclEpisodes += 1
    agg.feeExclDurationMs += Math.max(0, lastTs - feTsOn)
  }
  // pendings whose +latency point lies beyond the recording: resolve with the
  // final book state (the last known state IS the as-of state)
  for (const p of pendings) {
    const y = prev[p.sideX === 0 ? 1 : 0]
    p.askY140 = y.ask
    p.askY140Size = y.askSize
    p.resolved = true
    agg.moments.push(p)
  }
  return agg
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))
  return sorted[idx]!
}

const r4 = (x: number | null) => (x === null ? null : Math.round(x * 1e4) / 1e4)

function summarizeA(markets: MarketAgg[], latencyMs: number) {
  const all = markets.flatMap((m) => m.episodes)
  const subsets: Record<string, Episode[]> = {
    all,
    sane: all.filter((e) => !e.entryExtreme),
  }
  const out: Record<string, unknown> = {
    marketsScanned: markets.length,
    feeExclusive: {
      episodes: markets.reduce((s, m) => s + m.feeExclEpisodes, 0),
      totalDurationMs: markets.reduce((s, m) => s + m.feeExclDurationMs, 0),
      marketsWithAny: markets.filter((m) => m.feeExclEpisodes > 0).length,
    },
  }
  for (const [name, eps] of Object.entries(subsets)) {
    const survivable = eps.filter((e) => e.durationMs >= latencyMs)
    const durs = eps.map((e) => e.durationMs).sort((a, b) => a - b)
    const margins = eps.map((e) => e.entryMargin).sort((a, b) => a - b)
    const perMarketExec = new Map<string, number>()
    for (const m of markets) perMarketExec.set(m.slug, 0)
    for (const e of survivable) {
      perMarketExec.set(
        e.slug,
        (perMarketExec.get(e.slug) ?? 0) + Math.min(e.minDepth, DEPTH_CAP_SHARES) * e.minMargin,
      )
    }
    const perMarketZeroLat = new Map<string, number>()
    for (const m of markets) perMarketZeroLat.set(m.slug, 0)
    for (const e of eps) {
      perMarketZeroLat.set(
        e.slug,
        (perMarketZeroLat.get(e.slug) ?? 0) + Math.min(e.minDepth, DEPTH_CAP_SHARES) * e.entryMargin,
      )
    }
    const execVals = [...perMarketExec.values()].sort((a, b) => a - b)
    const zeroVals = [...perMarketZeroLat.values()].sort((a, b) => a - b)
    out[name] = {
      episodes: eps.length,
      marketsWithAny: new Set(eps.map((e) => e.slug)).size,
      durationMsP50: quantile(durs, 0.5),
      durationMsP90: quantile(durs, 0.9),
      durationMsMax: durs.length ? durs[durs.length - 1] : null,
      entryMarginP50: r4(quantile(margins, 0.5)),
      entryMarginP90: r4(quantile(margins, 0.9)),
      survivableEpisodes: survivable.length,
      marketsWithSurvivable: new Set(survivable.map((e) => e.slug)).size,
      execValuePerMarketMean: r4(execVals.reduce((s, v) => s + v, 0) / (execVals.length || 1)),
      execValuePerMarketP90: r4(quantile(execVals, 0.9)),
      execValuePerMarketMax: r4(execVals.length ? execVals[execVals.length - 1]! : null),
      zeroLatencyValuePerMarketMean: r4(
        zeroVals.reduce((s, v) => s + v, 0) / (zeroVals.length || 1),
      ),
    }
  }
  return out
}

function summarizeBSubset(moments: Moment[], markets: MarketAgg[], gates: number[]) {
  const withC = moments
    .filter((mo) => mo.askY140 !== null)
    .map((mo) => ({ ...mo, C: mo.P + mo.askY140! + fee(mo.askY140!) }))
  const cs = withC.map((mo) => mo.C).sort((a, b) => a - b)
  const gateStats: Record<string, unknown> = {}
  for (const g of gates) {
    const below = withC.filter((mo) => mo.C < g)
    gateStats[String(g)] = {
      pBelow: r4(below.length / (withC.length || 1)),
      meanMarginBelow: r4(
        below.length ? below.reduce((s, mo) => s + (1 - mo.C), 0) / below.length : null,
      ),
    }
  }
  // free-abort upper bound and abort-corrected (gate 1.00) per-market EV
  const perMarketUpper = new Map<string, number>()
  const perMarketCorrected = new Map<string, number>()
  for (const m of markets) {
    perMarketUpper.set(m.slug, 0)
    perMarketCorrected.set(m.slug, 0)
  }
  let residueShareEvSum = 0
  let residueN = 0
  let correctedKnown = 0
  for (const mo of withC) {
    const upper = Math.max(0, 1 - mo.C) * INCREMENT_SHARES
    perMarketUpper.set(mo.slug, (perMarketUpper.get(mo.slug) ?? 0) + upper)
    if (mo.xWon !== null) {
      correctedKnown += 1
      const contrib =
        mo.C < 1
          ? (1 - mo.C) * INCREMENT_SHARES
          : ((mo.xWon ? 1 : 0) - mo.P) * INCREMENT_SHARES
      perMarketCorrected.set(mo.slug, (perMarketCorrected.get(mo.slug) ?? 0) + contrib)
      if (mo.C >= 1) {
        residueShareEvSum += (mo.xWon ? 1 : 0) - mo.P
        residueN += 1
      }
    }
  }
  // "hold-all" readout: never complete, hold every dip-bought increment to
  // settlement — isolates whether residue (directional) EV is the real driver
  const perMarketHoldAll = new Map<string, number>()
  for (const m of markets) perMarketHoldAll.set(m.slug, 0)
  let holdWins = 0
  let holdN = 0
  let holdPSum = 0
  for (const mo of moments) {
    if (mo.xWon === null) continue
    holdN += 1
    if (mo.xWon) holdWins += 1
    holdPSum += mo.P
    perMarketHoldAll.set(
      mo.slug,
      (perMarketHoldAll.get(mo.slug) ?? 0) + ((mo.xWon ? 1 : 0) - mo.P) * INCREMENT_SHARES,
    )
  }
  const holdVals = [...perMarketHoldAll.values()].sort((a, b) => a - b)
  const byDay = new Map<string, { markets: Set<string>; ev: number }>()
  for (const [slug, ev] of perMarketHoldAll) {
    const epoch = Number(slug.split('-').pop())
    const day = Number.isFinite(epoch) ? new Date(epoch * 1000).toISOString().slice(0, 10) : '?'
    const d = byDay.get(day) ?? { markets: new Set<string>(), ev: 0 }
    d.markets.add(slug)
    d.ev += ev
    byDay.set(day, d)
  }
  const holdAllByDay = Object.fromEntries(
    [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => [day, { markets: d.markets.size, evPerMarket: r4(d.ev / d.markets.size) }]),
  )

  const upperVals = [...perMarketUpper.values()].sort((a, b) => a - b)
  const corrVals = [...perMarketCorrected.values()].sort((a, b) => a - b)
  const drift = withC
    .filter((mo) => mo.askYAtFill !== null)
    .map((mo) => mo.askY140! - mo.askYAtFill!)
  const c0 = moments
    .filter((mo) => mo.askYAtFill !== null)
    .map((mo) => mo.P + mo.askYAtFill! + fee(mo.askYAtFill!))
    .sort((a, b) => a - b)
  return {
    moments: moments.length,
    withCompletionRead: withC.length,
    marketsWithAny: new Set(moments.map((mo) => mo.slug)).size,
    cP10: r4(quantile(cs, 0.1)),
    cP25: r4(quantile(cs, 0.25)),
    cP50: r4(quantile(cs, 0.5)),
    cP75: r4(quantile(cs, 0.75)),
    cP90: r4(quantile(cs, 0.9)),
    zeroLatencyCP50: r4(quantile(c0, 0.5)),
    askYDriftMean: r4(drift.reduce((s, v) => s + v, 0) / (drift.length || 1)),
    completionDepthGe10: r4(
      withC.filter((mo) => mo.askY140Size >= INCREMENT_SHARES).length / (withC.length || 1),
    ),
    gates: gateStats,
    freeAbortEvPerMarketMean: r4(upperVals.reduce((s, v) => s + v, 0) / (upperVals.length || 1)),
    freeAbortEvPerMarketP90: r4(quantile(upperVals, 0.9)),
    abortCorrectedEvPerMarketMean: r4(
      corrVals.reduce((s, v) => s + v, 0) / (corrVals.length || 1),
    ),
    abortCorrectedEvPerMarketP50: r4(quantile(corrVals, 0.5)),
    residueMomentShare: r4(residueN / (correctedKnown || 1)),
    residueShareEvMean: r4(residueN ? residueShareEvSum / residueN : null),
    holdAll: {
      moments: holdN,
      winRate: r4(holdN ? holdWins / holdN : null),
      meanFillP: r4(holdN ? holdPSum / holdN : null),
      evPerMarketMean: r4(holdVals.reduce((s, v) => s + v, 0) / (holdVals.length || 1)),
      evPerMarketP10: r4(quantile(holdVals, 0.1)),
      evPerMarketP50: r4(quantile(holdVals, 0.5)),
      evPerMarketP90: r4(quantile(holdVals, 0.9)),
      pctMarketsPositive: r4(holdVals.filter((v) => v > 0).length / (holdVals.length || 1)),
      byDay: holdAllByDay,
    },
  }
}

function summarizeB(markets: MarketAgg[]) {
  const all = markets.flatMap((m) => m.moments)
  const gates = [1.0, 0.99, 0.98]
  return {
    marketsScanned: markets.length,
    momentsRaw: markets.reduce((s, m) => s + m.momentsRawBySide[0] + m.momentsRawBySide[1], 0),
    all: summarizeBSubset(all, markets, gates),
    sane: summarizeBSubset(
      all.filter((mo) => mo.P >= SANE_P_LO && mo.P <= SANE_P_HI),
      markets,
      gates,
    ),
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const rows = await listEligibleTelonexMarkets({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'local',
    fromMs: PROTOCOL_FLOOR_MS,
    limit: opts.latest,
    latest: true,
  })
  const usable = rows.filter(
    (m) => m.dataset && fs.existsSync(m.dataset) && m.assetId0 && m.assetId1,
  )
  const skipped = rows.length - usable.length
  const target = opts.maxMarkets ? usable.slice(0, opts.maxMarkets) : usable
  console.error(
    `[bookscan] universe latest=${opts.latest} rows=${rows.length} usable=${usable.length} skipped=${skipped} scanning=${target.length} latency=${opts.latencyMs}ms refractory=${opts.refractoryMs}ms`,
  )

  const t0 = Date.now()
  const aggs: MarketAgg[] = []
  for (let i = 0; i < target.length; i++) {
    aggs.push(await scanMarket(target[i]!, opts))
    if ((i + 1) % 50 === 0 || i + 1 === target.length) {
      const dt = (Date.now() - t0) / 1000
      console.error(
        `[bookscan] ${i + 1}/${target.length} markets, ${dt.toFixed(0)}s elapsed (${((i + 1) / dt).toFixed(1)} mkts/s)`,
      )
    }
  }

  const result = {
    scannedAt: new Date().toISOString(),
    universe: {
      latest: opts.latest,
      scanned: aggs.length,
      skipped,
      firstSlug: target[0]?.slug ?? null,
      lastSlug: target[target.length - 1]?.slug ?? null,
    },
    params: { latencyMs: opts.latencyMs, refractoryMs: opts.refractoryMs },
    totalEvents: aggs.reduce((s, m) => s + m.events, 0),
    scanA_takerArb: summarizeA(aggs, opts.latencyMs),
    scanB_instantCompletion: summarizeB(aggs),
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(JSON.stringify(result, null, 2))
  }
  await closeDb()
}

main().catch((err) => {
  console.error('[bookscan] FATAL', err)
  process.exit(1)
})
