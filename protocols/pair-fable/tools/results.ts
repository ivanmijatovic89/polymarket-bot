/**
 * results.ts — read a run (or a set of runs) from MySQL into a capital-aware
 * summary. Read-only.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/results.ts --run 857
 *   tsx protocols/pair-fable/tools/results.ts --run 856,857 --json
 *   tsx protocols/pair-fable/tools/results.ts --batch-uid smoke-20260730T194744-4vrhbh
 *   tsx protocols/pair-fable/tools/results.ts --label smoke --limit 10
 *   tsx protocols/pair-fable/tools/results.ts --last 5            # recent pair-fable runs
 *   tsx protocols/pair-fable/tools/results.ts --run 857 --markets # per-market rows
 *   tsx protocols/pair-fable/tools/results.ts --run 857 --segments daily
 *
 * Exactly one selector: --run | --batch-uid | --label | --last.
 *
 * Numbers reported:
 *   - headline: the segments kind='all' row (source of truth for run stats)
 *   - capital units per memory/process/evaluator.md: investedTotal (Σcost),
 *     profitPer100 (100·Σpnl/Σcost, capital-weighted), investedMax,
 *     investedAvgPlayed, plus the per-market profitPer100 distribution
 *     (median/p10/p90 over cost>0 rows) because the weighted number can be
 *     dominated by big-notional markets.
 *   - unitsValid=false marks a run where split_cost != 0 somewhere — the
 *     cost==invested identity does not hold; units are meaningless for it.
 *   - latency comes from the recorded cmd; 'env-sourced' means the run is not
 *     RULES-grade evidence (latency untraceable).
 */
import '../../../src/config/env.js'
import {
  openDb,
  toNum,
  quantile,
  fetchRunsByIds,
  fetchRunsByBatchUid,
  fetchRunsByLabel,
  fetchRecentProtocolRuns,
  fetchHeadline,
  fetchUnits,
  fetchMarkets,
  fetchSegments,
  fetchFailures,
  type RunIdentity,
} from './lib/runQueries.js'

const SEGMENT_KINDS = new Set(['daily', 'weekly', 'monthly', 'last_n'])

