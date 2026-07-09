/**
 * results.ts — the canonical decisive readout for an experiment run.
 *
 * Pulls a backtest run's per-market rows + segments from MySQL and prints
 * the statistics the protocol decides on (EPISTEMOLOGY.md): N, q, t,
 * EV/market ± 95% CI, composition, and time stability. Read-only.
 *
 * Every decisive readout in an experiment file must be this tool's output,
 * pasted verbatim (LIFECYCLE.md §4).
 *
 * Usage:
 *   npx tsx fable-lab/tools/results.ts --run <id> [--json]
 *   npx tsx fable-lab/tools/results.ts --batch <batchUid> [--json]
 */
import { eq } from 'drizzle-orm'
import {
  getDb,
  closeDb,
  backtestRuns,
  backtestRunMarkets,
  backtestRunFailures,
} from '../../src/db/index.js'
import { getBacktestRunById, getBacktestRunByBatchUid } from '../../src/db/backtests.js'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

type MarketRow = {
  slug: string
  marketStartMs: number | null
  pnl: number
  tradeCount: number
  tradeAsMaker: number
  tradeAsTaker: number
  feesPaid: number
  skipReason: string | null
  finalOutcome: string | null
}

async function loadRun() {
  const runIdArg = argValue('--run')
  const batchArg = argValue('--batch')
  if (!runIdArg && !batchArg) {
    throw new Error('pass --run <id> or --batch <batchUid>')
  }
  const run = runIdArg
    ? await getBacktestRunById(Number(runIdArg))
    : await getBacktestRunByBatchUid(String(batchArg))
  if (!run) {
    throw new Error(`run not found (${runIdArg ?? batchArg})`)
  }
  return run
}

