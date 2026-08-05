import { existsSync } from 'node:fs'
import path from 'node:path'
import { getStrategyArtifactBySha } from '../../db/strategyArtifacts.js'
import type { Strategy } from '../../strategy/Strategy.js'
import { ensureArtifactLoaded } from '../../strategy/artifacts/loader.js'
import {
  PublishError,
  publishStrategyArtifactFromSource,
} from '../../strategy/artifacts/publish.js'
import type { StrategyArtifactMeta, StrategyArtifactRef } from '../../strategy/artifacts/types.js'
import type { Plugin, PluginSet } from '../../strategy/plugins/PluginSet.js'
import {
  CliArgsError,
  parseStrategyArgs,
  type StrategyDefinition,
} from '../../strategy/strategyDefinition.js'
import {
  getStrategyDefinition,
  listStrategies,
  strategyRegistry,
} from '../../strategy/strategyRegistry.js'
import * as z from 'zod'

export type BuildStrategyFromCliArgsResult = {
  strategyId: string
  params: Record<string, unknown>
  strategy: Strategy
  pluginSet?: PluginSet
  plugins?: Plugin[]
}

/** Provenance of an artifact-selected strategy, for job payloads + run rows. */
export type ResolvedStrategyArtifact = {
  ref: StrategyArtifactRef
  meta: StrategyArtifactMeta
}

export type ResolveStrategyResult = BuildStrategyFromCliArgsResult & {
  /** Present only when the strategy was selected via `--strategy-artifact`. */
  artifact?: ResolvedStrategyArtifact
  /**
   * The loaded artifact definition (absent for registry strategies). Callers
   * that build fresh per-market runners (sequential backtest) pass this
   * through to `runSingleMarket` so the registry is never consulted.
   */
  definition?: StrategyDefinition<unknown>
}

function schemaKeys(schema: unknown): string[] | null {
  const s = schema as Record<string, unknown> | null
  if (!s) return null
  // ZodObject has a `shape` property that can be a function or an object
  const rawShape = (s as { shape?: unknown }).shape
  const shape = typeof rawShape === 'function' ? rawShape() : rawShape
  if (!shape || typeof shape !== 'object') return null
  return Object.keys(shape as object).sort()
}

export function formatStrategyHelp(args: { script: string }): string {
  const defs = listStrategies()
  const lines: string[] = []
  lines.push(`Usage:`)
  lines.push(`  ${args.script} --strategy <id> [--param key=value ...]`)
  lines.push(`  ${args.script} --strategy-artifact <sha256> [--param key=value ...]`)
  lines.push(`  ${args.script} --strategy-file <path.ts> [--param key=value ...]`)
  lines.push(``)
  lines.push(`Available strategies:`)
  for (const d of defs) lines.push(`  - ${d.id}`)
  lines.push(``)
  lines.push(`Example:`)
  lines.push(
    `  ${args.script} --strategy winnerLimit.v1 --param size=5 --param triggerPrice=0.9 --param minDelayMs=600000`,
  )
  return lines.join('\n')
}

export function formatStrategyParamsHelp(args: { script: string; strategyId: string }): string {
  const def = getStrategyDefinition(args.strategyId)
  const lines: string[] = []
  lines.push(`Usage:`)
  lines.push(`  ${args.script} --strategy ${def.id} [--param key=value ...]`)
  lines.push(``)
  lines.push(`Params for ${def.id}:`)
  const keys = schemaKeys(def.schema)
  if (!keys || keys.length === 0) {
    lines.push(`  (unable to introspect schema keys)`)
  } else {
    for (const k of keys) lines.push(`  - ${k}`)
  }
  return lines.join('\n')
}

export function buildStrategyFromCliArgs(args: {
  argv: string[]
  script: string
}): BuildStrategyFromCliArgsResult {
  const { strategyId, artifactSha256, strategyFile, rawParams } = parseStrategyArgs(args.argv)
  if (artifactSha256 || strategyFile) {
    // Artifact loading is async (dynamic import) — sync callers can't do it.
    throw new CliArgsError(
      '--strategy-artifact/--strategy-file are not supported by this entry point (use a runtime that resolves artifacts)',
    )
  }
  return buildStrategyFromConfig({ strategyId: strategyId!, rawParams })
}

/**
 * Resolve strategy selection from argv:
 * - `--strategy <id>` — registry, sync path unchanged
 * - `--strategy-artifact <sha256>` — already-published artifact (exact code)
 * - `--strategy-file <path.ts>` — external source file: auto-published as an
 *   artifact (idempotent — unchanged code re-resolves the same sha with no
 *   re-upload), then resolved like `--strategy-artifact`
 * All three end in the same schema.safeParse + create() contract. Async
 * because artifact loading dynamic-imports the bundle.
 */
export async function resolveStrategyFromCliArgs(args: {
  argv: string[]
  script: string
}): Promise<ResolveStrategyResult> {
  const { strategyId, artifactSha256, strategyFile, rawParams } = parseStrategyArgs(args.argv)
  if (strategyFile) {
    const { repoDir, entrypoint } = deriveStrategyFileSource(strategyFile)
    // Iteration UX matches the old registry flow: no typecheck per launch
    // (that gate is strategy:check), dirty tree fine (sha is the identity).
    const published = await publishStrategyArtifactFromSource({
      repoDir,
      entrypoint,
      allowDirty: true,
      skipChecks: true,
      log: (msg) => console.error(msg),
    }).catch((err: unknown) => {
      if (err instanceof PublishError) throw new CliArgsError(`--strategy-file: ${err.message}`)
      throw err
    })
    return resolveStrategyFromArtifact({ sha256: published.sha256, rawParams })
  }
  if (!artifactSha256) return buildStrategyFromConfig({ strategyId: strategyId!, rawParams })
  return resolveStrategyFromArtifact({ sha256: artifactSha256, rawParams })
}

