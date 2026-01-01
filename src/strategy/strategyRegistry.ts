import type { StrategyDefinition } from './strategyDefinition.js'
import { definition as basicFakV1 } from '../strategies/basicFak.v1.js'
import { definition as buyBothSidesAndMergeV1 } from '../strategies/buyBothSidesAndMerge.v1.js'
import { definition as placeLimitOrderAndCancelAfterFewSecV1 } from '../strategies/placeLimitOrderAndCancelAfterFewSec.js'
import { definition as readVolatilityIndicatorV1 } from '../strategies/readVolatilityIndicator.v1.js'
import { definition as winnerLimitV1 } from '../strategies/winnerLimit.v1.js'

export const strategyRegistry = {
  [basicFakV1.id]: basicFakV1,
  [buyBothSidesAndMergeV1.id]: buyBothSidesAndMergeV1,
  [placeLimitOrderAndCancelAfterFewSecV1.id]: placeLimitOrderAndCancelAfterFewSecV1,
  [readVolatilityIndicatorV1.id]: readVolatilityIndicatorV1,
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
