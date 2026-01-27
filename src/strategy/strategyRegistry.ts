import type { StrategyDefinition } from './strategyDefinition.js'
import { definition as basicFakV1 } from '../strategies/basicFak.v1.js'
import { definition as buyBothSidesAndMergeV1 } from '../strategies/buyBothSidesAndMerge.v1.js'
import { definition as placeLimitOrderAndCancelAfterFewSecV1 } from '../strategies/placeLimitOrderAndCancelAfterFewSec.js'
import { definition as readVolatilityIndicatorV1 } from '../strategies/readVolatilityIndicator.v1.js'
import { definition as readExternalFeedsExampleV1 } from '../strategies/readExternalFeedsExample.v1.js'
import { definition as orderbookV1 } from '../strategies/signals/Orderbook.v1.js'
import { definition as winnerLimitV1 } from '../strategies/winnerLimit.v1.js'
import { definition as templateV1 } from '../strategies/templates/Template.v1.js'
import { definition as templateTimeWindowGate } from '../strategies/templates/TemplateTimeWindowGate.js'
import { definition as templateDwellGate } from '../strategies/templates/TemplateDwellGate.js'
import { definition as buyBatchLimitGTCV1 } from '../strategies/BuyBatchLimitGTC.v1.js'
import { definition as buyBothV1 } from '../strategies/BuyBoth.v1.js'
import { definition as measureLatencyV1 } from '../strategies/MeasureLatency.v1.js'
import { definition as splitSellRedeemV1 } from '../strategies/split/SplitSellRedeem.v1.js'
import { definition as splitSellRedeemV2 } from '../strategies/split/SplitSellRedeem.v2.js'
import { definition as splitSellRedeemV3 } from '../strategies/split/SplitSellRedeem.v3.js'
import { definition as splitSellRedeemV4 } from '../strategies/split/SplitSellRedeem.v4.js'
import { definition as splitSellRedeemV5 } from '../strategies/split/SplitSellRedeem.v5.js'
import { definition as splitSellRedeemV51ResearchMetrics } from '../strategies/split/SplitSellRedeem.v5.1-research-metrics.js'
import { definition as splitSellRedeemV52NetChange } from '../strategies/split/SplitSellRedeem.v5.2-netChange.js'
import { definition as splitSellRedeemV53TechnicalIndicators } from '../strategies/split/SplitSellRedeem.v5.3-technical-indicators.js'
import { definition as splitSellRedeemV54ResearchMetricsAndTechnicalIndicators } from '../strategies/split/SplitSellRedeem.v5.4-research-metrics-and-technical-indicators.js'
import { definition as splitSellRedeemV6 } from '../strategies/split/SplitSellRedeem.v6.js'
import { definition as scalpV1 } from '../strategies/scalp/Scalp.v1.js'

export const strategyRegistry = {
  [basicFakV1.id]: basicFakV1,
  [buyBothSidesAndMergeV1.id]: buyBothSidesAndMergeV1,
  [placeLimitOrderAndCancelAfterFewSecV1.id]: placeLimitOrderAndCancelAfterFewSecV1,
  [readExternalFeedsExampleV1.id]: readExternalFeedsExampleV1,
  [readVolatilityIndicatorV1.id]: readVolatilityIndicatorV1,
  [orderbookV1.id]: orderbookV1,
  [winnerLimitV1.id]: winnerLimitV1,
  [buyBatchLimitGTCV1.id]: buyBatchLimitGTCV1,
  [buyBothV1.id]: buyBothV1,
  [measureLatencyV1.id]: measureLatencyV1,
  [splitSellRedeemV1.id]: splitSellRedeemV1,
  [splitSellRedeemV2.id]: splitSellRedeemV2,
  [splitSellRedeemV3.id]: splitSellRedeemV3,
  [splitSellRedeemV4.id]: splitSellRedeemV4,
  [splitSellRedeemV5.id]: splitSellRedeemV5,
  [splitSellRedeemV6.id]: splitSellRedeemV6,
  [splitSellRedeemV51ResearchMetrics.id]: splitSellRedeemV51ResearchMetrics,
  [splitSellRedeemV52NetChange.id]: splitSellRedeemV52NetChange,
  [splitSellRedeemV53TechnicalIndicators.id]: splitSellRedeemV53TechnicalIndicators,
  [splitSellRedeemV54ResearchMetricsAndTechnicalIndicators.id]: splitSellRedeemV54ResearchMetricsAndTechnicalIndicators,
  [scalpV1.id]: scalpV1,
  // templates
  [templateV1.id]: templateV1,
  [templateTimeWindowGate.id]: templateTimeWindowGate,
  [templateDwellGate.id]: templateDwellGate,
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
