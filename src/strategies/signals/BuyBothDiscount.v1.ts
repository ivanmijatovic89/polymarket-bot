import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import { safeProbabilityPrice } from '../../strategy/strategyToolkit.js'
import type { OrderBookSnapshot } from '../../market/orderbook/types.js'
import * as z from 'zod'

/**
 * BuyBothDiscount.v1 — buy BOTH sides when they cost less than $1 combined.
 *
 * UP + DOWN pay exactly $1 total at resolution. So whenever askUP + askDOWN <= 1 - margin,
 * buying `size` of each locks in `size * (1 - askUP - askDOWN)` regardless of outcome.
 * Hold both to resolution; one side redeems $1, the other $0. One entry per market.
 */

export const ConfigSchema = z.strictObject({
  /** Required combined-ask discount below $1 to enter (after slippage). */
  margin: z.coerce.number().finite().min(0).max(0.5).default(0.02),
  /** Marketable slippage budget added to each side's ask. */
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.0),
  size: z.coerce.number().finite().positive().max(10000).default(25),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'BuyBothDiscount.v1',
  title: 'Buy Both Discount v1',
  description:
    'Buys both UP and DOWN when askUP + askDOWN <= 1 - margin, locking the gap. Holds to resolution.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

type Stage = 'scan' | 'done'
type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  stage: Stage
} | null

function resolveUpDownAssetIds(
  tick: MarketTick,
  ctx?: StrategyContext,
): { upAssetId: string; downAssetId: string } | null {
  const up = ctx?.market?.upAssetId
  const down = ctx?.market?.downAssetId
  if (typeof up === 'string' && up && typeof down === 'string' && down && up !== down) {
    return { upAssetId: up, downAssetId: down }
  }
  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const upAssetId = ids[0]
  const downAssetId = ids[1]
  if (!upAssetId || !downAssetId || upAssetId === downAssetId) return null
  return { upAssetId, downAssetId }
}

function bookOf(tick: MarketTick, assetId: string): OrderBookSnapshot | undefined {
  return tick.snapshot.byAssetId[assetId]
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'BuyBothDiscount.v1'
  let state: StrategyState = null

  const onMarketTick = (
    tick: MarketTick,
    _p: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _p
    const marketId = tick.snapshot.market ?? 'unknown_market'
    const nowMs = tick.snapshot.timestamp || Date.now()
    if (state && state.marketId !== marketId) state = null
    if (!state) {
      const ids = resolveUpDownAssetIds(tick, ctx)
      if (!ids) return []
      state = { marketId, upAssetId: ids.upAssetId, downAssetId: ids.downAssetId, stage: 'scan' }
    }
    if (state.stage !== 'scan') return []

    const upAsk = bookOf(tick, state.upAssetId)?.bestAsk
    const downAsk = bookOf(tick, state.downAssetId)?.bestAsk
    if (typeof upAsk !== 'number' || !Number.isFinite(upAsk)) return []
    if (typeof downAsk !== 'number' || !Number.isFinite(downAsk)) return []

    const upPay = upAsk + cfg.slippage
    const downPay = downAsk + cfg.slippage
    if (upPay + downPay > 1 - cfg.margin) return []

    state.stage = 'done'
    return [
      {
        kind: 'place_batch',
        reason: 'buy_both_discount',
        orders: [
          {
            clientOrderId: `${name}:${marketId}:up:${nowMs}`,
            assetId: state.upAssetId,
            side: 'BUY',
            price: safeProbabilityPrice(upPay),
            size: cfg.size,
            orderType: 'FOK',
          },
          {
            clientOrderId: `${name}:${marketId}:down:${nowMs}`,
            assetId: state.downAssetId,
            side: 'BUY',
            price: safeProbabilityPrice(downPay),
            size: cfg.size,
            orderType: 'FOK',
          },
        ],
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (): Intent[] => []

  return { name, onMarketTick, onAccountEvent }
}
