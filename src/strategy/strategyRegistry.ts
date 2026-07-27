import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StrategyDefinition } from './strategyDefinition.js'
import {
  DEFINITION_EXPORT,
  discoverProtocolStrategies,
  isStrategyDefinition,
  walkStrategyFiles,
} from './protocolStrategyDiscovery.js'

// Synchronous module loader. Using `require` (not dynamic `import`) lets the
// registry be built synchronously at module load, with NO top-level await —
// which keeps the module compatible with CJS-transformed contexts such as
// `tsx -e` and ad hoc inspection scripts. This assumes a tsx runtime (which
// transpiles .ts and handles require interop); a plain compiled-to-.js run on
// Node <22 would need dynamic import instead, since require() of an ES module
// is unsupported there.
const requireStrategy = createRequire(import.meta.url)

/**
 * The registry is built by auto-discovery: every file under src/strategies/**
 * (at any depth) that exports a `definition` is registered automatically. There
 * is no hand-maintained list — add a strategy by adding a file, remove one by
 * deleting its file. protocols/<name>/strategies/** is scanned the same way,
 * but fail-soft (see ./protocolStrategyDiscovery.ts).
 */

const selfPath = fileURLToPath(import.meta.url)
const STRATEGIES_DIR = join(dirname(selfPath), '..', 'strategies')

// Protocol workspaces (see protocols/README.md): each protocols/<name>/strategies/
// directory is also scanned. Protocol strategies load TOLERANTLY — a broken file
// is warned about and skipped, never fatal — because protocols push straight to
// main and self-updating workers must not be taken down by one experiment.
// Their ids must start with "<name>-" so protocols can't collide in the registry.
const PROTOCOLS_ROOT = join(dirname(selfPath), '..', '..', 'protocols')

function discoverStrategies(): Record<string, StrategyDefinition<unknown>> {
  const files = walkStrategyFiles(STRATEGIES_DIR).sort()
  const registry: Record<string, StrategyDefinition<unknown>> = {}

  for (const file of files) {
    // Cheap source check first — never load a file that isn't a strategy.
    if (!DEFINITION_EXPORT.test(readFileSync(file, 'utf8'))) continue

    let mod: Record<string, unknown>
    try {
      mod = requireStrategy(file) as Record<string, unknown>
    } catch (err) {
      throw new Error(`[strategy] failed to load ${file}: ${(err as Error).message}`)
    }

    // The file declared `export const definition` (matched above), so it is
    // meant to be a strategy. If its definition is malformed, fail loud rather
    // than silently dropping it — otherwise it surfaces much later as a
    // confusing "unknown strategy id" at run time.
    const def = mod.definition
    if (!isStrategyDefinition(def)) {
      throw new Error(
        `[strategy] ${file} looks like a strategy (exports \`definition\`) but it is not a valid ` +
          `StrategyDefinition — it needs a string \`id\`, a \`schema\`, and a \`create()\` function.`,
      )
    }

    if (registry[def.id]) {
      throw new Error(`[strategy] duplicate strategy id ${JSON.stringify(def.id)} (in ${file})`)
    }
    registry[def.id] = def
  }

  // Protocol strategies: fail-soft discovery with per-id conflict resolution
  // (see protocolStrategyDiscovery.ts). Core src/strategies/ ids always win.
  for (const { file, def } of discoverProtocolStrategies(PROTOCOLS_ROOT)) {
    if (registry[def.id]) {
      console.warn(
        `[strategy] skipping ${file}: duplicate strategy id ${JSON.stringify(def.id)} (already defined in src/strategies)`,
      )
      continue
    }
    registry[def.id] = def
  }

  return registry
}

/**
 * Built synchronously at module load (no top-level await), so the
 * getStrategyDefinition / listStrategies API stays synchronous and the module
 * works in CJS-transformed contexts (e.g. `tsx -e`).
 */
export const strategyRegistry: Record<string, StrategyDefinition<unknown>> = discoverStrategies()

export type StrategyId = string

export function getStrategyDefinition(id: string): StrategyDefinition<unknown> {
  const def = strategyRegistry[id]
  if (!def) throw new Error(`[strategy] unknown strategy id=${JSON.stringify(id)}`)
  return def
}

export function listStrategies(): StrategyDefinition<unknown>[] {
  return Object.values(strategyRegistry)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
}
