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

// Hand off to the standard CLI with our wrapper path removed from argv, so
// parseBacktestArgs sees exactly what `npm run backtest --` would.
process.argv = [process.argv[0], join(HERE, '..', '..', 'src', 'cli', 'backtest.ts'), ...process.argv.slice(2)]
await import('../../src/cli/backtest.js')
