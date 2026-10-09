import '../../config/env.js'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { closeDb } from '../../db/index.js'
import { DEFAULT_DATA_ROOT, REPO_ROOT } from '../../backtest/parity/cell.js'
import { dateMsArg, intArg, one, paramArgs, parseArgv } from '../../backtest/parity/cliArgs.js'
import {
  pickEdgeMarkets,
  scanMarketEdges,
  unmatchedCriteria,
  type EdgeCounters,
} from '../../backtest/parity/edgeScan.js'
import {
  listParityCandidates,
  localInputProblem,
  resolveParityStrategy,
  seededShuffle,
  stratifiedByMonth,
  type StratifiedCandidate,
} from '../../backtest/parity/marketJob.js'
import { PARITY_DIR, resolvePin } from '../../backtest/parity/oracle.js'
import { externalFeedsRequest } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'

const USAGE = `Usage (from the repository root):
  npx tsx scripts/parity/select-set.ts --set <name> --strategy <id> [--param k=v ...]
      --from <ISO date> [--to <ISO date>] --per-month <n> --seed <n>
      [--edge <minimum edge markets, MS-3: 10>] [--edge-scan <sample size> [--edge-per-criterion 2]
      [--edge-scan-cache <file>]] [--timeframe 15m|5m] [--data-root <repo>/data] [--dry-run]

Selects a committed parity market set native/parity/sets/<name>.txt
(native/spec/60-verification.md §4.2): seeded random through
listEligibleTelonexMarkets with the strategy's required feeds (MS-2, read-only
on MySQL), stratified by calendar month, local inputs only (MS-5: a market
whose telonex-delta or feed day files are missing, or whose local file size
differs from the catalog (D64), is replaced by the next seeded market and
recorded with the reason), plus MS-3 edge markets: with --edge-scan N a
seeded sample of N candidates is replayed and --edge-per-criterion markets are
taken per criterion; otherwise --edge markets with the largest and smallest
input files (proxy for most/fewest events).`

// 11 §5.3 dated fee eras (market start), used only to report era coverage (MS-2).
const FEE_ERAS: Array<{ id: string; fromMs: number }> = [
  { id: 'F0', fromMs: Number.NEGATIVE_INFINITY },
  { id: 'F1', fromMs: 1767571200000 },
  { id: 'F2', fromMs: 1774828800000 },
  { id: 'F3', fromMs: 1778198400000 },
]

function feeEra(ms: number): string {
  let era = 'F0'
  for (const e of FEE_ERAS) if (ms >= e.fromMs) era = e.id
  return era
}

