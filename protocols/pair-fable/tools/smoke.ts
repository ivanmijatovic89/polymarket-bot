/**
 * smoke.ts — the mandatory pre-fleet local gate for pair-fable strategies.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/smoke.ts --strategy <id> [--param k=v ...]
 *       [--limit N] [--latest] [--json]
 *
 * What it does:
 *   1. For pair-fable strategies, runs `npm run protocol:check -- pair-fable`
 *      first — the registry loads protocol strategies FAIL-SOFT, so a broken
 *      file would otherwise surface only as a confusing "unknown strategy".
 *   2. Delegates to run-backtest.ts with --sequential --limit N (default 5):
 *      the canonical RULES-pinned launch, valid for UNPUSHED code (sequential
 *      runs skip the worker SHA gate).
 *   3. Prints SMOKE PASS/FAIL with the run id and headline stats; exit 0 only
 *      on PASS (run row exists, status completed, 0 failures, markets > 0).
 *
 * Mission rule: every new strategy passes this gate BEFORE any fleet
 * submission. A PASS means "the code runs and persists sane rows", not "the
 * strategy is good" — evaluation is results.ts / compare.ts territory.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx')
const RUN_BACKTEST = path.join(ROOT, 'protocols', 'pair-fable', 'tools', 'run-backtest.ts')

function fail(msg: string): never {
  console.error(`[smoke] ERROR: ${msg}`)
  process.exit(2)
}

// -- args -------------------------------------------------------------------
const argv = process.argv.slice(2)
let strategy: string | undefined
const passthrough: string[] = []
let limit = 5
let json = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!
  switch (a) {
    case '--strategy':
      strategy = argv[++i]
      break
    case '--param':
      passthrough.push('--param', argv[++i] ?? fail('--param requires key=value'))
      break
    case '--limit':
      limit = Number(argv[++i])
      if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        fail('--limit must be 1..20 (smoke is a small local gate, not an evaluation run)')
      break
    case '--latest':
      passthrough.push('--latest')
      break
    case '--json':
      json = true
      break
    default:
      fail(`unknown flag '${a}' (valid: --strategy --param --limit --latest --json)`)
  }
}
if (!strategy) fail('--strategy <id> is required')

// -- 1. protocol:check gate for pair-fable strategy files -------------------
let protocolCheck: 'passed' | 'skipped' = 'skipped'
if (strategy.startsWith('pair-fable-')) {
  console.error('[smoke] running npm run protocol:check -- pair-fable …')
  const r = spawnSync('npm', ['run', 'protocol:check', '--', 'pair-fable'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    process.stderr.write(r.stdout ?? '')
    process.stderr.write(r.stderr ?? '')
    console.log(json ? JSON.stringify({ verdict: 'FAIL', stage: 'protocol:check' }) : 'SMOKE FAIL (protocol:check)')
    process.exit(1)
  }
  protocolCheck = 'passed'
}

// -- 2. canonical sequential run via run-backtest.ts ------------------------
const child = spawnSync(
  TSX_BIN,
  [RUN_BACKTEST, '--strategy', strategy, '--limit', String(limit), '--sequential', '--label', 'smoke', '--json', ...passthrough],
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 },
)
let result: Record<string, unknown> | null = null
try {
  result = JSON.parse(child.stdout || 'null')
} catch {
  result = null
}

// -- 3. verdict -------------------------------------------------------------
const pass =
  child.status === 0 &&
  result !== null &&
  result.runId !== null &&
  result.status === 'completed' &&
  Number(result.failuresCount) === 0 &&
  Number(result.marketsPersisted) > 0

const out = {
  verdict: pass ? 'PASS' : 'FAIL',
  protocolCheck,
  strategy,
  limit,
  ...(result ?? { launcherExit: child.status }),
}
if (json) {
  console.log(JSON.stringify(out, null, 2))
} else {
  const h = (result?.headline ?? {}) as Record<string, unknown>
  const u = (result?.units ?? {}) as Record<string, unknown>
  console.log(
    [
      `SMOKE ${out.verdict} — strategy=${strategy} runId=${result?.runId ?? 'NOT-FOUND'} status=${result?.status ?? '-'}`,
      `markets=${result?.marketsPersisted ?? '-'} failures=${result?.failuresCount ?? '-'} protocolCheck=${protocolCheck}`,
      `pnl=${h.pnl_total ?? '-'} evPerMarketTotal=${h.ev_per_market_total ?? '-'} fees=${h.total_fees_paid ?? '-'} trades maker/taker=${h.trades_maker ?? '-'}/${h.trades_taker ?? '-'}`,
      `investedTotal=${u.investedTotal ?? '-'} profitPer100=${u.profitPer100 ?? '-'}`,
    ].join('\n'),
  )
}
process.exit(pass ? 0 : 1)
