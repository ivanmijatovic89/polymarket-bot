import type { Strategy } from './Strategy.js'
import type { z } from 'zod'

export type StrategyDefinition<TParams> = {
  id: string
  title?: string
  description?: string
  schema: z.ZodType<TParams>
  create: (params: TParams) => Strategy
}

export class CliArgsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliArgsError'
  }
}

export type ParsedStrategyArgs = {
  strategyId: string
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
  if (idx <= 0) throw new CliArgsError(`invalid --param ${JSON.stringify(raw)} (expected key=value)`)
  const key = raw.slice(0, idx).trim()
  const value = raw.slice(idx + 1)
  if (!key) throw new CliArgsError(`invalid --param ${JSON.stringify(raw)} (empty key)`)
  return { key, value }
}

/**
 * Parse strategy selection and repeated `--param key=value` pairs from argv.
 *
 * Strict behavior:
 * - `--strategy` is required
 * - duplicate `--param` keys are rejected
 */
export function parseStrategyArgs(argv: string[]): ParsedStrategyArgs {
  let strategyId: string | null = null
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

  if (!strategyId) throw new CliArgsError('missing required --strategy <id>')
  return { strategyId, rawParams }
}
