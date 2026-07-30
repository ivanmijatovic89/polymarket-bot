/**
 * pair-fable-probe-capital-v0 — instrumentation probe, NOT a trading candidate.
 *
 * Purpose (PLAN `metrics-and-capital-units`): produce a run whose stored rows
 * exercise every case the capital-unit formulas depend on:
 *   - multiple BUY fills per side (multi-buy), on BOTH sides so one side is
 *     guaranteed to settle as the winner;
 *   - taker fills (FOK) so taker fees are capitalized into cost basis;
 *   - one crossing GTC sized past the top book level, so a single
 *     clientOrderId produces MULTIPLE taker fills (tests the
 *     intent_meta-dedup-per-clientOrderId behavior in marketStats);
 *   - intent meta stamped on every order (the per-order analytics channel).
 *
 * No sells, no merges (RULES rubrics 1/5 + backtest merge ban).
 */
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  /** Shares per plain FOK probe order. Bounded per M5 (no-depth fill model). */
  size: z.coerce.number().finite().positive().max(100).default(5),
  /** Place one probe order every N ticks (a 15m market has ~125k ticks). */
  everyNTicks: z.coerce.number().finite().int().positive().default(1500),
  /** Plain FOK orders before the final crossing-GTC probe (alternating UP/DOWN). */
  fokOrders: z.coerce.number().finite().int().positive().default(6),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-probe-capital-v0',
  title: 'pair-fable capital probe v0',
  description:
    'Instrumentation probe: alternating small FOK taker buys on both sides plus one multi-level crossing GTC, all with stamped intent meta. Verifies cost==invested and meta dedup. Not a trading candidate.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

type State = {
  marketId: string
  tickCount: number
  placed: number
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000

export function createStrategy(cfg: Config): Strategy {
  const name = 'pair-fable-probe-capital-v0'
  let state: State | null = null

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio
    const marketId = tick.snapshot.market ?? 'unknown_market'
    if (!state || state.marketId !== marketId) {
      state = { marketId, tickCount: 0, placed: 0 }
    }
    state.tickCount += 1

    const totalOrders = cfg.fokOrders + 1
    if (state.placed >= totalOrders) return []
    if (state.tickCount % cfg.everyNTicks !== 0) return []

    const upAssetId = ctx?.market?.upAssetId
    const downAssetId = ctx?.market?.downAssetId
    if (!upAssetId || !downAssetId) return []

    const i = state.placed
    const side: 'UP' | 'DOWN' = i % 2 === 0 ? 'UP' : 'DOWN'
    const assetId = side === 'UP' ? upAssetId : downAssetId
    const book = tick.snapshot.byAssetId[assetId]
    if (!book) return []
    const asks = book.asks
    if (!asks || asks.length === 0) return []
    const bestAsk = book.bestAsk
    if (bestAsk === null || !Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1) return []

    const nowMs = tick.snapshot.timestamp || 0
    const clientOrderId = `${name}:${marketId}:${i}:${nowMs}`

    let price: number
    let size: number
    let orderType: 'FOK' | 'GTC'
    if (i < cfg.fokOrders) {
      // Plain taker probe: FOK with a 2-cent crossing buffer (fills at the
      // actual ask levels, the buffer only tolerates book drift across the
      // simulated latency). Small size => single fill from the top level.
      orderType = 'FOK'
      price = round3(Math.min(0.99, bestAsk + 0.02))
      size = cfg.size
    } else {
      // Multi-fill probe: cross up to 3 ask levels with size spanning past
      // level 1, so one clientOrderId yields multiple taker fills.
      orderType = 'GTC'
      const lvl0 = asks[0]
      const lvl1 = asks[1]
      if (!lvl0 || !lvl1) return [] // need 2+ levels; retry next slot
      const deepest = asks[Math.min(2, asks.length - 1)]
      price = round3(deepest?.price ?? lvl1.price)
      size = Math.round(lvl0.size + Math.max(1, Math.min(cfg.size, lvl1.size)))
      if (size <= 0) return []
    }

    state.placed += 1
    return [
      {
        kind: 'place_limit',
        clientOrderId,
        assetId,
        side: 'BUY',
        price,
        size,
        orderType,
        meta: { t: 'pfcap', i, side, ot: orderType, p: price, s: size },
        reason: `probe_${orderType.toLowerCase()}_${side.toLowerCase()}_${i}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { name, onMarketTick, onAccountEvent }
}
