/**
 * anatomy.ts — per-run loss/taker anatomy for the pair families. Read-only.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/anatomy.ts --run 872 [--json]
 *
 * Decomposes each market's pnl into the two mechanism components:
 *   - pairs:   paired = min(up,down) shares; pairsPnl = paired·(1 − avgUp − avgDown)
 *   - residue: |up−down| unpaired shares; wins iff surplus side == final outcome
 * (exact identity: pnl = paired + residueWins·residue − cost; checked per row
 * against the stored pnl, tolerance 0.02 for column rounding — mismatches are
 * reported, never silently dropped).
 *
 * Reads fill-mode from intent_meta `m` ('S' start | 'R' repair — pair-v1+;
 * v0 rows have no `m` and count as 'unknown'). Taker fills are only stored as
 * per-market aggregates, so taker→mode attribution is BOUNDED by market
 * composition: takers in markets whose fills are all-S can only come from
 * starts; all-R only from repairs; mixed markets are undecidable from stored
 * rows and reported as such.
 *
 * The unrepaired-start histogram: for markets ending imbalanced, the ts of the
 * last 'S' fill (the start whose completion leg never filled), bucketed by
 * minute-of-window from the slug epoch.
 */
import '../../../src/config/env.js'
import { openDb, toNum, quantile, fetchRunsByIds, type RunIdentity } from './lib/runQueries.js'
import type mysql from 'mysql2/promise'

