/**
 * level.ts — the game evaluator. Read-only.
 *
 * Scores persisted backtest run(s) against a level of LEVELS.md using the
 * passing-market definition of RULES.md. This is the ONLY place a level may be
 * declared passed; nothing else in the workspace claims it.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-game-opus/tools/level.ts --level 1 --run 1071
 *   tsx protocols/pair-game-opus/tools/level.ts --level 6 --run 1080,1081 --json
 *   tsx protocols/pair-game-opus/tools/level.ts --level 3 --plan     # slugs + qty only
 *
 * A market passes only when ALL of these hold (RULES.md "A passing market"):
 *   1. final UP shares        >= Q
 *   2. final DOWN shares      >= Q
 *   3. matched = min(up,down) >= Q
 *   4. fee-inclusive cost of one matched pair <= 0.98
 *   5. settlement PnL for the market > 0
 *   6. rebates/rewards counted as zero (the engine never credits them)
 *
 * Pair cost (condition 4) is computed fee-inclusive per side. The engine stores
 * avg_entry_price_* EXCLUDING fees and fees_paid as one per-market total, so
 * fees are attributed to the two sides pro-rata by notional:
 *   feeSide  = feesPaid · notionalSide / notionalTotal
 *   avgSide' = (notionalSide + feeSide) / sharesSide
 *   pairCost = avgUp' + avgDown'
 * With an all-maker run feesPaid is 0 and this is exactly avgUp + avgDown.
 *
 * Run-level integrity checks (a failure here fails the level regardless of the
 * per-market numbers):
 *   - status completed, 0 failures;
 *   - latency pinned at 140/20 ms in the recorded cmd (RULES);
 *   - protocol tagged pair-game-opus;
 *   - one strategy and one parameter configuration across all runs;
 *   - the run's market set is EXACTLY the level's first-N universe;
 *   - no market skipped.
 */
import '../../../src/config/env.js'
import path from 'node:path'
import { openDb, fetchRunsByIds, fetchMarkets, fetchUnits, type MarketRow } from './lib/runQueries.js'
import {
  levelSpec,
  levelSlugs,
  PAIR_CEILING,
  PROTOCOL,
  REQUIRED_LATENCY_DELAY_MS,
  REQUIRED_LATENCY_JITTER_MS,
} from './lib/levels.js'

function fail(msg: string): never {
  console.error(`[level] ERROR: ${msg}`)
  process.exit(2)
}

export type MarketVerdict = {
  slug: string
  pass: boolean
  reasons: string[]
  upShares: number
  downShares: number
  matched: number
  pairCost: number | null
  pnl: number
  cost: number
  feesPaid: number
  takerTrades: number
}

export function scoreMarket(row: MarketRow, qty: number): MarketVerdict {
  const reasons: string[] = []
  const matched = Math.min(row.upShares, row.downShares)

  if (row.skipReason) reasons.push(`skipped(${row.skipReason})`)
  if (row.upShares < qty) reasons.push(`upShares ${row.upShares} < ${qty}`)
  if (row.downShares < qty) reasons.push(`downShares ${row.downShares} < ${qty}`)
  if (matched < qty) reasons.push(`matched ${matched} < ${qty}`)

  let pairCost: number | null = null
  const avgUp = row.avgEntryPriceUp
  const avgDown = row.avgEntryPriceDown
  if (avgUp === null || avgDown === null || row.upShares <= 0 || row.downShares <= 0) {
    reasons.push('no two-sided entry prices (a leg was never bought)')
  } else {
    const notionalUp = avgUp * row.upShares
    const notionalDown = avgDown * row.downShares
    const notionalTotal = notionalUp + notionalDown
    const feeUp = notionalTotal > 0 ? (row.feesPaid * notionalUp) / notionalTotal : 0
    const feeDown = notionalTotal > 0 ? (row.feesPaid * notionalDown) / notionalTotal : 0
    pairCost = (notionalUp + feeUp) / row.upShares + (notionalDown + feeDown) / row.downShares
    // Round to 1e-6 so float noise never fails a pair sitting exactly on the ceiling.
    if (Math.round(pairCost * 1e6) / 1e6 > PAIR_CEILING)
      reasons.push(`pairCost ${pairCost.toFixed(4)} > ${PAIR_CEILING}`)
  }

  if (!(row.pnl > 0)) reasons.push(`pnl ${row.pnl} <= 0`)

  return {
    slug: row.slug,
    pass: reasons.length === 0,
    reasons,
    upShares: row.upShares,
    downShares: row.downShares,
    matched,
    pairCost,
    pnl: row.pnl,
    cost: row.cost,
    feesPaid: row.feesPaid,
    takerTrades: row.tradeAsTaker,
  }
}

