import type { StrategyDefinition } from './strategyDefinition.js'
import { definition as exampleMakerQuote } from '../strategies/exampleMakerQuote.js'
import { definition as exampleTakerFlip } from '../strategies/exampleTakerFlip.js'
import { definition as hybridProduction } from '../strategies/hybridProduction.js'
import { definition as hybridProduction2 } from '../strategies/hybridProduction2.js'
import { definition as winnerLimit } from '../strategies/winnerLimit.js'

export const strategyRegistry = {
  [exampleMakerQuote.id]: exampleMakerQuote,
  [exampleTakerFlip.id]: exampleTakerFlip,
  [hybridProduction.id]: hybridProduction,
  [hybridProduction2.id]: hybridProduction2,
  [winnerLimit.id]: winnerLimit,
} as const as Record<string, StrategyDefinition<unknown>>

export type StrategyId = keyof typeof strategyRegistry

export function getStrategyDefinition(id: string): StrategyDefinition<unknown> {
  const def = (strategyRegistry as Record<string, StrategyDefinition<unknown>>)[id]
  if (!def) throw new Error(`[strategy] unknown strategy id=${JSON.stringify(id)}`)
  return def
}

export function listStrategies(): StrategyDefinition<unknown>[] {
  return (Object.values(strategyRegistry) as StrategyDefinition<unknown>[])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
}
