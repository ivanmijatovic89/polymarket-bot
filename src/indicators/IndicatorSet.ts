import type { MarketTick } from '../strategy/Strategy.js'
import type { VolatilitySnapshot } from './volatility/TimeWindowVolatility.js'

export type IndicatorId = string

export type IndicatorsSnapshot = {
  volatility?: VolatilitySnapshot
}

export interface Indicator {
  id: IndicatorId
  onMarketTick: (tick: MarketTick) => void
  snapshot: () => unknown
  reset?: () => void
}

/**
 * A per-runner indicator container.
 *
 * - If a strategy doesn't need indicators, it should not create an IndicatorSet.
 * - If it does, StrategyRunner will update this set on every market tick and pass `snapshot()` into strategy callbacks.
 */
export class IndicatorSet {
  private readonly indicators: Indicator[] = []
  private cached: IndicatorsSnapshot = {}

  register(ind: Indicator): void {
    this.indicators.push(ind)
  }

  listIds(): IndicatorId[] {
    const out: IndicatorId[] = []
    const seen = new Set<string>()
    for (const ind of this.indicators) {
      if (!ind?.id) continue
      if (seen.has(ind.id)) continue
      seen.add(ind.id)
      out.push(ind.id)
    }
    return out
  }

  reset(): void {
    for (const ind of this.indicators) ind.reset?.()
    this.cached = {}
  }

  onMarketTick(tick: MarketTick): void {
    for (const ind of this.indicators) ind.onMarketTick(tick)

    // Build a single snapshot for this tick (so strategies read O(1) without triggering computation).
    const snap: IndicatorsSnapshot = {}
    for (const ind of this.indicators) {
      if (ind.id === 'volatility') snap.volatility = ind.snapshot() as VolatilitySnapshot
    }
    this.cached = snap
  }

  snapshot(): IndicatorsSnapshot {
    return this.cached
  }
}