export type LevelReport = {
  level: number
  markets: number
  qty: number
  runs: number[]
  strategy: string
  params: Record<string, unknown>
  verdict: 'PASS' | 'FAIL'
  integrity: string[]
  marketsPassed: number
  marketsFailed: number
  results: MarketVerdict[]
}

/** Score persisted runs against a level. The single source of pass/fail truth. */
export async function scoreLevel(
  conn: Awaited<ReturnType<typeof openDb>>,
  level: number,
  runIds: number[],
): Promise<LevelReport> {
  const spec = levelSpec(level)
  const expectedSlugs = await levelSlugs(spec.markets)

  const runs = await fetchRunsByIds(conn, runIds)
  if (runs.length !== runIds.length) {
    const found = new Set(runs.map((r) => r.runId))
    throw new Error(`run id(s) not found: ${runIds.filter((id) => !found.has(id)).join(', ')}`)
  }

  const integrity: string[] = []
  const strategies = new Set<string>()
  const paramSets = new Set<string>()
  const rowsBySlug = new Map<string, MarketRow>()

  for (const run of runs) {
    if (run.status !== 'completed') integrity.push(`run ${run.runId} status=${run.status}`)
    if (run.failuresCount > 0) integrity.push(`run ${run.runId} failures=${run.failuresCount}`)
    if (run.protocol !== PROTOCOL) integrity.push(`run ${run.runId} protocol=${run.protocol}`)
    if (
      run.latencyDelayMs !== REQUIRED_LATENCY_DELAY_MS ||
      run.latencyJitterMs !== REQUIRED_LATENCY_JITTER_MS
    )
      integrity.push(
        `run ${run.runId} latency=${run.latencyDelayMs}/${run.latencyJitterMs}ms, RULES require ${REQUIRED_LATENCY_DELAY_MS}/${REQUIRED_LATENCY_JITTER_MS}ms`,
      )
    // RULES list the player's legal actions exhaustively: buy UP, buy DOWN,
    // cancel, do nothing, hold/merge/redeem. Minting pairs with split_positions
    // is NOT among them (and would acquire a pair at exactly 1.00 anyway).
    const units = await fetchUnits(conn, run.runId)
    if (!units.unitsValid) integrity.push(`run ${run.runId} used split_positions (split_cost != 0)`)
    strategies.add(run.strategy)
    paramSets.add(JSON.stringify(Object.entries(run.params).sort(([a], [b]) => a.localeCompare(b))))
    for (const row of await fetchMarkets(conn, run.runId)) {
      if (rowsBySlug.has(row.slug)) integrity.push(`slug ${row.slug} appears in more than one run`)
      rowsBySlug.set(row.slug, row)
    }
  }

  // RULES: one strategy + one parameter configuration plays every market.
  if (strategies.size > 1) integrity.push(`mixed strategies: ${[...strategies].join(', ')}`)
  if (paramSets.size > 1) integrity.push('mixed parameter configurations across runs')

  const missing = expectedSlugs.filter((s) => !rowsBySlug.has(s))
  const extra = [...rowsBySlug.keys()].filter((s) => !expectedSlugs.includes(s))
  if (missing.length > 0) integrity.push(`missing markets: ${missing.join(', ')}`)
  if (extra.length > 0) integrity.push(`markets outside the level universe: ${extra.join(', ')}`)

  const results = expectedSlugs
    .filter((s) => rowsBySlug.has(s))
    .map((s) => scoreMarket(rowsBySlug.get(s)!, spec.qty))
  const failedCount = results.filter((v) => !v.pass).length
  const pass = integrity.length === 0 && failedCount === 0 && results.length === spec.markets

  return {
    level,
    markets: spec.markets,
    qty: spec.qty,
    runs: runs.map((r) => r.runId),
    strategy: [...strategies].join(','),
    params: runs[0]?.params ?? {},
    verdict: pass ? 'PASS' : 'FAIL',
    integrity,
    marketsPassed: results.length - failedCount,
    marketsFailed: failedCount,
    results,
  }
}

