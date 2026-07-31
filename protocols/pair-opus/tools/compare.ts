/**
 * compare.ts — compare 2+ backtest runs, fairly. Read-only.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-opus/tools/compare.ts --runs 856,857
 *   tsx protocols/pair-opus/tools/compare.ts --runs 858,859,860 --json
 *
 * The first run listed is the BASELINE; deltas are relative to it.
 *
 * What it does beyond results.ts:
 *   - Universe overlap: markets only counted fairly on the slug INTERSECTION.
 *     Full-run stats (the 'all' segment) are shown too, but deltas are
 *     computed on the common universe ONLY — comparing totals across
 *     different universes is meaningless.
 *   - Latency sweep detection: when all runs share strategy+params and differ
 *     only in cmd-recorded latency, rows are ordered by latency — this is the
 *     RULES upward-sweep view (a variant must not collapse as latency grows).
 *   - Per-market deltas (2-run case): biggest |Δpnl| movers, to see WHERE a
 *     change helped/hurt.
 *   - Daily buckets on the common universe (UTC day of market_start_ms) with
 *     positive-day fraction per run, plus pairwise Pearson correlation of
 *     daily pnl when ≥3 common days — the variant-independence measure.
 *
 * Jitter note: two runs with identical strategy/params/latency still differ
 * slightly (latency jitter is random per order). Small deltas are noise, not
 * signal — judge against the jitter-induced spread, not against zero.
 */
import '../../../src/config/env.js'
import {
  openDb,
  fetchRunsByIds,
  fetchHeadline,
  fetchUnits,
  fetchMarkets,
  fetchDistinctCommitShas,
  type RunIdentity,
  type MarketRow,
  type Units,
} from './lib/runQueries.js'

