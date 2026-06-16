import type { StrategyDefinition } from './strategyDefinition.js'
import { definition as basicFakV1 } from '../strategies/basicFak.v1.js'
import { definition as buyBothSidesAndMergeV1 } from '../strategies/buyBothSidesAndMerge.v1.js'
import { definition as placeLimitOrderAndCancelAfterFewSecV1 } from '../strategies/placeLimitOrderAndCancelAfterFewSec.js'
import { definition as readVolatilityIndicatorV1 } from '../strategies/readVolatilityIndicator.v1.js'
import { definition as readExternalFeedsExampleV1 } from '../strategies/readExternalFeedsExample.v1.js'
import { definition as orderbookV1 } from '../strategies/signals/Orderbook.v1.js'
import { definition as overreactionSnapV1 } from '../strategies/signals/OverreactionSnap.v1.js'
import { definition as spikeMomentumV1 } from '../strategies/signals/SpikeMomentum.v1.js'
import { definition as spikeMomentumV2 } from '../strategies/signals/SpikeMomentum.v2.js'
import { definition as orderbookImbalanceV1 } from '../strategies/signals/OrderbookImbalance.v1.js'
import { definition as orderbookImbalanceV2 } from '../strategies/signals/OrderbookImbalance.v2.js'
import { definition as convergenceFavoriteV1 } from '../strategies/signals/ConvergenceFavorite.v1.js'
import { definition as convergenceUnderdogV1 } from '../strategies/signals/ConvergenceUnderdog.v1.js'
import { definition as convergenceUnderdogV2 } from '../strategies/signals/ConvergenceUnderdog.v2.js'
import { definition as convergenceVolRecorderV1 } from '../strategies/signals/ConvergenceVolRecorder.v1.js'
import { definition as convergenceUnderdogRecorderV1 } from '../strategies/signals/ConvergenceUnderdogRecorder.v1.js'
import { definition as convergenceUnderdogMakerV1 } from '../strategies/signals/ConvergenceUnderdogMaker.v1.js'
import { definition as buyBothDiscountV1 } from '../strategies/signals/BuyBothDiscount.v1.js'
import { definition as edgeScanV1 } from '../strategies/signals/EdgeScan.v1.js'
import { definition as spreadFadeScanV1 } from '../strategies/signals/SpreadFadeScan.v1.js'
import { definition as buyDownFavoriteV1 } from '../strategies/signals/BuyDownFavorite.v1.js'
import { definition as buyUpFavoriteV1 } from '../strategies/signals/BuyUpFavorite.v1.js'
import { definition as winnerLimitV1 } from '../strategies/winnerLimit.v1.js'
import { definition as templateV1 } from '../strategies/templates/Template.v1.js'
import { definition as templateTimeWindowGate } from '../strategies/templates/TemplateTimeWindowGate.js'
import { definition as templateDwellGate } from '../strategies/templates/TemplateDwellGate.js'
import { definition as buyBatchLimitGTCV1 } from '../strategies/BuyBatchLimitGTC.v1.js'
import { definition as buyBothV1 } from '../strategies/BuyBoth.v1.js'
import { definition as buyLowPriceV1 } from '../strategies/BuyLowPrice.v1.js'
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
// Gate Research
import { definition as splitSellRedeemV5GateNetChange } from '../strategies/split/SplitSellRedeem.v5.gate-netChange.js'
import { definition as splitSellRedeemV5GateHighLowRange } from '../strategies/split/SplitSellRedeem.v5.gate-highLowRange.js'
import { definition as splitSellRedeemV5GateOrderbookImbalance } from '../strategies/split/SplitSellRedeem.v5.gate-orderbookImbalance.js'
import { definition as splitSellRedeemV5GateTaTf15mWickRatio } from '../strategies/split/SplitSellRedeem.v5.gate-ta-tf15mWickRatio.js'
import { definition as splitSellRedeemV5GateTaTf1hWickRatio } from '../strategies/split/SplitSellRedeem.v5.gate-ta-tf1hWickRatio.js'
import { definition as splitSellRedeemV5GateNetChangeAndTaTf15mWickRatio } from '../strategies/split/SplitSellRedeem.v5.gate-netChange-and-ta-tf15mWickRatio.js'
import { definition as splitSellRedeemV5Unwind } from '../strategies/split/SplitSellRedeem.v5.unwind.js'
import { definition as splitSellRedeemV55GateNetChangeAndTaTf15mWickRatioFlex } from '../strategies/split/SplitSellRedeem.v5.5-gate-netChange-and-ta-tf15mWickRatio-flex.js'
import { definition as splitSellRedeemV6 } from '../strategies/split/SplitSellRedeem.v6.js'
import { definition as scalpV1 } from '../strategies/scalp/Scalp.v1.js'