async function main() {
  const run = await loadRun()
  const db = getDb()
  // BacktestRunRecord doesn't expose input mode/converter/readFrom — read the raw row
  const [rawRun] = await db
    .select({
      inputMode: backtestRuns.inputMode,
      converter: backtestRuns.converter,
      readFrom: backtestRuns.readFrom,
    })
    .from(backtestRuns)
    .where(eq(backtestRuns.id, run.id))
    .limit(1)
  const rows = await db
    .select({
      slug: backtestRunMarkets.slug,
      marketStartMs: backtestRunMarkets.marketStartMs,
      pnl: backtestRunMarkets.pnl,
      tradeCount: backtestRunMarkets.tradeCount,
      tradeAsMaker: backtestRunMarkets.tradeAsMaker,
      tradeAsTaker: backtestRunMarkets.tradeAsTaker,
      feesPaid: backtestRunMarkets.feesPaid,
      skipReason: backtestRunMarkets.skipReason,
      finalOutcome: backtestRunMarkets.finalOutcome,
    })
    .from(backtestRunMarkets)
    .where(eq(backtestRunMarkets.runId, run.id))
  const failures = await db
    .select({ slug: backtestRunFailures.slug, reason: backtestRunFailures.reason })
    .from(backtestRunFailures)
    .where(eq(backtestRunFailures.runId, run.id))

  const markets: MarketRow[] = rows.map((r) => ({
    slug: r.slug,
    marketStartMs: r.marketStartMs == null ? null : Number(r.marketStartMs),
    pnl: Number(r.pnl ?? 0),
    tradeCount: Number(r.tradeCount ?? 0),
    tradeAsMaker: Number(r.tradeAsMaker ?? 0),
    tradeAsTaker: Number(r.tradeAsTaker ?? 0),
    feesPaid: Number(r.feesPaid ?? 0),
    skipReason: r.skipReason,
    finalOutcome: r.finalOutcome,
  }))

  const n = markets.length
  if (n === 0) {
    console.log(`run ${run.id} (${run.batchUid}): no per-market rows persisted`)
    return
  }

  const pnls = markets.map((m) => m.pnl)
  const mean = sum(pnls) / n
  const sd = stddev(pnls, mean)
  const q = sd > 0 ? mean / sd : null
  const t = q != null ? q * Math.sqrt(n) : null
  const se = sd / Math.sqrt(n)
  const ci95: [number, number] = [mean - 1.96 * se, mean + 1.96 * se]

  const played = markets.filter((m) => m.tradeCount > 0)
  const won = played.filter((m) => m.pnl > 0).length
  const lost = played.filter((m) => m.pnl < 0).length
  const totalFees = sum(markets.map((m) => m.feesPaid))
  const grossPositive = sum(pnls.filter((p) => p > 0))
  const makerTrades = sum(markets.map((m) => m.tradeAsMaker))
  const takerTrades = sum(markets.map((m) => m.tradeAsTaker))

  // time stability: UTC-day buckets over market_start_ms
  const byDay = new Map<string, number>()
  for (const m of markets) {
    if (m.marketStartMs == null) continue
    const day = new Date(m.marketStartMs).toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + m.pnl)
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const positiveDays = days.filter(([, p]) => p > 0).length
  const bestDay = days.reduce((a, b) => (b[1] > a[1] ? b : a), days[0])
  const worstDay = days.reduce((a, b) => (b[1] < a[1] ? b : a), days[0])
  const sortedByPnl = [...markets].sort((a, b) => a.pnl - b.pnl)

  const report = {
    runId: run.id,
    batchUid: run.batchUid,
    strategy: run.strategy,
    params: run.params,
    status: run.status,
    inputMode: rawRun?.inputMode ?? null,
    converter: rawRun?.converter ?? null,
    readFrom: rawRun?.readFrom ?? null,
    createdAt: run.createdAt,
    N: n,
    played: played.length,
    skipped: n - played.length,
    skipReasons: countBy(markets.filter((m) => m.tradeCount === 0), (m) => m.skipReason ?? 'no_trades'),
    failures: failures.length,
    pnlTotal: round4(sum(pnls)),
    evPerMarket: round4(mean),
    evCi95: [round4(ci95[0]), round4(ci95[1])],
    pnlStd: round4(sd),
    quality_q: q != null ? round4(q) : null,
    t_stat: t != null ? round4(t) : null,
    winRatePlayed: played.length ? round4(won / played.length) : null,
    wonLost: `${won}/${lost}`,
    feesTotal: round4(totalFees),
    feeShareOfGrossWins: grossPositive > 0 ? round4(totalFees / grossPositive) : null,
    makerTrades,
    takerTrades,
    makerShare: makerTrades + takerTrades > 0 ? round4(makerTrades / (makerTrades + takerTrades)) : null,
    days: days.length,
    positiveDayFrac: days.length ? round4(positiveDays / days.length) : null,
    bestDay: bestDay ? { day: bestDay[0], pnl: round4(bestDay[1]) } : null,
    worstDay: worstDay ? { day: worstDay[0], pnl: round4(worstDay[1]) } : null,
    worst5Markets: sortedByPnl.slice(0, 5).map((m) => ({ slug: m.slug, pnl: round4(m.pnl) })),
    best5Markets: sortedByPnl.slice(-5).reverse().map((m) => ({ slug: m.slug, pnl: round4(m.pnl) })),
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`=== results: run ${report.runId}  batch ${report.batchUid} ===`)
  console.log(`strategy ${report.strategy}  params ${JSON.stringify(report.params)}`)
  console.log(`status ${report.status}  mode ${report.inputMode}/${report.converter}/${report.readFrom}`)
  console.log(`N=${report.N}  played=${report.played}  skipped=${report.skipped}  failures=${report.failures}`)
  console.log(`pnlTotal=${report.pnlTotal}  EV/market=${report.evPerMarket}  CI95=[${report.evCi95[0]}, ${report.evCi95[1]}]`)
  console.log(`std=${report.pnlStd}  q=${report.quality_q}  t=${report.t_stat}`)
  console.log(`winRate(played)=${report.winRatePlayed} (${report.wonLost})`)
  console.log(`fees=${report.feesTotal}  fee/grossWins=${report.feeShareOfGrossWins}  maker/taker=${report.makerTrades}/${report.takerTrades} (makerShare=${report.makerShare})`)
  console.log(`days=${report.days}  positiveDayFrac=${report.positiveDayFrac}  best=${fmtDay(report.bestDay)}  worst=${fmtDay(report.worstDay)}`)
  console.log(`worst5: ${report.worst5Markets.map((m) => `${m.slug}:${m.pnl}`).join('  ')}`)
  console.log(`best5:  ${report.best5Markets.map((m) => `${m.slug}:${m.pnl}`).join('  ')}`)
}

function fmtDay(d: { day: string; pnl: number } | null): string {
  return d ? `${d.day}:${d.pnl}` : 'n/a'
}
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}
function stddev(xs: number[], mean: number): number {
  if (xs.length < 2) return 0
  const v = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}
function countBy<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1
  return out
}
function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