async function main(): Promise<number> {
  const p = parseArgv(process.argv.slice(2), {
    values: [
      'set',
      'strategy',
      'param',
      'from',
      'to',
      'per-month',
      'seed',
      'edge',
      'edge-scan',
      'edge-per-criterion',
      'edge-scan-cache',
      'data-root',
      'timeframe',
    ],
    switches: ['dry-run', 'help'],
  })
  if (p.switches.has('help')) {
    console.log(USAGE)
    return 0
  }
  const set = one(p, 'set')
  const strategyId = one(p, 'strategy')
  const fromMs = dateMsArg(p, 'from')
  const toMs = dateMsArg(p, 'to')
  if (
    !set ||
    !/^[A-Za-z0-9-]+$/.test(set) ||
    !strategyId ||
    fromMs === undefined ||
    one(p, 'per-month') === undefined ||
    one(p, 'seed') === undefined
  )
    throw new Error(`missing --set/--strategy/--from/--per-month/--seed\n\n${USAGE}`)
  const perMonth = intArg(p, 'per-month', 0)
  const seed = intArg(p, 'seed', 0)
  const edge = intArg(p, 'edge', 0)
  const dataRoot = path.resolve(one(p, 'data-root') ?? DEFAULT_DATA_ROOT)
  const params = paramArgs(p)
  const built = await resolveParityStrategy({ strategyId, rawParams: params }, dataRoot)
  const requiredFeeds = externalFeedsRequest(built)
  const timeframe = one(p, 'timeframe') ?? '15m'
  if (timeframe !== '15m' && timeframe !== '5m')
    throw new Error(`--timeframe ${timeframe}: expected 15m or 5m (sets S15*, SL, S5)`)
  const candidates = await listParityCandidates({
    symbol: 'btc',
    timeframe,
    fromMs,
    ...(toMs !== undefined ? { toMs } : {}),
    requiredFeeds,
    dataRoot,
  })
  await closeDb()
  if (candidates.length === 0) throw new Error('no eligible candidates')
  // MS-5 / D64: the reason each replaced market is not a trusted local input.
  const problems = new Map<string, string>()
  const hasLocal = (c: StratifiedCandidate) => {
    const why = localInputProblem(c, requiredFeeds, dataRoot)
    if (why !== null) problems.set(c.slug, why)
    return why === null
  }
  const { selected, replaced, months } = stratifiedByMonth(candidates, perMonth, seed, hasLocal)
  const chosen = new Set(selected.map((c) => c.slug))
  // MS-3 edge markets. With --edge-scan N: replay a seeded sample of N
  // remaining local candidates and take --edge-per-criterion markets per
  // criterion (most/fewest events, crossed books, clocks backwards, deltas
  // before the first book, missing best price at start). Without it: the
  // largest and smallest input files (proxy for most/fewest events).
  const rest = candidates.filter((c) => !chosen.has(c.slug) && hasLocal(c))
  let edges: Array<{ c: StratifiedCandidate; why: string }>
  let missingCriteria: string[] = []
  const scanN = one(p, 'edge-scan') !== undefined ? intArg(p, 'edge-scan', 0) : 0
  if (scanN > 0) {
    // The seeded sample plus the 5 largest and 5 smallest input files, so the
    // most/fewest-events criteria see the extremes of the whole range.
    const bySize = rest
      .map((c) => ({ c, bytes: statSync(c.localPath).size }))
      .sort((a, b) => a.bytes - b.bytes || a.c.slug.localeCompare(b.c.slug))
    const extremes = [...bySize.slice(0, 5), ...bySize.slice(-5)].map((x) => x.c)
    const seeded = seededShuffle(rest, seed + 1000).slice(0, scanN)
    const sample = [...new Map([...seeded, ...extremes].map((c) => [c.slug, c] as const)).values()]
    // --edge-scan-cache <file> (outside the repo) keeps the counters per slug,
    // so a re-selection does not replay the sample again.
    const cacheFile = one(p, 'edge-scan-cache')
    const cached = new Map<string, EdgeCounters>(
      cacheFile && existsSync(cacheFile)
        ? Object.entries(
            JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, EdgeCounters>,
          )
        : [],
    )
    const scanned: Array<{ slug: string; counters: EdgeCounters }> = []
    let i = 0
    for (const c of sample) {
      if (!c.assets || c.assets.length !== 2)
        throw new Error(`${c.slug}: catalog has no outcome token ids`)
      const counters =
        cached.get(c.slug) ?? (await scanMarketEdges(c.localPath, c.marketStartMs, c.assets))
      cached.set(c.slug, counters)
      scanned.push({ slug: c.slug, counters })
      if (++i % 25 === 0) console.error(`[select-set] edge scan ${i}/${sample.length}`)
    }
    if (cacheFile) writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(cached)))
    const per = intArg(p, 'edge-per-criterion', 2)
    missingCriteria = unmatchedCriteria(scanned)
    const bySlug = new Map(rest.map((c) => [c.slug, c] as const))
    edges = pickEdgeMarkets(scanned, per, chosen, edge).map((e) => ({
      c: bySlug.get(e.slug)!,
      why: `${e.criterion}: ${JSON.stringify(e.counters)}`,
    }))
  } else {
    const sized = rest
      .map((c) => ({ c, bytes: statSync(c.localPath).size }))
      .sort((a, b) => a.bytes - b.bytes || a.c.slug.localeCompare(b.c.slug))
    const half = Math.floor(edge / 2)
    edges = [
      ...sized
        .slice(-(edge - half))
        .map((x) => ({ c: x.c, why: `largest input file, ${x.bytes} B` })),
      ...sized.slice(0, half).map((x) => ({ c: x.c, why: `smallest input file, ${x.bytes} B` })),
    ].slice(0, edge)
  }
  const all = [...selected, ...edges.map((e) => e.c)].sort(
    (a, b) => a.marketStartMs - b.marketStartMs,
  )
  const eras: Record<string, number> = {}
  for (const c of all) eras[feeEra(c.marketStartMs)] = (eras[feeEra(c.marketStartMs)] ?? 0) + 1
  const first = new Date(candidates[0]!.marketStartMs).toISOString()
  const last = new Date(candidates.at(-1)!.marketStartMs).toISOString()
  const pin = resolvePin()
  const header = [
    `# Parity market set ${set} (native/spec/60-verification.md §4.2 MS-0..MS-5)`,
    `# Selection command: npx tsx scripts/parity/select-set.ts ${process.argv.slice(2).join(' ')}`,
    `# Seed: ${seed}; per month: ${perMonth}; minimum edge markets: ${edge}`,
    `# Eligibility (MS-2): listEligibleTelonexMarkets ${JSON.stringify({ symbol: 'btc', timeframe, converter: 'delta-typed', readFrom: 'local', requiredFeeds, fromMs, toMs: toMs ?? null })}`,
    `# Eligible candidates: ${candidates.length}, market starts ${first} .. ${last} (the range ends where the local Telonex catalog ends, D38)`,
    `# Stratification (calendar month, UTC): ${Object.entries(months)
      .map(([m, n]) => `${m}=${n}`)
      .join(' ')}`,
    `# Fee eras (11 §5.3): ${Object.entries(eras)
      .sort()
      .map(([e, n]) => `${e}=${n}`)
      .join(' ')}`,
    `# MS-3 edge markets (${scanN > 0 ? `replay scan of ${scanN} seeded candidates plus the 5 largest and 5 smallest input files` : 'proxy: input file size'}): ${edges.length}`,
    ...edges.map((e) => `#   ${e.c.slug} -- ${e.why}`),
    ...(missingCriteria.length > 0
      ? [`# MS-3 criteria with no market in the scan: ${missingCriteria.join('; ')}`]
      : []),
    `# MS-5 replaced (missing local input or feed day file, or a local size that differs from the catalog, D64): ${replaced.length}`,
    ...replaced.map((slug) => `#   ${slug} -- ${problems.get(slug) ?? '?'}`),
    `# Oracle pin: ${pin}`,
    `# Date: ${new Date().toISOString().slice(0, 10)}`,
    `# Markets: ${all.length}`,
  ]
  const body = header.join('\n') + '\n' + all.map((c) => c.slug).join('\n') + '\n'
  const out = path.join(PARITY_DIR, 'sets', `${set}.txt`)
  if (p.switches.has('dry-run')) process.stdout.write(body)
  else {
    writeFileSync(out, body)
    console.error(`[select-set] ${all.length} markets -> ${path.relative(REPO_ROOT, out)}`)
  }
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(async (err: unknown) => {
    console.error(`[select-set] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    await closeDb().catch(() => {})
    process.exitCode = 2
  })