function fail(msg: string): never {
  console.error(`[anatomy] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = { runIds: number[]; json: boolean }

function parseArgs(argv: string[]): Opts {
  const o: Opts = { runIds: [], json: false }
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
      default:
        fail(`unknown flag '${flag}'`)
    }
  }
  if (o.runIds.length === 0) fail('--run is required')
  return o
}

type MetaEntry = { side?: string; s?: number; ts?: number; m?: string; p?: number }

type MarketAnatomyRow = {
  slug: string
  marketStartMs: number
  finalOutcome: string
  pnl: number
  cost: number
  feesPaid: number
  upShares: number
  downShares: number
  avgUp: number | null
  avgDown: number | null
  taker: number
  maker: number
  meta: MetaEntry[]
}

async function fetchMarketsWithMeta(
  conn: mysql.Connection,
  runId: number,
): Promise<MarketAnatomyRow[]> {
  const [rows] = (await conn.query(
    `SELECT slug, market_start_ms, final_outcome, pnl, cost, fees_paid, up_shares, down_shares,
            avg_entry_price_up, avg_entry_price_down,
            trade_as_maker, trade_as_taker, intent_meta
       FROM backtest_run_markets WHERE run_id = ? ORDER BY market_start_ms`,
    [runId],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map((r) => ({
    slug: String(r.slug),
    marketStartMs: Number(r.market_start_ms),
    finalOutcome: String(r.final_outcome),
    pnl: toNum(r.pnl) ?? 0,
    cost: toNum(r.cost) ?? 0,
    feesPaid: toNum(r.fees_paid) ?? 0,
    upShares: toNum(r.up_shares) ?? 0,
    downShares: toNum(r.down_shares) ?? 0,
    avgUp: toNum(r.avg_entry_price_up),
    avgDown: toNum(r.avg_entry_price_down),
    maker: Number(r.trade_as_maker),
    taker: Number(r.trade_as_taker),
    meta: (typeof r.intent_meta === 'string'
      ? JSON.parse(r.intent_meta)
      : (r.intent_meta ?? [])) as MetaEntry[],
  }))
}

type RunAnatomy = {
  runId: number
  strategy: string
  params: Record<string, unknown>
  markets: number
  played: number
  flat: number
  pnlTotal: number
  invested: number
  // decomposition
  pairsPnlTotal: number
  residuePnlTotal: number
  reconMaxAbsErr: number
  reconBadRows: number
  // residue outcome
  residueMarkets: number
  residueWon: number
  residueLost: number
  residueLossSum: number
  residueWinSum: number
  residueQtyDist: { median: number | null; p90: number | null }
  // fills by mode
  fillsS: number
  fillsR: number
  fillsUnknown: number
  investedS: number
  investedR: number
  // taker bounding
  takerTotal: number
  takerPureS: number
  takerPureR: number
  takerMixed: number
  mixedMarketsFillsS: number
  mixedMarketsFillsR: number
  // unrepaired-start timing (minute-of-window 0..14, overflow bucket 15)
  unrepairedStartMinuteHist: number[]
  unrepairedNoTs: number
  // base rates: ALL fills by minute-of-window, per mode (same bucketing)
  fillsSMinuteHist: number[]
  fillsRMinuteHist: number[]
  feesTotal: number
}

function analyze(identity: RunIdentity, rows: MarketAnatomyRow[]): RunAnatomy {
  const a: RunAnatomy = {
    runId: identity.runId,
    strategy: identity.strategy,
    params: identity.params,
    markets: rows.length,
    played: 0,
    flat: 0,
    pnlTotal: 0,
    invested: 0,
    pairsPnlTotal: 0,
    residuePnlTotal: 0,
    reconMaxAbsErr: 0,
    reconBadRows: 0,
    residueMarkets: 0,
    residueWon: 0,
    residueLost: 0,
    residueLossSum: 0,
    residueWinSum: 0,
    residueQtyDist: { median: null, p90: null },
    fillsS: 0,
    fillsR: 0,
    fillsUnknown: 0,
    investedS: 0,
    investedR: 0,
    takerTotal: 0,
    takerPureS: 0,
    takerPureR: 0,
    takerMixed: 0,
    mixedMarketsFillsS: 0,
    mixedMarketsFillsR: 0,
    unrepairedStartMinuteHist: Array.from({ length: 16 }, () => 0),
    unrepairedNoTs: 0,
    fillsSMinuteHist: Array.from({ length: 16 }, () => 0),
    fillsRMinuteHist: Array.from({ length: 16 }, () => 0),
    feesTotal: 0,
  }
  const residueQtys: number[] = []

  for (const r of rows) {
    a.pnlTotal += r.pnl
    a.invested += r.cost
    a.feesTotal += r.feesPaid
    const played = r.cost > 0 || r.meta.length > 0
    if (!played) {
      a.flat += 1
      continue
    }
    a.played += 1

    const paired = Math.min(r.upShares, r.downShares)
    const residue = Math.abs(r.upShares - r.downShares)
    const residueSide = r.upShares > r.downShares ? 'UP' : 'DOWN'
    const residueWins = residue > 0 && residueSide === r.finalOutcome

    // Exact identity check against stored pnl (settlement pays $1/winning share).
    const recon = paired + (residueWins ? residue : 0) - r.cost
    const err = Math.abs(recon - r.pnl)
    if (err > a.reconMaxAbsErr) a.reconMaxAbsErr = err
    if (err > 0.02) a.reconBadRows += 1

    // Avg-entry decomposition (fees are capitalized into cost/avg entries).
    const avgUp = r.avgUp ?? 0
    const avgDown = r.avgDown ?? 0
    if (paired > 0) a.pairsPnlTotal += paired * (1 - avgUp - avgDown)
    if (residue > 0) {
      const avgE = residueSide === 'UP' ? avgUp : avgDown
      const rp = residueWins ? residue * (1 - avgE) : -residue * avgE
      a.residuePnlTotal += rp
      a.residueMarkets += 1
      residueQtys.push(residue)
      if (residueWins) {
        a.residueWon += 1
        a.residueWinSum += rp
      } else {
        a.residueLost += 1
        a.residueLossSum += rp
      }
    }

    // Fill-mode counts + invested per mode.
    let nS = 0
    let nR = 0
    let lastStartTs: number | null = null
    const minuteBucket = (ts: number | undefined): number | null => {
      if (ts === undefined) return null
      const minute = Math.floor((ts - r.marketStartMs) / 60_000)
      return minute >= 0 && minute <= 14 ? minute : 15
    }
    for (const m of r.meta) {
      const notional = (m.p ?? 0) * (m.s ?? 0)
      const bucket = minuteBucket(m.ts)
      if (m.m === 'S') {
        nS += 1
        a.investedS += notional
        if (m.ts !== undefined) lastStartTs = m.ts
        if (bucket !== null) a.fillsSMinuteHist[bucket]! += 1
      } else if (m.m === 'R') {
        nR += 1
        a.investedR += notional
        if (bucket !== null) a.fillsRMinuteHist[bucket]! += 1
      } else {
        a.fillsUnknown += 1
      }
    }
    a.fillsS += nS
    a.fillsR += nR

    // Taker bounding by market fill composition.
    a.takerTotal += r.taker
    if (r.taker > 0) {
      if (nR === 0 && nS > 0) a.takerPureS += r.taker
      else if (nS === 0 && nR > 0) a.takerPureR += r.taker
      else {
        a.takerMixed += r.taker
        a.mixedMarketsFillsS += nS
        a.mixedMarketsFillsR += nR
      }
    }

    // Unrepaired start timing (only meaningful when mode metadata exists).
    if (residue > 0 && (nS > 0 || nR > 0)) {
      if (lastStartTs === null) {
        a.unrepairedNoTs += 1
      } else {
        const minute = Math.floor((lastStartTs - r.marketStartMs) / 60_000)
        const bucket = minute >= 0 && minute <= 14 ? minute : 15
        a.unrepairedStartMinuteHist[bucket]! += 1
      }
    }
  }

  a.residueQtyDist = {
    median: quantile(residueQtys, 0.5),
    p90: quantile(residueQtys, 0.9),
  }
  return a
}

function printHuman(a: RunAnatomy): void {
  const f = (n: number): string => n.toFixed(2)
  console.log(`\n=== run ${a.runId} — ${a.strategy} ${JSON.stringify(a.params)} ===`)
  console.log(
    `markets ${a.markets} (played ${a.played}, flat ${a.flat})  pnl ${f(a.pnlTotal)}  invested ${f(a.invested)}`,
  )
  console.log(
    `decomposition: pairsPnl ${f(a.pairsPnlTotal)}  residuePnl ${f(a.residuePnlTotal)}  ` +
      `(recon maxErr ${a.reconMaxAbsErr.toFixed(4)}, badRows ${a.reconBadRows})`,
  )
  console.log(
    `residue: ${a.residueMarkets} markets (won ${a.residueWon} → +${f(a.residueWinSum)}, ` +
      `lost ${a.residueLost} → ${f(a.residueLossSum)})  qty median ${a.residueQtyDist.median} p90 ${a.residueQtyDist.p90}`,
  )
  console.log(
    `fills: S ${a.fillsS} ($${f(a.investedS)})  R ${a.fillsR} ($${f(a.investedR)})  unknown ${a.fillsUnknown}`,
  )
  console.log(
    `taker: total ${a.takerTotal} — in all-S markets ${a.takerPureS}, all-R ${a.takerPureR}, ` +
      `mixed ${a.takerMixed} (mixed mkts have S ${a.mixedMarketsFillsS} / R ${a.mixedMarketsFillsR} fills)`,
  )
  console.log(`fees total ${f(a.feesTotal)}`)
  console.log(
    `unrepaired-start minute hist [0..14,+]: ${a.unrepairedStartMinuteHist.join(' ')}` +
      (a.unrepairedNoTs ? `  (noTs ${a.unrepairedNoTs})` : ''),
  )
  console.log(`all-S-fills minute hist  [0..14,+]: ${a.fillsSMinuteHist.join(' ')}`)
  console.log(`all-R-fills minute hist  [0..14,+]: ${a.fillsRMinuteHist.join(' ')}`)
  const hazard = a.unrepairedStartMinuteHist.map((u, i) => {
    const s = a.fillsSMinuteHist[i]!
    return s > 0 ? (u / s).toFixed(2) : '-'
  })
  console.log(`doom hazard per start minute       : ${hazard.join(' ')}`)
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
    const out: RunAnatomy[] = []
    for (const run of runs) {
      const rows = await fetchMarketsWithMeta(conn, run.runId)
      out.push(analyze(run, rows))
    }
    if (opts.json) console.log(JSON.stringify(out, null, 2))
    else out.forEach(printHuman)
  } finally {
    await conn.end()
  }
}

await main()
