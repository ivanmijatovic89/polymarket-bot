import type { Strategy } from './Strategy.js'
import type { Plugin, PluginSet } from './plugins/PluginSet.js'
import type { z } from 'zod'
import { SHA256_HEX_RE } from './artifacts/types.js'

export type BuiltStrategy = {
  strategy: Strategy
  pluginSet?: PluginSet
  plugins?: Plugin[]
}

/**
 * Bivariant function type helper.
 *
 * We use this so a `StrategyDefinition<SpecificParams>` can be stored in a registry typed as
 * `StrategyDefinition<unknown>` without tripping `strictFunctionTypes` / `exactOptionalPropertyTypes`.
 */
export type BivariantStrategyFactory<TParams> = {
  bivarianceHack(params: TParams): BuiltStrategy
}['bivarianceHack']

export type StrategyDefinition<TParams> = {
  id: string
  title?: string
  description?: string
  schema: z.ZodType<TParams>
  create: BivariantStrategyFactory<TParams>
}

export class CliArgsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliArgsError'
  }
}

export type ParsedStrategyArgs = {
  /** Registry strategy id (`--strategy`). Null when an artifact was selected. */
  strategyId: string | null
  /** External artifact sha256 (`--strategy-artifact`). Null when a registry id was selected. */
  artifactSha256: string | null
  rawParams: Record<string, string>
}

function mustGetNextValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1]
  if (typeof v !== 'string' || v.length === 0 || v.startsWith('-')) {
    throw new CliArgsError(`missing value for ${flag}`)
  }
  return v
}

function parseParamKv(raw: string): { key: string; value: string } {
  const idx = raw.indexOf('=')
  if (idx <= 0)
    throw new CliArgsError(`invalid --param ${JSON.stringify(raw)} (expected key=value)`)
  const key = raw.slice(0, idx).trim()
  const value = raw.slice(idx + 1)
  if (!key) throw new CliArgsError(`invalid --param ${JSON.stringify(raw)} (empty key)`)
  return { key, value }
}

function validateArtifactSha(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (!SHA256_HEX_RE.test(v)) {
    throw new CliArgsError(
      `invalid --strategy-artifact ${JSON.stringify(raw)} (expected a 64-char sha256 hex, printed by strategy:publish)`,
    )
  }
  return v
}

/**
 * Parse strategy selection and repeated `--param key=value` pairs from argv.
 *
 * Strict behavior:
 * - exactly one of `--strategy <id>` / `--strategy-artifact <sha256>` is required
 * - duplicate `--param` keys are rejected
 */
export function parseStrategyArgs(argv: string[]): ParsedStrategyArgs {
  let strategyId: string | null = null
  let artifactSha256: string | null = null
  const rawParams: Record<string, string> = {}

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a) continue

    if (a === '--strategy') {
      strategyId = mustGetNextValue(argv, i, '--strategy')
      i += 1
      continue
    }
    if (a.startsWith('--strategy=')) {
      const v = a.slice('--strategy='.length)
      if (!v) throw new CliArgsError('missing value for --strategy')
      strategyId = v
      continue
    }

    if (a === '--strategy-artifact') {
      artifactSha256 = validateArtifactSha(mustGetNextValue(argv, i, '--strategy-artifact'))
      i += 1
      continue
    }
    if (a.startsWith('--strategy-artifact=')) {
      const v = a.slice('--strategy-artifact='.length)
      if (!v) throw new CliArgsError('missing value for --strategy-artifact')
      artifactSha256 = validateArtifactSha(v)
      continue
    }

    if (a === '--param') {
      const kv = mustGetNextValue(argv, i, '--param')
      const { key, value } = parseParamKv(kv)
      if (Object.prototype.hasOwnProperty.call(rawParams, key)) {
        throw new CliArgsError(`duplicate --param key ${JSON.stringify(key)}`)
      }
      rawParams[key] = value
      i += 1
      continue
    }
    if (a.startsWith('--param=')) {
      const kv = a.slice('--param='.length)
      const { key, value } = parseParamKv(kv)
      if (Object.prototype.hasOwnProperty.call(rawParams, key)) {
        throw new CliArgsError(`duplicate --param key ${JSON.stringify(key)}`)
      }
      rawParams[key] = value
      continue
    }
  }

  if (strategyId && artifactSha256) {
    throw new CliArgsError('--strategy and --strategy-artifact are mutually exclusive — pass one')
  }
  if (!strategyId && !artifactSha256) {
    throw new CliArgsError('missing required --strategy <id> or --strategy-artifact <sha256>')
  }
  return { strategyId, artifactSha256, rawParams }
}