/**
 * Map a strategy source file to its repo root + relative entrypoint. The
 * repo root is the nearest ancestor directory containing `.git` (publish
 * records that repo's commit as provenance).
 */
function deriveStrategyFileSource(strategyFile: string): { repoDir: string; entrypoint: string } {
  const abs = path.resolve(strategyFile)
  if (!existsSync(abs)) throw new CliArgsError(`--strategy-file not found: ${abs}`)
  let dir = path.dirname(abs)
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) break
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new CliArgsError(
        `--strategy-file must live inside a git repository (searched upward from ${path.dirname(abs)})`,
      )
    }
    dir = parent
  }
  return { repoDir: dir, entrypoint: path.relative(dir, abs).split(path.sep).join('/') }
}

/**
 * Resolve an already-published artifact sha to a built strategy. Shared by
 * fresh launches (CLI) and `--extend` (sha persisted on the parent run row).
 *
 * `allowRegistryIdCollision`: fresh launches reject an artifact whose id
 * collides with a registry strategy (ambiguous selection). Extensions MUST
 * NOT — the sha is inherited from the parent run and cannot be changed, so a
 * registry strategy added later under the same id would otherwise make the
 * run permanently un-extendable. The definition is passed explicitly
 * everywhere (never looked up by id), so a collision is harmless there.
 */
export async function resolveStrategyFromArtifact(args: {
  sha256: string
  rawParams: Record<string, unknown>
  allowRegistryIdCollision?: boolean
}): Promise<ResolveStrategyResult> {
  const row = await getStrategyArtifactBySha(args.sha256)
  if (!row) {
    throw new CliArgsError(
      `unknown strategy artifact ${args.sha256} — publish it first:\n` +
        `  npm run strategy:publish -- --repo <dir> --entrypoint <rel.ts>`,
    )
  }
  const def = await ensureArtifactLoaded({ sha256: row.sha256, r2Url: row.r2Url })
  if (def.id !== row.strategyId) {
    throw new CliArgsError(
      `artifact ${args.sha256.slice(0, 12)} exports strategy id ${JSON.stringify(def.id)} but was published as ${JSON.stringify(row.strategyId)}`,
    )
  }
  if (strategyRegistry[def.id]) {
    if (!args.allowRegistryIdCollision) {
      throw new CliArgsError(
        `artifact strategy id ${JSON.stringify(def.id)} collides with a registry strategy — republish under a different id`,
      )
    }
    console.warn(
      `[strategy] artifact id ${JSON.stringify(def.id)} now also exists in the registry — this run keeps using the artifact (sha ${args.sha256.slice(0, 12)})`,
    )
  }
  const built = buildStrategyFromConfig({
    strategyId: def.id,
    rawParams: args.rawParams,
    definition: def,
  })
  return {
    ...built,
    definition: def,
    artifact: {
      ref: { sha256: row.sha256, r2Url: row.r2Url },
      meta: {
        r2Url: row.r2Url,
        sourceRepo: row.sourceRepo,
        sourceCommit: row.sourceCommit,
        sourceDirty: row.sourceDirty,
        entrypoint: row.entrypoint,
      },
    },
  }
}

/**
 * Builds a strategy from already-resolved (strategyId, rawParams) without
 * touching argv. Used by extension flows that inherit strategy/params from a
 * parent run rather than parsing them from CLI arguments. When `definition`
 * is provided (external artifact already loaded), the registry is bypassed —
 * validation and create() are identical either way.
 */
export function buildStrategyFromConfig(args: {
  strategyId: string
  rawParams: Record<string, unknown>
  definition?: StrategyDefinition<unknown>
}): BuildStrategyFromCliArgsResult {
  const def = args.definition ?? getStrategyDefinition(args.strategyId)
  const parsed = def.schema.safeParse(args.rawParams)
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error)
    const parts: string[] = []
    for (const e of flat.formErrors) parts.push(e)
    for (const [k, errs] of Object.entries(flat.fieldErrors)) {
      const list = errs as unknown as string[] | undefined
      if (!list || list.length === 0) continue
      parts.push(`${k}: ${list.join('; ')}`)
    }
    const msg =
      parts.length > 0 ? parts.join('\n') : parsed.error.issues.map((i) => i.message).join('\n')
    throw new CliArgsError(`invalid params for --strategy ${args.strategyId}:\n${msg}`)
  }
  const params = parsed.data as Record<string, unknown>
  const built = def.create(parsed.data as never)
  return { strategyId: args.strategyId, params, ...built }
}

export function printCliArgsError(args: { script: string; err: unknown }): void {
  const msg = args.err instanceof Error ? args.err.message : String(args.err)
  console.error(`[${args.script}] ${msg}`)
  if (args.err instanceof CliArgsError) {
    console.error('')
    console.error(formatStrategyHelp({ script: args.script }))
  }
}