export const strategyRegistry = {
  [basicFakV1.id]: basicFakV1,
  [buyBothSidesAndMergeV1.id]: buyBothSidesAndMergeV1,
  [placeLimitOrderAndCancelAfterFewSecV1.id]: placeLimitOrderAndCancelAfterFewSecV1,
  [readExternalFeedsExampleV1.id]: readExternalFeedsExampleV1,
  [readVolatilityIndicatorV1.id]: readVolatilityIndicatorV1,
  [orderbookV1.id]: orderbookV1,
  [overreactionSnapV1.id]: overreactionSnapV1,
  [spikeMomentumV1.id]: spikeMomentumV1,
  [spikeMomentumV2.id]: spikeMomentumV2,
  [orderbookImbalanceV1.id]: orderbookImbalanceV1,
  [orderbookImbalanceV2.id]: orderbookImbalanceV2,
  [convergenceFavoriteV1.id]: convergenceFavoriteV1,
  [convergenceUnderdogV1.id]: convergenceUnderdogV1,
  [convergenceUnderdogV2.id]: convergenceUnderdogV2,
  [convergenceVolRecorderV1.id]: convergenceVolRecorderV1,
  [convergenceUnderdogRecorderV1.id]: convergenceUnderdogRecorderV1,
  [convergenceUnderdogMakerV1.id]: convergenceUnderdogMakerV1,
  [buyBothDiscountV1.id]: buyBothDiscountV1,
  [edgeScanV1.id]: edgeScanV1,
  [spreadFadeScanV1.id]: spreadFadeScanV1,
  [buyDownFavoriteV1.id]: buyDownFavoriteV1,
  [buyUpFavoriteV1.id]: buyUpFavoriteV1,
  [winnerLimitV1.id]: winnerLimitV1,
  [buyBatchLimitGTCV1.id]: buyBatchLimitGTCV1,
  [buyBothV1.id]: buyBothV1,
  [buyLowPriceV1.id]: buyLowPriceV1,
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
  [splitSellRedeemV54ResearchMetricsAndTechnicalIndicators.id]:
    splitSellRedeemV54ResearchMetricsAndTechnicalIndicators,

  // Gate Research
  [splitSellRedeemV5GateNetChange.id]: splitSellRedeemV5GateNetChange,
  [splitSellRedeemV5GateHighLowRange.id]: splitSellRedeemV5GateHighLowRange,
  [splitSellRedeemV5GateOrderbookImbalance.id]: splitSellRedeemV5GateOrderbookImbalance,
  [splitSellRedeemV5GateTaTf15mWickRatio.id]: splitSellRedeemV5GateTaTf15mWickRatio,
  [splitSellRedeemV5GateTaTf1hWickRatio.id]: splitSellRedeemV5GateTaTf1hWickRatio,
  [splitSellRedeemV5GateNetChangeAndTaTf15mWickRatio.id]:
    splitSellRedeemV5GateNetChangeAndTaTf15mWickRatio,

  [splitSellRedeemV55GateNetChangeAndTaTf15mWickRatioFlex.id]:
    splitSellRedeemV55GateNetChangeAndTaTf15mWickRatioFlex,
  // Unwind
  [splitSellRedeemV5Unwind.id]: splitSellRedeemV5Unwind,

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
