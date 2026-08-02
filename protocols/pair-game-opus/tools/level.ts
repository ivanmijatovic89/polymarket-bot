/**
 * level.ts — the game evaluator. Read-only.
 *
 * Scores a persisted backtest run against a level of LEVELS.md using the
 * passing-market definition of RULES.md. This is the ONLY place a level is
 * declared passed; nothing else in the workspace may claim it.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-game-opus/tools/level.ts --level 1 --run 1071
 *   tsx protocols/pair-game-opus/tools/level.ts --level 6 --run 1080 --json
 *   tsx protocols/pair-game-opus/tools/level.ts --level 3 --plan     # slugs + qty only
 *
 * Level arithmetic (LEVELS.md):
 *   markets  = floor((L-1)/5) + 1
 *   quantity = [10, 50, 200, 1000, 3000][(L-1) mod 5]
 *
 * A market passes only when ALL of these hold (RULES.md "A passing market"):
 *   1. final UP shares    >= Q
 *   2. final DOWN shares  >= Q
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
 *   - the run's market set is EXACTLY the level's first-N universe;
 *   - no market skipped.
 */
import '../../../src/config/env.js'
import { listEligibleTelonexMarkets } from '../../../src/db/telonexMarkets.js'
import { openDb, fetchRunsByIds, fetchMarkets, type MarketRow } from './lib/runQueries.js'

const FLOOR_MS = 1775088000000 // 2026-04-02T00:00:00Z (RULES universe floor)
const QUANTITY_LADDER = [10, 50, 200, 1000, 3000] as const
const PAIR_CEILING = 0.98 // RULES
const REQUIRED_LATENCY_DELAY_MS = 140
const REQUIRED_LATENCY_JITTER_MS = 20
const PROTOCOL = 'pair-game-opus'

function fail(msg: string): never {
  console.error(`[level] ERROR: ${msg}`)
  process.exit(2)
}

export function levelSpec(level: number): { markets: number; qty: number } {
  if (!Number.isInteger(level) || level < 1 || level > 300)
    fail(`--level must be an integer in 1..300, got ${level}`)
  return {
    markets: Math.floor((level - 1) / 5) + 1,
    qty: QUANTITY_LADDER[(level - 1) % 5]!,
  }
}

