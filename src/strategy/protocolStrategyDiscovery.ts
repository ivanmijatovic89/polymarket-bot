import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StrategyDefinition } from './strategyDefinition.js'

/**
 * Discovery of protocol-workspace strategies (protocols/<name>/strategies/**,
 * see protocols/README.md). Kept separate from strategyRegistry so it has no
 * import-time side effects and can be tested against fixture directories.
 *
 * Everything here is FAIL-SOFT: protocols push straight to main and
 * self-updating workers must never be taken down by one broken experiment, so
 * any bad file/dir warns and is skipped instead of throwing.
 */

const requireStrategy = createRequire(import.meta.url)

const selfPath = fileURLToPath(import.meta.url)

// Load files with the SAME extension as this module: `.ts` under tsx (source),
// `.js` when running compiled. Avoids importing both copies of a file.
export const STRATEGY_FILE_EXT = extname(selfPath)

/**
 * A strategy file is recognised by this exact export, e.g.
 *   `export const definition: StrategyDefinition<Config> = { ... }`
 * The SOURCE is checked for this before importing, so helper/CLI scripts
 * (which may have side effects or call process.exit on import) are never
 * loaded.
 */
export const DEFINITION_EXPORT = /^export\s+const\s+definition\b/m

/** Recursively collect strategy source files under a directory (any depth). */
export function walkStrategyFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkStrategyFiles(full))
    } else if (
      entry.isFile() &&
      extname(entry.name) === STRATEGY_FILE_EXT &&
      !entry.name.endsWith(`.d${STRATEGY_FILE_EXT}`)
    ) {
      out.push(full)
    }
  }
  return out
}

export function isStrategyDefinition(x: unknown): x is StrategyDefinition<unknown> {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { id?: unknown }).id === 'string' &&
    typeof (x as { create?: unknown }).create === 'function' &&
    'schema' in (x as object)
  )
}

export interface ProtocolStrategy {
  protocol: string
  file: string
  def: StrategyDefinition<unknown>
}

/**
 * Strategy directories under `protocolsRoot`, with their owner (namespace) name:
 *
 * - `<root>/<name>/strategies/`            → owner `<name>`
 * - `<root>/<name>/models/<seat>/strategies/` → owner `<name>-<seat>`
 *
 * The `models/<seat>/` layout is for multi-model protocols (see
 * protocols/README.md): each seat is a competitor's self-contained workspace,
 * and its strategy ids are namespaced `<name>-<seat>-*`.
 */
function protocolStrategyDirs(protocolsRoot: string): { protocol: string; dir: string }[] {
  const out: { protocol: string; dir: string }[] = []
  // Fail-soft: any fs surprise here (protocols/ missing, a `strategies` entry
  // that is not a directory, permissions, a dir vanishing mid-scan) must never
  // take the registry down with it.
  try {
    for (const entry of readdirSync(protocolsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(protocolsRoot, entry.name, 'strategies')
      if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
        out.push({ protocol: entry.name, dir })
      }
      const modelsDir = join(protocolsRoot, entry.name, 'models')
      if (statSync(modelsDir, { throwIfNoEntry: false })?.isDirectory()) {
        for (const seat of readdirSync(modelsDir, { withFileTypes: true })) {
          if (!seat.isDirectory()) continue
          const seatDir = join(modelsDir, seat.name, 'strategies')
          if (statSync(seatDir, { throwIfNoEntry: false })?.isDirectory()) {
            out.push({ protocol: `${entry.name}-${seat.name}`, dir: seatDir })
          }
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[strategy] skipping protocol discovery: ${(err as Error).message}`)
    }
    return []
  }
  return out.sort((a, b) => a.protocol.localeCompare(b.protocol))
}

/**
 * Discover all protocol strategies under `protocolsRoot`, one winner per id.
 *
 * Ownership comes SOLELY from the containing folder: a strategy in
 * protocols/<name>/strategies/ must have an id starting with `<name>-`, and
 * that is the only namespace rule — the mere existence of another protocol
 * whose name is a longer prefix of the id (e.g. `foo-bar` vs foo's
 * `foo-bar-model`) does NOT invalidate it. Adding a protocol can therefore
 * never disable another protocol's existing strategies.
 *
 * When the same id is defined in more than one place, the winner is chosen
 * deterministically (independent of scan order): the protocol whose name is
 * the longest matching prefix of the id — its namespace owner — wins; within
 * one protocol the lexicographically first file wins. Losers warn.
 */
export function discoverProtocolStrategies(protocolsRoot: string): ProtocolStrategy[] {
  const dirs = protocolStrategyDirs(protocolsRoot)
  const protocolNames = dirs.map((d) => d.protocol)

  const candidates: ProtocolStrategy[] = []
  for (const { protocol, dir } of dirs) {
    let files: string[]
    try {
      files = walkStrategyFiles(dir).sort()
    } catch (err) {
      console.warn(
        `[strategy] skipping protocol "${protocol}": cannot list ${dir} — ${(err as Error).message}`,
      )
      continue
    }
    for (const file of files) {
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
        candidates.push({ protocol, file, def })
      } catch (err) {
        console.warn(
          `[strategy] skipping ${basename(file)} (${protocol}): failed to load — ${(err as Error).message}`,
        )
      }
    }
  }

  const byId = new Map<string, ProtocolStrategy[]>()
  for (const c of candidates) {
    const group = byId.get(c.def.id)
    if (group) group.push(c)
    else byId.set(c.def.id, [c])
  }

  const winners: ProtocolStrategy[] = []
  for (const [id, group] of byId) {
    let winner = group[0]!
    if (group.length > 1) {
      const owner = protocolNames
        .filter((n) => id.startsWith(`${n}-`))
        .sort((a, b) => b.length - a.length)[0]
      const ranked = group
        .slice()
        .sort(
          (a, b) =>
            Number(b.protocol === owner) - Number(a.protocol === owner) ||
            a.file.localeCompare(b.file),
        )
      winner = ranked[0]!
      for (const loser of ranked.slice(1)) {
        console.warn(
          `[strategy] skipping ${loser.file}: duplicate strategy id ${JSON.stringify(id)} (kept ${winner.file})`,
        )
      }
    }
    winners.push(winner)
  }

  return winners.sort((a, b) => a.def.id.localeCompare(b.def.id))
}
