import type { StrategyDefinition } from './strategyDefinition.js'
import { definition as basicFakV1 } from '../strategies/basicFak.v1.js'
import { definition as exampleMakerQuoteV1 } from '../strategies/exampleMakerQuote.v1.js'
import { definition as exampleTakerFlipV1 } from '../strategies/exampleTakerFlip.v1.js'
import { definition as winnerLimitV1 } from '../strategies/winnerLimit.v1.js'

export const strategyRegistry = {
  [basicFakV1.id]: basicFakV1,
  [exampleMakerQuoteV1.id]: exampleMakerQuoteV1,
  [exampleTakerFlipV1.id]: exampleTakerFlipV1,
  [winnerLimitV1.id]: winnerLimitV1,
} as const satisfies Record<string, StrategyDefinition<unknown>>

export type StrategyId = keyof typeof strategyRegistry

export function getStrategyDefinition(id: string): StrategyDefinition<unknown> {
  const def = (strategyRegistry as Record<string, StrategyDefinition<unknown>>)[id]
  if (!def) throw new Error(`[strategy] unknown strategy id=${JSON.stringify(id)}`)
  return def
}

export function listStrategies(): StrategyDefinition<unknown>[] {
  return Object.values(strategyRegistry)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
}
