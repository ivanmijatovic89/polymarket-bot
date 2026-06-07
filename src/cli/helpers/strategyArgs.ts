import type { Strategy } from '../../strategy/Strategy.js'
import type { Plugin, PluginSet } from '../../strategy/plugins/PluginSet.js'
import { CliArgsError, parseStrategyArgs } from '../../strategy/strategyDefinition.js'
import { getStrategyDefinition, listStrategies } from '../../strategy/strategyRegistry.js'
import * as z from 'zod'

export type BuildStrategyFromCliArgsResult = {
  strategyId: string
  params: Record<string, unknown>
  strategy: Strategy
  pluginSet?: PluginSet
  plugins?: Plugin[]
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
  const { strategyId, rawParams } = parseStrategyArgs(args.argv)
  return buildStrategyFromConfig({ strategyId, rawParams })
}

/**
 * Builds a strategy from already-resolved (strategyId, rawParams) without
 * touching argv. Used by extension flows that inherit strategy/params from a
 * parent run rather than parsing them from CLI arguments.
 */
export function buildStrategyFromConfig(args: {
  strategyId: string
  rawParams: Record<string, unknown>
}): BuildStrategyFromCliArgsResult {
  const def = getStrategyDefinition(args.strategyId)
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
