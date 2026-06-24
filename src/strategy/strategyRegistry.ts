import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StrategyDefinition } from './strategyDefinition.js'

// Synchronous module loader. Using `require` (not dynamic `import`) lets the
// registry be built synchronously at module load, with NO top-level await —
// which keeps the module compatible with CJS-transformed contexts such as
// `tsx -e` and ad hoc inspection scripts. The project runs on tsx, which
// transpiles .ts for require; compiled runs require the emitted .js.
const requireStrategy = createRequire(import.meta.url)

/**
 * The registry is built by auto-discovery: every file under src/strategies/**
 * (at any depth) that exports a `definition` is registered automatically. There
 * is no hand-maintained list — add a strategy by adding a file, remove one by
 * deleting its file.
 */

const selfPath = fileURLToPath(import.meta.url)
const STRATEGIES_DIR = join(dirname(selfPath), '..', 'strategies')

// Load files with the SAME extension as this module: `.ts` under tsx (source),
// `.js` when running compiled. Avoids importing both copies of a file.
const EXT = extname(selfPath)

/**
 * A strategy file is recognised by this exact export, e.g.
 *   `export const definition: StrategyDefinition<Config> = { ... }`
 * We check the SOURCE for this before importing, so helper/CLI scripts (which
 * may have side effects or call process.exit on import) are never loaded.
 */
const DEFINITION_EXPORT = /^export\s+const\s+definition\b/m

/** Recursively collect strategy source files under src/strategies/ (any depth). */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
    } else if (entry.isFile() && extname(entry.name) === EXT && !entry.name.endsWith(`.d${EXT}`)) {
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

function discoverStrategies(): Record<string, StrategyDefinition<unknown>> {
  const files = walk(STRATEGIES_DIR).sort()
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

    const def = mod.definition
    if (!isStrategyDefinition(def)) continue

    if (registry[def.id]) {
      throw new Error(`[strategy] duplicate strategy id ${JSON.stringify(def.id)} (in ${file})`)
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