type MarketVerdict = {
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

function scoreMarket(row: MarketRow, qty: number): MarketVerdict {
  const reasons: string[] = []
  const matched = Math.min(row.upShares, row.downShares)

  if (row.skipReason) reasons.push(`skipped(${row.skipReason})`)
  if (row.upShares < qty) reasons.push(`upShares ${row.upShares} < ${qty}`)
  if (row.downShares < qty) reasons.push(`downShares ${row.downShares} < ${qty}`)
  if (matched < qty) reasons.push(`matched ${matched} < ${qty}`)

  // Fee-inclusive pair cost, fees split pro-rata by notional.
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
    // Round to 1e-6 so float noise never fails an exactly-at-ceiling pair.
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

// ---------------------------------------------------------------------------

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
const spec = levelSpec(level)

const universe = await listEligibleTelonexMarkets({
  symbol: 'btc',
  timeframe: '15m',
  converter: 'delta-typed',
  readFrom: 'local-or-download-from-r2-to-local',
  fromMs: FLOOR_MS,
  limit: spec.markets,
})
const expectedSlugs = universe.map((m) => m.slug)
if (expectedSlugs.length !== spec.markets)
  fail(`universe has only ${expectedSlugs.length} eligible markets, level ${level} needs ${spec.markets}`)

if (plan) {
  const out = { level, ...spec, slugs: expectedSlugs }
  console.log(json ? JSON.stringify(out, null, 2) : `level ${level}: markets=${spec.markets} qty=${spec.qty}\n${expectedSlugs.join(',')}`)
  process.exit(0)
}
if (runIds.length === 0) fail('--run <id[,id...]> is required (or use --plan)')

const conn = await openDb()
try {
  const runs = await fetchRunsByIds(conn, runIds)
  if (runs.length !== runIds.length) {
    const found = new Set(runs.map((r) => r.runId))
    fail(`run id(s) not found: ${runIds.filter((id) => !found.has(id)).join(', ')}`)
  }

  const integrity: string[] = []
  const strategies = new Set<string>()
  const paramSets = new Set<string>()
  const rowsBySlug = new Map<string, MarketRow>()

  for (const run of runs) {
    if (run.status !== 'completed') integrity.push(`run ${run.runId} status=${run.status}`)
    if (run.failuresCount > 0) integrity.push(`run ${run.runId} failures=${run.failuresCount}`)
    if (run.protocol !== PROTOCOL) integrity.push(`run ${run.runId} protocol=${run.protocol}`)
    if (run.latencyDelayMs !== REQUIRED_LATENCY_DELAY_MS || run.latencyJitterMs !== REQUIRED_LATENCY_JITTER_MS)
      integrity.push(
        `run ${run.runId} latency=${run.latencyDelayMs}/${run.latencyJitterMs}ms, RULES require ${REQUIRED_LATENCY_DELAY_MS}/${REQUIRED_LATENCY_JITTER_MS}ms`,
      )
    strategies.add(run.strategy)
    paramSets.add(
      JSON.stringify(Object.entries(run.params).sort(([a], [b]) => a.localeCompare(b))),
    )
    for (const row of await fetchMarkets(conn, run.runId)) {
      if (rowsBySlug.has(row.slug)) integrity.push(`slug ${row.slug} appears in more than one run`)
      rowsBySlug.set(row.slug, row)
    }
  }

  // RULES: one strategy + one parameter configuration plays every market.
  if (strategies.size > 1) integrity.push(`mixed strategies: ${[...strategies].join(', ')}`)
  if (paramSets.size > 1) integrity.push(`mixed parameter configurations across runs`)

  const missing = expectedSlugs.filter((s) => !rowsBySlug.has(s))
  const extra = [...rowsBySlug.keys()].filter((s) => !expectedSlugs.includes(s))
  if (missing.length > 0) integrity.push(`missing markets: ${missing.join(', ')}`)
  if (extra.length > 0) integrity.push(`markets outside the level universe: ${extra.join(', ')}`)

  const verdicts = expectedSlugs
    .filter((s) => rowsBySlug.has(s))
    .map((s) => scoreMarket(rowsBySlug.get(s)!, spec.qty))

  const failed = verdicts.filter((v) => !v.pass)
  const pass = integrity.length === 0 && failed.length === 0 && verdicts.length === spec.markets

  const out = {
    level,
    markets: spec.markets,
    qty: spec.qty,
    runs: runs.map((r) => r.runId),
    strategy: [...strategies].join(','),
    params: runs[0]?.params ?? {},
    verdict: pass ? 'PASS' : 'FAIL',
    integrity,
    marketsPassed: verdicts.length - failed.length,
    marketsFailed: failed.length,
    results: verdicts,
  }

  if (json) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log(
      `LEVEL ${level} ${out.verdict} — markets=${spec.markets} qty=${spec.qty} runs=${out.runs.join(',')} strategy=${out.strategy}`,
    )
    console.log(`  params=${JSON.stringify(out.params)}`)
    for (const line of integrity) console.log(`  INTEGRITY: ${line}`)
    console.log(`  passed=${out.marketsPassed}/${verdicts.length}`)
    console.log('  slug                          up/down  matched  pairCost  pnl      fees   taker')
    for (const v of verdicts) {
      console.log(
        `  ${v.slug.padEnd(30)}${`${v.upShares}/${v.downShares}`.padEnd(9)}${String(v.matched).padEnd(9)}` +
          `${(v.pairCost === null ? '-' : v.pairCost.toFixed(4)).padEnd(10)}${v.pnl.toFixed(2).padEnd(9)}` +
          `${v.feesPaid.toFixed(2).padEnd(7)}${v.takerTrades}${v.pass ? '' : `  FAIL: ${v.reasons.join('; ')}`}`,
      )
    }
  }
  process.exit(pass ? 0 : 1)
} finally {
  await conn.end()
}
