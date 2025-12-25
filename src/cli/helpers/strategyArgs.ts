import type { Strategy } from '../../strategy/Strategy.js'
import { CliArgsError, parseStrategyArgs } from '../../strategy/strategyDefinition.js'
import { getStrategyDefinition, listStrategies } from '../../strategy/strategyRegistry.js'
import * as z from 'zod'

export type BuildStrategyFromCliArgsResult = {
  strategyId: string
  params: Record<string, unknown>
  strategy: Strategy
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
  lines.push(``)
  lines.push(`Available strategies:`)
  for (const d of defs) lines.push(`  - ${d.id}`)
  lines.push(``)
  lines.push(`Example:`)
  lines.push(
    `  ${args.script} --strategy winnerLimit --param size=5 --param triggerPrice=0.9 --param minDelayMs=600000`,
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

// Common CLI options that should not be passed as strategy parameters
const CLI_OPTIONS = new Set([
  'workers',
  'concurrency',
  'mode',
  'order',
  'time-driven',
  'realtime',
  'carry',
  'carry-portfolio',
  'verbose',
])

export function buildStrategyFromCliArgs(args: {
  argv: string[]
  script: string
}): BuildStrategyFromCliArgsResult {
  const { strategyId, rawParams } = parseStrategyArgs(args.argv)

  // Check for common CLI options passed as strategy parameters
  const cliOptionsFound: string[] = []
  for (const key of Object.keys(rawParams)) {
    if (CLI_OPTIONS.has(key)) {
      cliOptionsFound.push(key)
    }
  }

  if (cliOptionsFound.length > 0) {
    const suggestions = cliOptionsFound.map(k => {
      if (k === 'workers') return `Use --workers <N> instead of --param workers=<N>`
      if (k === 'concurrency') return `Use --concurrency <N> instead of --param concurrency=<N>`
      return `"${k}" is a CLI option, not a strategy parameter`
    }).join('\n')
    throw new CliArgsError(
      `invalid params for --strategy ${strategyId}:\n` +
      `Unrecognized key${cliOptionsFound.length > 1 ? 's' : ''}: ${cliOptionsFound.map(k => `"${k}"`).join(', ')}\n\n` +
      `Hint: ${suggestions}`
    )
  }

  const def = getStrategyDefinition(strategyId)
  const parsed = def.schema.safeParse(rawParams)
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error)
    const parts: string[] = []
    for (const e of flat.formErrors) parts.push(e)
    const fieldErrors = flat.fieldErrors as Record<string, string[] | undefined>
    for (const [k, errs] of Object.entries(fieldErrors)) {
      if (!errs || errs.length === 0) continue
      parts.push(`${k}: ${errs.join('; ')}`)
    }
    const msg =
      parts.length > 0 ? parts.join('\n') : parsed.error.issues.map((i) => i.message).join('\n')
    throw new CliArgsError(`invalid params for --strategy ${strategyId}:\n${msg}`)
  }
  const params = parsed.data as Record<string, unknown>
  const strategy = def.create(parsed.data as never)
  return { strategyId, params, strategy }
}

export function printCliArgsError(args: { script: string; err: unknown }): void {
  const msg = args.err instanceof Error ? args.err.message : String(args.err)
  console.error(`[${args.script}] ${msg}`)
  if (args.err instanceof CliArgsError) {
    console.error('')
    console.error(formatStrategyHelp({ script: args.script }))
  }
}
