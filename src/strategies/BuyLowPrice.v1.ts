import type {
  AccountEvent,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../strategy/Strategy.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  price: z.coerce.number().finite().positive().max(1).default(0.02),
  size: z.coerce.number().finite().positive().default(50),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'BuyLowPrice.v1',
  title: 'BuyLowPrice v1',
  description:
    'Places BUY GTC on both sides (UP/DOWN) at low price. After first fill, cancels the other side and waits.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  upClientOrderId: string
  downClientOrderId: string
  cancelSentForClientOrderId?: string
  winningClientOrderId?: string
} | null

function resolveUpDownAssetIds(
  tick: MarketTick,
  ctx?: StrategyContext,
): { upAssetId: string; downAssetId: string } | null {
  const upFromMeta = ctx?.market?.upAssetId
  const downFromMeta = ctx?.market?.downAssetId
  if (
    typeof upFromMeta === 'string' &&
    upFromMeta.length > 0 &&
    typeof downFromMeta === 'string' &&
    downFromMeta.length > 0 &&
    upFromMeta !== downFromMeta
  ) {
    return { upAssetId: upFromMeta, downAssetId: downFromMeta }
  }

  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const upAssetId = ids[0]
  const downAssetId = ids[1]
  if (!upAssetId || !downAssetId || upAssetId === downAssetId) return null
  return { upAssetId, downAssetId }
}

function orderLifecycleState(portfolio: PortfolioSnapshot, clientOrderId: string): unknown {
  return portfolio.ordersByClientId[clientOrderId]?.lifecycleState
}

function isFinalLifecycleState(state: unknown): boolean {
  return (
    state === 'filled' ||
    state === 'canceled' ||
    state === 'rejected' ||
    state === 'expired' ||
    state === 'killed'
  )
}

function resolveOrderIdForCancel(
  portfolio: PortfolioSnapshot,
  clientOrderId: string,
): string | null {
  const snap = portfolio.ordersByClientId[clientOrderId]
  const open = portfolio.openOrdersByClientId[clientOrderId]
  const orderId = snap?.orderId ?? open?.orderId
  return typeof orderId === 'string' && orderId.length > 0 ? orderId : null
}

function winningClientOrderIdFromEvent(
  ev: AccountEvent,
  upCid: string,
  downCid: string,
): string | null {
  if (ev.kind === 'fill') {
    const cid = ev.fill.clientOrderId
    if (cid === upCid || cid === downCid) return cid
  }
  if (ev.kind === 'order_done' && ev.reason === 'filled' && ev.clientOrderId) {
    if (ev.clientOrderId === upCid || ev.clientOrderId === downCid) return ev.clientOrderId
  }
  return null
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'BuyLowPrice.v1'
  let state: StrategyState = null

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio
    const marketId = tick.snapshot.market ?? 'unknown_market'

    // New market -> start a fresh cycle.
    if (state && state.marketId !== marketId) state = null
    if (state) return []

    const ids = resolveUpDownAssetIds(tick, ctx)
    if (!ids) return []

    const nowMs = tick.snapshot.timestamp || Date.now()
    const upClientOrderId = `${name}:${marketId}:${ids.upAssetId}:buy:${nowMs}`
    const downClientOrderId = `${name}:${marketId}:${ids.downAssetId}:buy:${nowMs}`

    state = {
      marketId,
      upAssetId: ids.upAssetId,
      downAssetId: ids.downAssetId,
      upClientOrderId,
      downClientOrderId,
    }

    return [
      {
        kind: 'place_limit',
        clientOrderId: upClientOrderId,
        assetId: ids.upAssetId,
        side: 'BUY',
        price: cfg.price,
        size: cfg.size,
        orderType: 'GTC',
        reason: 'buy_low_price_up',
      },
      {
        kind: 'place_limit',
        clientOrderId: downClientOrderId,
        assetId: ids.downAssetId,
        side: 'BUY',
        price: cfg.price,
        size: cfg.size,
        orderType: 'GTC',
        reason: 'buy_low_price_down',
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, portfolio) => {
    if (!state) return []
    if (state.cancelSentForClientOrderId) return []

    const winner =
      state.winningClientOrderId ??
      winningClientOrderIdFromEvent(ev, state.upClientOrderId, state.downClientOrderId)
    if (!winner) return []

    const loser = winner === state.upClientOrderId ? state.downClientOrderId : state.upClientOrderId
    const loserLifecycle = orderLifecycleState(portfolio, loser)
    if (isFinalLifecycleState(loserLifecycle)) {
      state = { ...state, winningClientOrderId: winner, cancelSentForClientOrderId: loser }
      return []
    }

    const orderId = resolveOrderIdForCancel(portfolio, loser)
    if (!orderId) {
      state = { ...state, winningClientOrderId: winner }
      return []
    }

    state = { ...state, winningClientOrderId: winner, cancelSentForClientOrderId: loser }
    return [
      {
        kind: 'cancel_order',
        clientOrderId: loser,
        orderId,
        reason: 'cancel_other_side_after_first_fill',
      },
    ]
  }

  return { name, onMarketTick, onAccountEvent }
}
