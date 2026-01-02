import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
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

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'placeLimitOrderAndCancelAfterFewSec.v1',
  title: 'Place GTC limit then cancel after few sec (test) v1',
  description:
    'Test strategy: wait until any asset bestAsk <= triggerPrice, place BUY GTC at orderPrice, then cancel after cancelAfterMs if still open.',
  schema: ConfigSchema,
  create: (params) => ({ strategy: createStrategy(params) }),
}

type LocalState =
  | { phase: 'waiting_trigger' }
  | {
      phase: 'order_placed'
      assetId: string
      clientOrderId: string
      placedAtMs: number
      cancelEmitted: boolean
    }
  | { phase: 'done' }

function tickNowMs(tick: MarketTick): number {
  // IMPORTANT: use a single tick-derived clock for placement + cancel timing.
  return tick.snapshot.timestamp || Date.now()
}

function isFinalLifecycleState(s: unknown): boolean {
  return s === 'filled' || s === 'canceled' || s === 'rejected' || s === 'expired' || s === 'killed'
}

function pickTriggerAssetId(tick: MarketTick, cfg: Config): string | null {
  const byAssetId = tick.snapshot.byAssetId

  // Optional override: only watch a single assetId.
  if (cfg.assetId) {
    const ask = byAssetId[cfg.assetId]?.bestAsk ?? null
    return ask !== null && Number.isFinite(ask) && ask <= cfg.triggerPrice ? cfg.assetId : null
  }

  // Otherwise, pick deterministically: lowest ask that crosses; tie-break by assetId string.
  let best: { assetId: string; ask: number } | null = null
  for (const assetId of Object.keys(byAssetId)) {
    const ask = byAssetId[assetId]?.bestAsk ?? null
    if (ask === null || !Number.isFinite(ask) || ask > cfg.triggerPrice) continue
    if (!best || ask < best.ask || (ask === best.ask && assetId < best.assetId)) best = { assetId, ask }
  }
  return best?.assetId ?? null
}

function orderLifecycleState(portfolio: PortfolioSnapshot, clientOrderId: string): unknown {
  return portfolio.ordersByClientId[clientOrderId]?.lifecycleState
}

function resolveOrderIdForCancel(portfolio: PortfolioSnapshot, clientOrderId: string): string | null {
  const snap = portfolio.ordersByClientId[clientOrderId]
  const open = portfolio.openOrdersByClientId[clientOrderId]
  const orderId = snap?.orderId ?? open?.orderId
  return typeof orderId === 'string' && orderId.length > 0 ? orderId : null
}

function makeClientOrderId(base: string, assetId: string, placedAtMs: number): string {
  return `${base}:${assetId}:${placedAtMs}`
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'place_limit_then_cancel'
  let state: LocalState = { phase: 'waiting_trigger' }

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    const nowMs = tickNowMs(tick)
    if (state.phase === 'done') return []

    if (state.phase === 'waiting_trigger') {
      const assetId = pickTriggerAssetId(tick, cfg)
      if (!assetId) return []

      const placedAtMs = nowMs
      const clientOrderId = makeClientOrderId(name, assetId, placedAtMs)
      const size = Number.isFinite(cfg.size) ? cfg.size : 10
      const orderPrice = Number.isFinite(cfg.orderPrice) ? cfg.orderPrice : 0.1

      state = { phase: 'order_placed', assetId, clientOrderId, placedAtMs, cancelEmitted: false }

      return [
        {
          kind: 'place_limit',
          clientOrderId,
          assetId,
          side: 'BUY',
          price: orderPrice,
          size,
          orderType: 'GTC',
          reason: 'cancel_test_place_gtc',
        },
      ]
    }

    // state.phase === 'order_placed'
    const lifecycle = orderLifecycleState(portfolio, state.clientOrderId)
    if (isFinalLifecycleState(lifecycle)) {
      state = { phase: 'done' }
      return []
    }

    const cancelAfterMs = Number.isFinite(cfg.cancelAfterMs) ? cfg.cancelAfterMs : 10_000
    const isPastDeadline = cancelAfterMs > 0 && nowMs - state.placedAtMs >= cancelAfterMs
    if (!isPastDeadline) return []
    if (state.cancelEmitted) return []

    // Live cancel requires exchange orderId.
    const orderId = resolveOrderIdForCancel(portfolio, state.clientOrderId)
    if (!orderId) return []

    state = { ...state, cancelEmitted: true }
    return [
      {
        kind: 'cancel_order',
        clientOrderId: state.clientOrderId,
        orderId,
        reason: `cancel_after_ms_${cancelAfterMs}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (_ev, portfolio) => {
    // Drive completion even if the market is quiet (fills/cancels will surface as account events).
    if (state.phase !== 'order_placed') return []
    const lifecycle = orderLifecycleState(portfolio, state.clientOrderId)
    if (isFinalLifecycleState(lifecycle)) state = { phase: 'done' }
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}



