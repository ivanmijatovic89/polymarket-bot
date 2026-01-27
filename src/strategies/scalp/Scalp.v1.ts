import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { isWarmed, safeProbabilityPrice } from '../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  size: z.coerce.number().finite().positive().default(10),
  buyPrice: z.coerce.number().finite().positive().default(0.20),
  sellPrice: z.coerce.number().finite().positive().default(0.22),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'scalp.v1',
  title: 'Scalp v1',
  description:
    'Scalp strategy: placeholder for new strategies.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

type LocalState =
  | { phase: 'idle' }
  | {
      phase: 'buys_placed'
      upAssetId: string
      downAssetId: string
      upBuyClientOrderId: string
      downBuyClientOrderId: string
      upSellClientOrderId: string | null
      downSellClientOrderId: string | null
      upSellPlaced: boolean
      downSellPlaced: boolean
      upCancelEmitted: boolean
      downCancelEmitted: boolean
    }
  | { phase: 'done' }

function posQty(portfolio: PortfolioSnapshot, assetId: string): number {
  const q = portfolio.positionsByAssetId[assetId]?.qty
  return typeof q === 'number' && Number.isFinite(q) ? q : 0
}

function pickTwoAssetIdsFromTick(tick: MarketTick): [string, string] | null {
  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const a = ids[0]
  const b = ids[1]
  if (!a || !b || a === b) return null
  return [a, b]
}

export function createStrategy(_cfg: Config): {
  strategy: Strategy,
  plugins: Plugin[]
} {
  const name = 'scalp.v1'
  const cfg = {
    size: Number.isFinite(_cfg.size) ? _cfg.size : 10,
    buyPrice: safeProbabilityPrice(_cfg.buyPrice),
    sellPrice: safeProbabilityPrice(_cfg.sellPrice),
  }

  let state: LocalState = { phase: 'idle' }

  const tryHandlePostBuy = (portfolio: PortfolioSnapshot): Intent[] => {
    if (state.phase !== 'buys_placed') return []

    const intents: Intent[] = []
    const upQty = posQty(portfolio, state.upAssetId)
    const downQty = posQty(portfolio, state.downAssetId)
    const upHasQty = upQty > 0
    const downHasQty = downQty > 0
    const upFilledFull = upQty >= cfg.size
    const downFilledFull = downQty >= cfg.size

    if (upHasQty) {
      if (!state.upSellPlaced) {
        const size = upQty || cfg.size
        const sellClientOrderId = `${state.upBuyClientOrderId}:sell`
        state = { ...state, upSellPlaced: true, upSellClientOrderId: sellClientOrderId }
        intents.push({
          kind: 'place_limit',
          clientOrderId: sellClientOrderId,
          assetId: state.upAssetId,
          side: 'SELL',
          price: cfg.sellPrice,
          size,
          orderType: 'GTC',
          reason: 'scalp_sell_after_up_fill',
        })
      }

      if (upFilledFull && !downHasQty && !state.downCancelEmitted) {
        state = { ...state, downCancelEmitted: true }
        intents.push({
          kind: 'cancel_order',
          clientOrderId: state.downBuyClientOrderId,
          reason: 'scalp_cancel_down_after_up_fill',
        })
      }
    }

    if (downHasQty) {
      if (!state.downSellPlaced) {
        const size = downQty || cfg.size
        const sellClientOrderId = `${state.downBuyClientOrderId}:sell`
        state = { ...state, downSellPlaced: true, downSellClientOrderId: sellClientOrderId }
        intents.push({
          kind: 'place_limit',
          clientOrderId: sellClientOrderId,
          assetId: state.downAssetId,
          side: 'SELL',
          price: cfg.sellPrice,
          size,
          orderType: 'GTC',
          reason: 'scalp_sell_after_down_fill',
        })
      }

      if (downFilledFull && !upHasQty && !state.upCancelEmitted) {
        state = { ...state, upCancelEmitted: true }
        intents.push({
          kind: 'cancel_order',
          clientOrderId: state.upBuyClientOrderId,
          reason: 'scalp_cancel_up_after_down_fill',
        })
      }
    }

    return intents
  }

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio

    // Live-only warmup gate (recommended for any strategy that places orders).
    if (!isWarmed(ctx)) return []

    if (state.phase === 'idle') {
      if (cfg.size <= 0) return []
      const upAssetId = ctx?.market?.upAssetId ?? null
      const downAssetId = ctx?.market?.downAssetId ?? null
      const fallback = pickTwoAssetIdsFromTick(tick)
      const resolvedUp = upAssetId ?? fallback?.[0] ?? null
      const resolvedDown = downAssetId ?? fallback?.[1] ?? null
      if (!resolvedUp || !resolvedDown || resolvedUp === resolvedDown) return []

      const nowMs = tick.snapshot.timestamp || Date.now()
      const upBuyClientOrderId = `${name}:${resolvedUp}:buy:${nowMs}`
      const downBuyClientOrderId = `${name}:${resolvedDown}:buy:${nowMs}`

      state = {
        phase: 'buys_placed',
        upAssetId: resolvedUp,
        downAssetId: resolvedDown,
        upBuyClientOrderId,
        downBuyClientOrderId,
        upSellClientOrderId: null,
        downSellClientOrderId: null,
        upSellPlaced: false,
        downSellPlaced: false,
        upCancelEmitted: false,
        downCancelEmitted: false,
      }

      return [
        {
          kind: 'place_limit',
          clientOrderId: upBuyClientOrderId,
          assetId: resolvedUp,
          side: 'BUY',
          price: cfg.buyPrice,
          size: cfg.size,
          orderType: 'GTC',
          reason: 'scalp_buy_up',
        },
        {
          kind: 'place_limit',
          clientOrderId: downBuyClientOrderId,
          assetId: resolvedDown,
          side: 'BUY',
          price: cfg.buyPrice,
          size: cfg.size,
          orderType: 'GTC',
          reason: 'scalp_buy_down',
        },
      ]
    }

    return tryHandlePostBuy(_portfolio)
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, _portfolio, _lastMarket, _ctx) => {
    void ev
    void _lastMarket
    void _ctx

    return tryHandlePostBuy(_portfolio)
  }

  const strategy: Strategy = {
    name,
    onMarketTick,
    onAccountEvent,
  }

  return { strategy, plugins: [] }
}
