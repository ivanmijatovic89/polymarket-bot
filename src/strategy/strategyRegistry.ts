import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StrategyDefinition } from './strategyDefinition.js'

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
 * but fail-soft (see PROTOCOLS_ROOT below).
 */

const selfPath = fileURLToPath(import.meta.url)
const STRATEGIES_DIR = join(dirname(selfPath), '..', 'strategies')

// Protocol workspaces (see protocols/README.md): each protocols/<name>/strategies/
// directory is also scanned. Protocol strategies load TOLERANTLY — a broken file
// is warned about and skipped, never fatal — because protocols push straight to
// main and self-updating workers must not be taken down by one experiment.
// Their ids must start with "<name>-" so protocols can't collide in the registry.
const PROTOCOLS_ROOT = join(dirname(selfPath), '..', '..', 'protocols')

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

/** protocols/<name>/strategies/ directories that exist, with their protocol name. */
function protocolStrategyDirs(): { protocol: string; dir: string }[] {
  if (!existsSync(PROTOCOLS_ROOT)) return []
  const out: { protocol: string; dir: string }[] = []
  for (const entry of readdirSync(PROTOCOLS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(PROTOCOLS_ROOT, entry.name, 'strategies')
    if (existsSync(dir)) out.push({ protocol: entry.name, dir })
  }
  return out.sort((a, b) => a.protocol.localeCompare(b.protocol))
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

  // Protocol strategies: same discovery, but every failure warns and skips
  // (fail-soft) instead of throwing — a protocol may only break itself.
  for (const { protocol, dir } of protocolStrategyDirs()) {
    for (const file of walk(dir).sort()) {
      try {
        if (!DEFINITION_EXPORT.test(readFileSync(file, 'utf8'))) continue
        const mod = requireStrategy(file) as Record<string, unknown>
        const def = mod.definition
        if (!isStrategyDefinition(def)) {
          console.warn(
            `[strategy] skipping ${file}: exports \`definition\` but it is not a valid StrategyDefinition`,
          )
          continue
        }
        if (!def.id.startsWith(`${protocol}-`)) {
          console.warn(
            `[strategy] skipping ${file}: id ${JSON.stringify(def.id)} must start with "${protocol}-" (protocol strategy ids are namespaced by folder)`,
          )
          continue
        }
        if (registry[def.id]) {
          console.warn(
            `[strategy] skipping ${file}: duplicate strategy id ${JSON.stringify(def.id)}`,
          )
          continue
        }
        registry[def.id] = def
      } catch (err) {
        console.warn(
          `[strategy] skipping ${basename(file)} (${protocol}): failed to load — ${(err as Error).message}`,
        )
      }
    }
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