function fail(msg: string): never {
  console.error(`[results] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = {
  runIds?: number[]
  batchUid?: string
  label?: string
  last?: number
  limit: number
  markets: boolean
  segments?: string
  json: boolean
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { limit: 20, markets: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) fail(`${flag} requires a value`)
      return v
    }
    switch (flag) {
      case '--run': {
        o.runIds = next()
          .split(',')
          .map((s) => {
            const n = Number(s.trim())
            if (!Number.isInteger(n) || n <= 0) fail(`--run expects positive ids, got '${s}'`)
            return n
          })
        break
      }
      case '--batch-uid':
        o.batchUid = next()
        break
      case '--label':
        o.label = next()
        break
      case '--last': {
        const n = Number(next())
        if (!Number.isInteger(n) || n <= 0) fail('--last expects a positive integer')
        o.last = n
        break
      }
      case '--limit': {
        const n = Number(next())
        if (!Number.isInteger(n) || n <= 0) fail('--limit expects a positive integer')
        o.limit = n
        break
      }
      case '--markets':
        o.markets = true
        break
      case '--segments': {
        const k = next()
        if (!SEGMENT_KINDS.has(k)) fail(`--segments expects one of ${[...SEGMENT_KINDS].join('|')}`)
        o.segments = k
        break
      }
      case '--json':
        o.json = true
        break
      default:
        fail(`unknown flag '${flag}'`)
    }
  }
  const selectors = [o.runIds, o.batchUid, o.label, o.last].filter((v) => v !== undefined).length
  if (selectors !== 1) fail('exactly one selector required: --run | --batch-uid | --label | --last')
  return o
}

const o = parseArgs(process.argv.slice(2))
const conn = await openDb()
try {
  let runs: RunIdentity[]
  if (o.runIds) runs = await fetchRunsByIds(conn, o.runIds)
  else if (o.batchUid) runs = await fetchRunsByBatchUid(conn, o.batchUid)
  else if (o.label) runs = await fetchRunsByLabel(conn, o.label, o.limit)
  else runs = await fetchRecentProtocolRuns(conn, 'pair-fable', o.last!)

  if (runs.length === 0) fail('no runs matched the selector')
  if (o.runIds) {
    const found = new Set(runs.map((r) => r.runId))
    const missing = o.runIds.filter((id) => !found.has(id))
    if (missing.length > 0) fail(`run id(s) not found: ${missing.join(', ')}`)
  }

  const out: Array<Record<string, unknown>> = []
  for (const run of runs) {
    const [headline, units, marketRows, failures] = await Promise.all([
      fetchHeadline(conn, run.runId),
      fetchUnits(conn, run.runId),
      fetchMarkets(conn, run.runId),
      run.failuresCount > 0
        ? fetchFailures(conn, run.runId)
        : Promise.resolve([] as Array<{ slug: string | null; reason: string }>),
    ])
    const p100 = marketRows.filter((m) => m.cost > 0).map((m) => (100 * m.pnl) / m.cost)
    const entry: Record<string, unknown> = {
      ...run,
      headline,
      units: {
        ...units,
        profitPer100Median: quantile(p100, 0.5),
        profitPer100P10: quantile(p100, 0.1),
        profitPer100P90: quantile(p100, 0.9),
        playedMarkets: p100.length,
      },
      failures,
    }
    if (o.markets) entry.markets = marketRows
    if (o.segments) entry.segments = await fetchSegments(conn, run.runId, o.segments)
    out.push(entry)
  }

  if (o.json) {
    console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2))
  } else {
    for (const e of out) {
      const r = e as Record<string, any>
      const h = (r.headline ?? {}) as Record<string, unknown>
      const u = r.units as Record<string, any>
      const lat =
        r.latencyDelayMs !== null
          ? `${r.latencyDelayMs}/${r.latencyJitterMs ?? '?'}ms`
          : 'ENV-SOURCED (not RULES-grade evidence)'
      console.log(
        [
          `run ${r.runId}  ${r.strategy}  status=${r.status}  created=${r.createdAt}`,
          `  batchUid=${r.batchUid}  protocol=${r.protocol ?? '-'}  model=${r.model ?? '-'}`,
          `  latency=${lat}  markets=${r.marketsPersisted}  failures=${r.failuresCount}  params=${JSON.stringify(r.params)}`,
          `  pnl=${h.pnl_total ?? '-'}  evPerMarketTotal=${h.ev_per_market_total ?? '-'}  fees=${h.total_fees_paid ?? '-'}  winRate%=${h.win_rate_pct ?? '-'}`,
          `  played=${h.markets_played ?? '-'}/${h.markets_total ?? '-'}  won/lost=${h.markets_won ?? '-'}/${h.markets_lost ?? '-'}  flat=${h.markets_flat_with_trades ?? '-'}  noActivity=${h.markets_no_in_window_activity ?? '-'}`,
          `  trades=${h.trades_total ?? '-'} (maker=${h.trades_maker ?? '-'} taker=${h.trades_taker ?? '-'})  wallClockMs=${h.duration_wall_clock_ms ?? '-'}`,
          `  invested: total=${fmt(u.investedTotal)}  max=${fmt(u.investedMax)}  avgPlayed=${fmt(u.investedAvgPlayed)}  profitPer100=${fmt(u.profitPer100)}${u.unitsValid ? '' : '  UNITS-INVALID(split_cost!=0)'}${capBreach(r.params, u.investedMax)}`,
          `  profitPer100 dist (n=${u.playedMarkets}): median=${fmt(u.profitPer100Median)}  p10=${fmt(u.profitPer100P10)}  p90=${fmt(u.profitPer100P90)}`,
        ].join('\n'),
      )
      const failures = r.failures as Array<{ slug: string | null; reason: string }>
      for (const f of failures) console.log(`  FAILURE ${f.slug ?? '?'}: ${f.reason}`)
      if (o.markets) {
        console.log('  slug                          outcome  pnl        cost      p/100   trades m/t   fees    up/down/mergable')
        for (const m of r.markets as Array<Record<string, any>>) {
          const p100m = m.cost > 0 ? ((100 * m.pnl) / m.cost).toFixed(2) : '-'
          console.log(
            `  ${String(m.slug).padEnd(30)}${String(m.finalOutcome).padEnd(9)}${String(m.pnl.toFixed(2)).padEnd(11)}${String(m.cost.toFixed(2)).padEnd(10)}${String(p100m).padEnd(8)}${String(`${m.tradeCount} ${m.tradeAsMaker}/${m.tradeAsTaker}`).padEnd(13)}${String(m.feesPaid.toFixed(2)).padEnd(8)}${m.upShares}/${m.downShares}/${m.mergableShares}${m.skipReason ? `  SKIP:${m.skipReason}` : ''}`,
          )
        }
      }
      if (o.segments) {
        console.log(`  segments (${o.segments}): key | pnl | ev/mkt | played/total | won/lost | winRate%`)
        for (const s of r.segments as Array<Record<string, unknown>>) {
          console.log(
            `  ${String(s.segment_key).padEnd(12)} ${s.pnl_total}  ${s.ev_per_market_total}  ${s.markets_played}/${s.markets_total}  ${s.markets_won}/${s.markets_lost}  ${s.win_rate_pct}`,
          )
        }
      }
      console.log('')
    }
  }
} finally {
  await conn.end()
}

function fmt(v: unknown): string {
  const n = toNum(v)
  return n === null ? '-' : n.toFixed(2)
}

/**
 * Mechanical cap-integrity check: if the strategy exposes `capPerMarket`
 * (binding evaluator convention) and any market invested more than the cap
 * plus one grid-price increment step, the run is contaminated — the E-020
 * FOK-burst bug (run 900: $159.92 vs cap 50) is the class this catches.
 */
function capBreach(params: unknown, investedMax: unknown): string {
  const p = params as Record<string, unknown> | null
  const cap = toNum(p?.capPerMarket)
  const max = toNum(investedMax)
  if (cap === null || max === null) return ''
  return max > cap * 1.1 ? `  CAP-BREACH(max ${max.toFixed(2)} > cap ${cap})` : ''
}
