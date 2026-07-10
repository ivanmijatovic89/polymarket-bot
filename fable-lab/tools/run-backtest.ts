/**
 * run-backtest.ts — the fable-lab backtest entry point.
 *
 * Why this exists (DECISIONS D7): the pre-commit hook allows commits only
 * inside fable-lab/, but the engine's strategyRegistry auto-discovers only
 * src/strategies/** (strategyRegistry.ts:24). Evidence runs must be on
 * committed code (CHARTER §Hard constraints 3). This wrapper closes the gap
 * without writing outside fable-lab/: it loads every strategy committed under
 * fable-lab/strategies/** into the in-process registry, then hands off to the
 * standard backtest CLI. Valid ONLY for --sequential runs (the whole replay
 * stays in this process; the BullMQ fleet path would re-resolve strategies in
 * worker processes that never run this wrapper) — --sequential is enforced.
 *
 * Usage (same args as `npm run backtest --`, --sequential required):
 *   npx tsx fable-lab/tools/run-backtest.ts --strategy fable-exp-001 \
 *     --input-mode telonex-delta ... --sequential --limit 10
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import '../../src/config/env.js'
import { strategyRegistry } from '../../src/strategy/strategyRegistry.js'
import type { StrategyDefinition } from '../../src/strategy/strategyDefinition.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FABLE_STRATEGIES_DIR = join(HERE, '..', 'strategies')
const requireStrategy = createRequire(import.meta.url)
const DEFINITION_EXPORT = /^export\s+const\s+definition\b/m

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile() && extname(entry.name) === '.ts' && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function isStrategyDefinition(x: unknown): x is StrategyDefinition<unknown> {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { id?: unknown }).id === 'string' &&
    typeof (x as { create?: unknown }).create === 'function' &&
    'schema' in (x as object)
  )
}

// --fill-mode worst_queue|touch_or_better (DECISIONS D18). touch_or_better
// switches the maker fill simulation to the engine's own optimistic
// at-touch model (BacktestExecution.ts, hardcoded unreachable from the
// CLI) via a prototype hook installed below. The flag is normalized to the
// single-token `--fill-mode=X` form and LEFT in argv: the engine parser
// silently ignores unknown `--x=y` tokens (backtestArgs.ts default case)
// but records them in the run's permanent `cmd` column — so the DB record
// of a touch run shows the fill mode. (The two-token form would leak the
// value into filePaths, so it is rewritten.) Optimistic-bound runs must
// also be unmistakable by label, so the batchUid must say so.
let fillMode: 'worst_queue' | 'touch_or_better' = 'worst_queue'
{
  let flagPresent = false
  let v: string | undefined
  const i = process.argv.indexOf('--fill-mode')
  if (i !== -1) {
    flagPresent = true
    v = process.argv[i + 1]
    process.argv.splice(i, 2)
  } else {
    const j = process.argv.findIndex((a) => a.startsWith('--fill-mode='))
    if (j !== -1) {
      flagPresent = true
      v = process.argv[j].slice('--fill-mode='.length)
      process.argv.splice(j, 1)
    }
  }
  if (flagPresent) {
    // Missing/invalid value is a hard error, never a silent worst_queue run
    // (audit AUDIT-2026-07-10-D18-UNLOCK finding 3.4).
    if (v !== 'worst_queue' && v !== 'touch_or_better') {
      console.error(`[fable] --fill-mode must be worst_queue or touch_or_better (got ${JSON.stringify(v)})`)
      process.exit(1)
    }
    fillMode = v
    process.argv.push(`--fill-mode=${v}`)
  }
  if (fillMode === 'touch_or_better') {
    const readArgValue = (flag: string): string | undefined => {
      const k = process.argv.indexOf(flag)
      if (k !== -1) return process.argv[k + 1]
      const eq = process.argv.find((a) => a.startsWith(`${flag}=`))
      return eq?.slice(flag.length + 1)
    }
    const extendId = readArgValue('--extend')
    if (extendId !== undefined) {
      // The engine forbids --batchUid with --extend, so the D18 label guard
      // checks the PARENT run instead (audit finding 3.2 — the original
      // guard made touch-mode extension unexecutable): the parent must
      // itself be a wrapper-launched touch run, by label AND by recorded
      // cmd. This also refuses extending a worst_queue run in touch mode
      // (audit 3.3, wrapper side).
      const { getDb, closeDb, backtestRuns } = await import('../../src/db/index.js')
      const { eq: eqOp } = await import('drizzle-orm')
      const db = getDb()
      const [parent] = await db
        .select({ batchUid: backtestRuns.batchUid, cmd: backtestRuns.cmd })
        .from(backtestRuns)
        .where(eqOp(backtestRuns.id, Number(extendId)))
      await closeDb()
      if (!parent) {
        console.error(`[fable] --extend ${extendId}: run not found`)
        process.exit(1)
      }
      if (!(parent.batchUid ?? '').includes('touch') || !(parent.cmd ?? '').includes('--fill-mode=touch_or_better')) {
        console.error(
          `[fable] --fill-mode touch_or_better with --extend ${extendId}: parent run is not a touch run (batchUid=${JSON.stringify(parent.batchUid)}); extending it in touch mode would mix fill models.`,
        )
        process.exit(1)
      }
    } else {
      const batchUid = readArgValue('--batchUid') ?? ''
      if (!batchUid.includes('touch')) {
        console.error(
          '[fable] --fill-mode touch_or_better requires a --batchUid containing "touch" (D18 label guard: optimistic-bound runs must be unmistakable in the DB).',
        )
        process.exit(1)
      }
    }
  }
}

// Sequential-only guard: in the BullMQ path the strategy would be resolved in
// worker processes where this wrapper never ran — the run would fail late or,
// worse, resolve a different strategy. Fail fast instead.
if (!process.argv.includes('--sequential')) {
  console.error(
    '[fable] run-backtest.ts supports --sequential only (fable-lab strategies are injected in-process; queue workers would not see them). Add --sequential.',
  )
  process.exit(1)
}

let loaded = 0
const files = existsSync(FABLE_STRATEGIES_DIR) ? walk(FABLE_STRATEGIES_DIR).sort() : []
for (const file of files) {
  if (!DEFINITION_EXPORT.test(readFileSync(file, 'utf8'))) continue
  const mod = requireStrategy(file) as Record<string, unknown>
  const def = mod.definition
  if (!isStrategyDefinition(def)) {
    throw new Error(`[fable] ${file} exports \`definition\` but it is not a valid StrategyDefinition`)
  }
  if (strategyRegistry[def.id]) {
    throw new Error(`[fable] duplicate strategy id ${JSON.stringify(def.id)} (in ${file})`)
  }
  strategyRegistry[def.id] = def
  loaded++
}
console.log(`[fable] injected ${loaded} fable-lab strategies into the registry`)

// Durable latency record (E19-chain audit, "unverifiable claims": the D8
// "latency pinned 0/0" assertion had no artifact to check against — env vars
// are not persisted in the run's cmd column). The run log is the durable
// artifact for timing/latency claims; print the effective values there.
// env.js is imported above so this shows what the engine will actually see
// (dotenv without BOT_ENV does not override values submit.ts pins in the
// child environment).
console.log(
  `[fable] latency env: BACKTEST_LATENCY_DELAY=${process.env.BACKTEST_LATENCY_DELAY ?? '(unset)'} BACKTEST_LATENCY_JITTER=${process.env.BACKTEST_LATENCY_JITTER ?? '(unset)'}`,
)

// Quality-column overflow guard (DECISIONS D12, LESSONS E13): a daily
// segment whose played markets have near-identical pnl produces
// q = avg/std ~ 1e9+, which overflows DECIMAL(14,6) and rolls back the
// ENTIRE final persist transaction (run 315 lost 2000 markets this way).
// computeQuality only guards std === 0 exactly. The engine is off-limits,
// but drizzle column objects are mutable — clamp at the driver boundary.
// A |q| of 1e6 carries the same decision information as 1e9 (both mean
// "degenerate, near-zero variance"); no protocol statistic distinguishes
// them.
{
  const { backtestRunSegments } = await import('../../src/db/schema.js')
  const Q_LIMIT = 1_000_000
  const clampColumn = (col: unknown) => {
    const c = col as { mapToDriverValue: (v: unknown) => unknown }
    const orig = c.mapToDriverValue.bind(c)
    // Values arrive as STRINGS: backtests.ts toDecimal() is String(value)
    // (learned from run 320 — the first, number-only clamp never fired).
    c.mapToDriverValue = (v: unknown) => {
      if (typeof v === 'number' || typeof v === 'string') {
        const n = Number(v)
        if (Number.isNaN(n)) return orig(v)
        if (!Number.isFinite(n)) return orig(null)
        if (Math.abs(n) > Q_LIMIT) {
          const clamped = Math.sign(n) * Q_LIMIT
          return orig(typeof v === 'string' ? String(clamped) : clamped)
        }
      }
      return orig(v)
    }
  }
  clampColumn(backtestRunSegments.qualitySystem)
  clampColumn(backtestRunSegments.qualityTrade)
}

// D18: touch_or_better fill-mode hook. runSingleMarket.ts constructs every
// BacktestExecution with a hardcoded makerFillMode: 'worst_queue'; the field
// is a plain writable runtime property (TS readonly is compile-time only).
// Hook the per-tick method rather than the constructor/field so the patch is
// insensitive to class-field define-vs-set semantics.
if (fillMode === 'touch_or_better') {
  const { BacktestExecution } = await import('../../src/trading/execution/BacktestExecution.js')
  const proto = BacktestExecution.prototype as unknown as {
    makerFillMode: string
    onMarketTick: (...a: unknown[]) => unknown
  }
  const orig = proto.onMarketTick
  let patched = 0
  proto.onMarketTick = function (this: { makerFillMode: string }, ...a: unknown[]) {
    if (this.makerFillMode !== 'touch_or_better') {
      this.makerFillMode = 'touch_or_better'
      patched++
      if (patched === 1) console.log('[fable] D18 fill-mode hook active: makerFillMode=touch_or_better (OPTIMISTIC BOUND — kill/escalate evidence only, never advance)')
    }
    return orig.apply(this, a)
  }
  process.on('exit', () => {
    console.log(`[fable] D18 fill-mode hook: ${patched} BacktestExecution instance(s) forced to touch_or_better`)
  })
}

// Hand off to the standard CLI with our wrapper path removed from argv, so
// parseBacktestArgs sees exactly what `npm run backtest --` would.
process.argv = [process.argv[0], join(HERE, '..', '..', 'src', 'cli', 'backtest.ts'), ...process.argv.slice(2)]
await import('../../src/cli/backtest.js')
