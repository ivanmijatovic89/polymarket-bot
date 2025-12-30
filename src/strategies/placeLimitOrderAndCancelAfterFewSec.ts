import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

export const PlaceLimitOrderAndCancelAfterFewSecConfigSchema = z.strictObject({
  /**
   * Optional: restrict triggering + order placement to this specific assetId.
   * If omitted, the strategy will pick the best (lowest ask) asset that crosses triggerPrice.
   */
  assetId: z.string().min(1).optional(),
  triggerPrice: z.coerce.number().finite().default(0.4),
  orderPrice: z.coerce.number().finite().default(0.1),
  size: z.coerce.number().finite().default(10),
  cancelAfterMs: z.coerce.number().finite().default(10_000),
})

export type PlaceLimitOrderAndCancelAfterFewSecConfig = z.infer<
  typeof PlaceLimitOrderAndCancelAfterFewSecConfigSchema
>

export const definition: StrategyDefinition<PlaceLimitOrderAndCancelAfterFewSecConfig> = {
  id: 'placeLimitOrderAndCancelAfterFewSec.v1',
  title: 'Place GTC limit then cancel after few sec (test) v1',
  description:
    'Test strategy: wait until any asset bestAsk <= triggerPrice, place BUY GTC at orderPrice, then cancel after cancelAfterMs if still open.',
  schema: PlaceLimitOrderAndCancelAfterFewSecConfigSchema,
  create: (params) => createPlaceLimitOrderAndCancelAfterFewSecStrategy(params),
}

function pickTriggerAssetId(tick: MarketTick, cfg: PlaceLimitOrderAndCancelAfterFewSecConfig): string | null {
  const byAssetId = tick.snapshot.byAssetId

  if (cfg.assetId) {
    const b = byAssetId[cfg.assetId]
    const ask = b?.bestAsk ?? null
    if (ask !== null && Number.isFinite(ask) && ask <= cfg.triggerPrice) return cfg.assetId
    return null
  }

  let best: { assetId: string; ask: number } | null = null
  for (const assetId of Object.keys(byAssetId)) {
    const ask = byAssetId[assetId]?.bestAsk ?? null
    if (ask === null || !Number.isFinite(ask)) continue
    if (ask > cfg.triggerPrice) continue

    if (!best || ask < best.ask || (ask === best.ask && assetId < best.assetId)) {
      best = { assetId, ask }
    }
  }
  return best?.assetId ?? null
}

function isFinalLifecycleState(s: unknown): boolean {
  return (
    s === 'filled' ||
    s === 'canceled' ||
    s === 'rejected' ||
    s === 'expired' ||
    s === 'killed'
  )
}

export function createPlaceLimitOrderAndCancelAfterFewSecStrategy(
  cfg: PlaceLimitOrderAndCancelAfterFewSecConfig,
): Strategy {
  const name = 'place_limit_then_cancel'

  let state: 'waiting_trigger' | 'order_placed' | 'done' = 'waiting_trigger'
  let assetId: string | null = null
  let clientOrderId: string | null = null
  let placedAtMs: number | null = null
  let hasEmittedCancel = false

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    const nowMs = tick.snapshot.timestamp || Date.now()

    if (state === 'done') return []

    if (state === 'waiting_trigger') {
      const picked = pickTriggerAssetId(tick, cfg)
      if (!picked) return []

      // Use a single tick-derived clock for both placement + cancel timing.
      const safeSize = Number.isFinite(cfg.size) ? cfg.size : 10
      const safeOrderPrice = Number.isFinite(cfg.orderPrice) ? cfg.orderPrice : 0.1

      state = 'order_placed'
      assetId = picked
      placedAtMs = nowMs
      clientOrderId = `${name}:${picked}:${nowMs}`
      hasEmittedCancel = false

      return [
        {
          kind: 'place_limit',
          clientOrderId,
          assetId: picked,
          side: 'BUY',
          price: safeOrderPrice,
          size: safeSize,
          orderType: 'GTC',
          reason: 'cancel_test_place_gtc',
        },
      ]
    }

    // state === 'order_placed'
    if (!clientOrderId || !assetId || placedAtMs === null) return []

    const snap = portfolio.ordersByClientId[clientOrderId]
    if (snap?.lifecycleState && isFinalLifecycleState(snap.lifecycleState)) {
      state = 'done'
      return []
    }

    // If not in openOrders anymore and we have a final snapshot, consider it done.
    const open = portfolio.openOrdersByClientId[clientOrderId]
    if (!open && snap?.lifecycleState && isFinalLifecycleState(snap.lifecycleState)) {
      state = 'done'
      return []
    }

    const cancelAfterMs = Number.isFinite(cfg.cancelAfterMs) ? cfg.cancelAfterMs : 10_000
    if (cancelAfterMs <= 0) return []
    if (nowMs - placedAtMs < cancelAfterMs) return []
    if (hasEmittedCancel) return []

    // Live cancel needs orderId; get it from the portfolio snapshot.
    const orderId = snap?.orderId ?? open?.orderId
    if (!orderId) return []

    hasEmittedCancel = true
    return [
      {
        kind: 'cancel_order',
        clientOrderId,
        orderId,
        reason: `cancel_after_ms_${cancelAfterMs}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (_ev, portfolio) => {
    // Drive completion even if the market is quiet (fills/cancels will surface as account events).
    if (state !== 'order_placed') return []
    if (!clientOrderId) return []

    const snap = portfolio.ordersByClientId[clientOrderId]
    if (snap?.lifecycleState && isFinalLifecycleState(snap.lifecycleState)) {
      state = 'done'
      return []
    }
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}