export function printLevelReport(r: LevelReport, opts?: { maxRows?: number }): void {
  const maxRows = opts?.maxRows ?? 40
  console.log(
    `LEVEL ${r.level} ${r.verdict} — markets=${r.markets} qty=${r.qty} runs=${r.runs.join(',')} strategy=${r.strategy}`,
  )
  console.log(`  params=${JSON.stringify(r.params)}`)
  for (const line of r.integrity) console.log(`  INTEGRITY: ${line}`)
  console.log(`  passed=${r.marketsPassed}/${r.results.length}`)
  const rows = r.verdict === 'PASS' ? r.results.slice(0, maxRows) : r.results.filter((v) => !v.pass).slice(0, maxRows)
  if (r.verdict !== 'PASS') console.log('  failing markets:')
  console.log('  slug                          up/down        matched  pairCost  pnl        fees   taker')
  for (const v of rows) {
    console.log(
      `  ${v.slug.padEnd(30)}${`${v.upShares}/${v.downShares}`.padEnd(15)}${String(v.matched).padEnd(9)}` +
        `${(v.pairCost === null ? '-' : v.pairCost.toFixed(4)).padEnd(10)}${v.pnl.toFixed(2).padEnd(11)}` +
        `${v.feesPaid.toFixed(2).padEnd(7)}${v.takerTrades}${v.pass ? '' : `  FAIL: ${v.reasons.join('; ')}`}`,
    )
  }
  const shown = rows.length
  const total = r.verdict === 'PASS' ? r.results.length : r.marketsFailed
  if (shown < total) console.log(`  … ${total - shown} more row(s) not shown`)
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

// basename equality, not endsWith: 'play-level.ts' also ends with 'level.ts'.
const isMain = path.basename(process.argv[1] ?? '') === 'level.ts'
if (isMain) {
  const argv = process.argv.slice(2)
  let level: number | undefined
  let runIds: number[] = []
  let json = false
  let plan = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    switch (a) {
      case '--level':
        level = Number(argv[++i])
        break
      case '--run':
        runIds = String(argv[++i] ?? '')
          .split(',')
          .map((s) => {
            const n = Number(s.trim())
            if (!Number.isInteger(n) || n <= 0) fail(`--run expects positive ids, got '${s}'`)
            return n
          })
        break
      case '--json':
        json = true
        break
      case '--plan':
        plan = true
        break
      default:
        fail(`unknown flag '${a}' (valid: --level --run --plan --json)`)
    }
  }
  if (level === undefined) fail('--level <1..300> is required')

  if (plan) {
    const spec = levelSpec(level)
    const slugs = await levelSlugs(spec.markets)
    console.log(
      json
        ? JSON.stringify({ ...spec, slugs }, null, 2)
        : `level ${level}: markets=${spec.markets} qty=${spec.qty}\n${slugs.join(',')}`,
    )
    process.exit(0)
  }
  if (runIds.length === 0) fail('--run <id[,id...]> is required (or use --plan)')

  const conn = await openDb()
  try {
    const report = await scoreLevel(conn, level, runIds)
    if (json) console.log(JSON.stringify(report, null, 2))
    else printLevelReport(report)
    process.exit(report.verdict === 'PASS' ? 0 : 1)
  } finally {
    await conn.end()
  }
}