function fail(msg: string): never {
  console.error(`[compare] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = { runIds: number[]; movers: number; json: boolean }

function parseArgs(argv: string[]): Opts {
  const o: Opts = { runIds: [], movers: 5, json: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) fail(`${flag} requires a value`)
      return v
    }
    switch (flag) {
      case '--runs':
        o.runIds = next()
          .split(',')
          .map((s) => {
            const n = Number(s.trim())
            if (!Number.isInteger(n) || n <= 0) fail(`--runs expects positive ids, got '${s}'`)
            return n
          })
        break
      case '--movers': {
        const n = Number(next())
        if (!Number.isInteger(n) || n < 0) fail('--movers expects a non-negative integer')
        o.movers = n
        break
      }
      case '--json':
        o.json = true
        break
      default:
        fail(`unknown flag '${flag}'`)
    }
  }
  if (o.runIds.length < 2) fail('--runs needs at least 2 comma-separated run ids')
  if (new Set(o.runIds).size !== o.runIds.length) fail('--runs contains duplicate ids')
  return o
}

/** Stats over an explicit market subset — the fair-comparison core. */
type SubsetStats = {
  markets: number
  pnlTotal: number
  evPerMarketTotal: number | null
  investedTotal: number
  profitPer100: number | null
  won: number
  lost: number
  flat: number
  tradesMaker: number
  tradesTaker: number
  feesTotal: number
}

function subsetStats(rows: MarketRow[]): SubsetStats {
  const pnl = rows.reduce((a, m) => a + m.pnl, 0)
  const cost = rows.reduce((a, m) => a + m.cost, 0)
  return {
    markets: rows.length,
    pnlTotal: round4(pnl),
    evPerMarketTotal: rows.length > 0 ? round4(pnl / rows.length) : null,
    investedTotal: round4(cost),
    profitPer100: cost > 0 ? round4((100 * pnl) / cost) : null,
    won: rows.filter((m) => m.pnl > 0).length,
    lost: rows.filter((m) => m.pnl < 0).length,
    flat: rows.filter((m) => m.pnl === 0).length,
    tradesMaker: rows.reduce((a, m) => a + m.tradeAsMaker, 0),
    tradesTaker: rows.reduce((a, m) => a + m.tradeAsTaker, 0),
    feesTotal: round4(rows.reduce((a, m) => a + m.feesPaid, 0)),
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length
  if (n < 3 || n !== b.length) return null
  const ma = a.reduce((x, y) => x + y, 0) / n
  const mb = b.reduce((x, y) => x + y, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb)
    da += (a[i]! - ma) ** 2
    db += (b[i]! - mb) ** 2
  }
  if (da === 0 || db === 0) return null
  return round4(num / Math.sqrt(da * db))
}

const o = parseArgs(process.argv.slice(2))
const conn = await openDb()
try {
  const byId = new Map((await fetchRunsByIds(conn, o.runIds)).map((r) => [r.runId, r]))
  const missing = o.runIds.filter((id) => !byId.has(id))
  if (missing.length > 0) fail(`run id(s) not found: ${missing.join(', ')}`)
  // Preserve the caller's order (baseline first) — fetch sorts by id.
  const runs: RunIdentity[] = o.runIds.map((id) => byId.get(id)!)

  const perRun = await Promise.all(
    runs.map(async (run) => ({
      run,
      headline: await fetchHeadline(conn, run.runId),
      units: await fetchUnits(conn, run.runId),
      markets: await fetchMarkets(conn, run.runId),
      commitShas: await fetchDistinctCommitShas(conn, run.runId),
    })),
  )

  // MISSION01-REVIEW M4: deltas across engine versions are only trustworthy
  // when no semantic engine drift (fill model / fees / ticks) lies between.
  const allShas = [...new Set(perRun.flatMap((p) => p.commitShas))]
  const shaWarning =
    allShas.length > 1
      ? `engine SHA differs across runs (${allShas.join(', ')}) — check for semantic engine drift before trusting deltas (M4)`
      : null

  // Universe overlap.
  const slugSets = perRun.map((p) => new Set(p.markets.map((m) => m.slug)))
  const common = [...slugSets[0]!].filter((s) => slugSets.every((set) => set.has(s)))
  const commonSet = new Set(common)
  const onlyCounts = perRun.map((p) => p.markets.filter((m) => !commonSet.has(m.slug)).length)

  // Comparability of the runs themselves.
  const sameStrategy = perRun.every((p) => p.run.strategy === perRun[0]!.run.strategy)
  const sameParams = perRun.every(
    (p) => JSON.stringify(p.run.params) === JSON.stringify(perRun[0]!.run.params),
  )
  const latencies = perRun.map((p) => p.run.latencyDelayMs)
  const distinctLatencies = new Set(latencies.map((l) => String(l)))
  const isLatencySweep =
    sameStrategy && sameParams && distinctLatencies.size === perRun.length && !latencies.includes(null)

  const commonStats = perRun.map((p) => subsetStats(p.markets.filter((m) => commonSet.has(m.slug))))
  const base = commonStats[0]!

  // Per-market movers (2-run case only).
  let movers: Array<{ slug: string; pnlA: number; pnlB: number; delta: number }> = []
  if (perRun.length === 2 && o.movers > 0) {
    const bBySlug = new Map(perRun[1]!.markets.map((m) => [m.slug, m]))
    movers = perRun[0]!.markets
      .filter((m) => commonSet.has(m.slug))
      .map((m) => {
        const other = bBySlug.get(m.slug)!
        return { slug: m.slug, pnlA: m.pnl, pnlB: other.pnl, delta: round4(other.pnl - m.pnl) }
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, o.movers)
  }

  // Daily buckets on the common universe.
  const days = [...new Set(common.map((slug) => {
    const m = perRun[0]!.markets.find((x) => x.slug === slug)!
    return utcDay(m.marketStartMs)
  }))].sort()
  const dailyPnl = perRun.map((p) => {
    const byDay = new Map<string, number>()
    for (const m of p.markets) {
      if (!commonSet.has(m.slug)) continue
      const d = utcDay(m.marketStartMs)
      byDay.set(d, round4((byDay.get(d) ?? 0) + m.pnl))
    }
    return days.map((d) => byDay.get(d) ?? 0)
  })
  const positiveDayFraction = dailyPnl.map((series) =>
    days.length > 0 ? round4(series.filter((v) => v > 0).length / days.length) : null,
  )
  const correlations: Array<{ runA: number; runB: number; dailyPnlPearson: number | null }> = []
  for (let i = 0; i < perRun.length; i++)
    for (let j = i + 1; j < perRun.length; j++)
      correlations.push({
        runA: perRun[i]!.run.runId,
        runB: perRun[j]!.run.runId,
        dailyPnlPearson: pearson(dailyPnl[i]!, dailyPnl[j]!),
      })

  const result = {
    baseline: runs[0]!.runId,
    comparability: {
      sameStrategy,
      sameParams,
      isLatencySweep,
      strategies: [...new Set(runs.map((r) => r.strategy))],
      engineShasByRun: Object.fromEntries(perRun.map((p) => [p.run.runId, p.commitShas])),
      shaWarning,
    },
    universe: {
      common: common.length,
      perRunTotal: perRun.map((p) => p.markets.length),
      perRunOnly: onlyCounts,
    },
    runs: perRun.map((p, i) => ({
      runId: p.run.runId,
      strategy: p.run.strategy,
      params: p.run.params,
      latencyDelayMs: p.run.latencyDelayMs,
      latencyJitterMs: p.run.latencyJitterMs,
      batchUid: p.run.batchUid,
      status: p.run.status,
      unitsValid: (p.units as Units).unitsValid,
      fullRun: {
        markets: p.run.marketsPersisted,
        pnlTotal: p.headline?.pnl_total ?? null,
        evPerMarketTotal: p.headline?.ev_per_market_total ?? null,
      },
      commonUniverse: commonStats[i]!,
      deltaVsBaseline:
        i === 0
          ? null
          : {
              pnlTotal: round4(commonStats[i]!.pnlTotal - base.pnlTotal),
              evPerMarketTotal:
                commonStats[i]!.evPerMarketTotal !== null && base.evPerMarketTotal !== null
                  ? round4(commonStats[i]!.evPerMarketTotal - base.evPerMarketTotal)
                  : null,
              profitPer100:
                commonStats[i]!.profitPer100 !== null && base.profitPer100 !== null
                  ? round4(commonStats[i]!.profitPer100 - base.profitPer100)
                  : null,
              investedTotal: round4(commonStats[i]!.investedTotal - base.investedTotal),
            },
      positiveDayFraction: positiveDayFraction[i]!,
    })),
    daily: { days, pnlPerRun: dailyPnl },
    correlations,
    movers,
  }

  // Latency-sweep presentation order: ascending latency (baseline stays the
  // delta reference regardless of position).
  const displayOrder = isLatencySweep
    ? [...result.runs].sort((a, b) => (a.latencyDelayMs ?? 0) - (b.latencyDelayMs ?? 0))
    : result.runs

  if (o.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(
      `compare ${o.runIds.join(' vs ')} (baseline=${result.baseline})${isLatencySweep ? '  [LATENCY SWEEP]' : ''}`,
    )
    console.log(
      `strategy/params: ${sameStrategy && sameParams ? `IDENTICAL (${runs[0]!.strategy})` : sameStrategy ? `same strategy ${runs[0]!.strategy}, params DIFFER` : `strategies DIFFER: ${result.comparability.strategies.join(', ')}`}`,
    )
    console.log(
      `universe: common=${common.length}  per-run total=${result.universe.perRunTotal.join('/')}  per-run extra=${onlyCounts.join('/')}${common.length === 0 ? '  NO OVERLAP — deltas meaningless' : ''}`,
    )
    if (shaWarning) console.log(`WARNING: ${shaWarning}`)
    console.log('')
    console.log(
      'run    latency     markets  pnl(common)  ev/mkt    p/100    won/lost/flat  m/t trades  posDayFrac',
    )
    for (const r of displayOrder) {
      const c = r.commonUniverse
      console.log(
        `${String(r.runId).padEnd(7)}${String(r.latencyDelayMs !== null ? `${r.latencyDelayMs}/${r.latencyJitterMs}ms` : 'ENV?').padEnd(12)}${String(c.markets).padEnd(9)}${String(c.pnlTotal).padEnd(13)}${String(c.evPerMarketTotal ?? '-').padEnd(10)}${String(c.profitPer100 ?? '-').padEnd(9)}${String(`${c.won}/${c.lost}/${c.flat}`).padEnd(15)}${String(`${c.tradesMaker}/${c.tradesTaker}`).padEnd(12)}${r.positiveDayFraction ?? '-'}${r.unitsValid ? '' : '  UNITS-INVALID'}`,
      )
    }
    console.log('')
    for (const r of result.runs) {
      if (!r.deltaVsBaseline) continue
      const d = r.deltaVsBaseline
      console.log(
        `Δ run ${r.runId} vs ${result.baseline} (common universe): pnl ${sign(d.pnlTotal)}  ev/mkt ${sign(d.evPerMarketTotal)}  p/100 ${sign(d.profitPer100)}  invested ${sign(d.investedTotal)}`,
      )
    }
    if (movers.length > 0) {
      console.log('')
      console.log(`biggest per-market moves (run ${o.runIds[1]} − run ${o.runIds[0]}):`)
      for (const m of movers)
        console.log(`  ${m.slug.padEnd(30)} ${m.pnlA} → ${m.pnlB}  Δ ${sign(m.delta)}`)
    }
    if (days.length > 0) {
      console.log('')
      console.log(`daily pnl on common universe (${days.length} day${days.length > 1 ? 's' : ''}):`)
      console.log(`  day         ${result.runs.map((r) => String(r.runId).padEnd(10)).join('')}`)
      for (let d = 0; d < days.length; d++)
        console.log(`  ${days[d]}  ${dailyPnl.map((s) => String(s[d]).padEnd(10)).join('')}`)
      for (const c of correlations)
        console.log(
          `  corr(daily pnl) ${c.runA}~${c.runB}: ${c.dailyPnlPearson ?? 'n/a (<3 days or zero variance)'}`,
        )
    }
  }
} finally {
  await conn.end()
}

function sign(n: number | null): string {
  if (n === null) return '-'
  return n > 0 ? `+${n}` : String(n)
}
