/**
 * Shared parser for experiment spec files
 * (fable-lab/protocol/registry/experiments/EXP-*.md, template in
 * fable-lab/protocol/templates/EXPERIMENT.md).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REGISTRY_DIR = join(HERE, '..', '..', 'protocol', 'registry', 'experiments')

export type ParsedSpec = {
  filePath: string
  expId: string | null // e.g. EXP-001
  title: string | null
  registered: string | null
  lineageCells: number | null
  mechanismClass: string | null
  hypothesis: string | null
  prediction: string | null
  strategyPath: string | null
  strategyId: string | null
  primaryParams: string[] // ['k=v', ...] from the primary cell field
  holdoutBoundaryMs: number | null
  holdoutEndMs: number | null // frozen upper bound of the holdout window
  simulatorBias: string | null
  unresolvedPlaceholders: string[]
}

function field(md: string, label: string): string | null {
  // matches "- **Label:** value" possibly wrapping to following indented lines.
  // NOTE: `(?![\s\S])` = true end-of-input; a bare `$` under the `m` flag
  // matches every line end and silently truncated wrapped fields (found via
  // EXP-001 smoke: only 2 of 4 --param pairs reached the command).
  const re = new RegExp(
    `^- \\*\\*${label}:?\\*\\*:?\\s*([\\s\\S]*?)(?=\\n- \\*\\*|\\n##|(?![\\s\\S]))`,
    'm',
  )
  const m = md.match(re)
  return m ? m[1].trim().replace(/\s+/g, ' ') : null
}

export function parseSpecFile(filePath: string): ParsedSpec {
  const md = readFileSync(filePath, 'utf8')
  const titleMatch = md.match(/^# (EXP-\d+)\s*—\s*(.+)$/m)
  const strategyField = field(md, 'Strategy') ?? ''
  const strategyPath = strategyField.match(/`([^`]*\.ts)`/)?.[1] ?? null
  const strategyId = strategyField.match(/id `([^`]+)`/)?.[1] ?? null
  const primaryField = (field(md, 'Primary parameter cell') ?? '').replace(/`/g, ' ')
  const primaryParams = [...primaryField.matchAll(/--param\s+(\S+=\S+)/g)].map((m) => m[1])
  const holdoutMatch = md.match(/Holdout:\s*`market_start_ms`\s*>=\s*(\d+)/)
  const holdoutEndMatch = md.match(/Holdout:\s*`market_start_ms`\s*>=\s*\d+\s*and\s*<=\s*(\d+)/)
  // any <...> token in the spec section is an unfilled placeholder
  const specSection = md.split(/^## Runs/m)[0]
  const placeholders = [
    ...new Set([...specSection.matchAll(/<[^>\n]{1,60}>|EXP-NNN|\bNNN\b/g)].map((m) => m[0])),
  ]

  return {
    filePath,
    expId: titleMatch?.[1] ?? null,
    title: titleMatch?.[2]?.trim() ?? null,
    registered: field(md, 'Registered'),
    lineageCells: numOrNull(field(md, 'lineage_cells')),
    mechanismClass: field(md, 'Mechanism class'),
    hypothesis: field(md, 'Hypothesis \\(who loses and why\\)'),
    prediction: field(md, 'Falsifiable prediction'),
    strategyPath,
    strategyId,
    primaryParams,
    holdoutBoundaryMs: holdoutMatch ? Number(holdoutMatch[1]) : null,
    holdoutEndMs: holdoutEndMatch ? Number(holdoutEndMatch[1]) : null,
    simulatorBias: field(md, 'Simulator-bias exposure \\(CAPABILITIES §4\\)'),
    unresolvedPlaceholders: placeholders,
  }
}

function numOrNull(s: string | null): number | null {
  if (!s) return null
  const m = s.match(/\d+/)
  return m ? Number(m[0]) : null
}

/** Resolve "EXP-012" or a path into a spec file path. */
export function resolveSpecPath(idOrPath: string): string {
  if (existsSync(idOrPath)) return idOrPath
  if (/^EXP-\d+/i.test(idOrPath)) {
    const prefix = idOrPath.toUpperCase()
    const hit = readdirSync(REGISTRY_DIR).find((f) => f.toUpperCase().startsWith(prefix))
    if (hit) return join(REGISTRY_DIR, hit)
  }
  throw new Error(`cannot resolve experiment spec: ${idOrPath} (looked in ${REGISTRY_DIR})`)
}

export function specBasename(p: ParsedSpec): string {
  return basename(p.filePath)
}
