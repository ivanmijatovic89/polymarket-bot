import type {
  AccountEvent,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import { parseGammaMarketStartMs, safeProbabilityPrice } from '../../strategy/strategyToolkit.js'
import type { OrderBookSnapshot } from '../../market/orderbook/types.js'
import * as z from 'zod'

/**
 * ConvergenceUnderdog.v2 — ConvergenceUnderdog.v1 + a stop-loss exit.
 *
 * v1 buys the late-window underdog (mid in [minPrice, maxPrice]) and holds to resolution. v2 adds:
 * if the underdog keeps falling to `stopPrice` (e.g. 0.15), SELL all immediately (marketable) and
 * stop, instead of riding it to $0. Cuts the big losers — at the cost of missing the rare comeback
 * from that low. Everything else is identical to v1.
 *
 * LIVE CAVEAT: selling shares you just bought needs MINED first (see CLAUDE.md); backtest books on fill.
 */

export const ConfigSchema = z.strictObject({
  minPrice: z.coerce.number().finite().min(0.01).max(0.5).default(0.35),
  maxPrice: z.coerce.number().finite().min(0.05).max(0.5).default(0.45),
  entryWindowSec: z.coerce.number().finite().min(10).max(600).default(120),
  minEntrySec: z.coerce.number().finite().min(2).max(300).default(15),
  /** Sell everything if the underdog mid falls to/through this. */
  stopPrice: z.coerce.number().finite().min(0.01).max(0.5).default(0.15),
  size: z.coerce.number().finite().positive().max(10000).default(25),
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'ConvergenceUnderdog.v2',
  title: 'Convergence Underdog v2 (stop-loss)',
  description:
    'Buys the late-window underdog (mid in band) and holds to resolution, but sells everything if the ' +
    'underdog falls to stopPrice. Stop-loss variant of ConvergenceUnderdog.v1.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

const WINDOW_MS = 15 * 60 * 1000

type Stage = 'scan' | 'held' | 'closing' | 'done'
type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  stage: Stage
  heldAssetId: string | null
  entryClientOrderId: string | null
  lastExitMs: number | null
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
function midOf(b: OrderBookSnapshot | undefined): number | null {
  if (!b) return null
  return typeof b.mid === 'number' && Number.isFinite(b.mid) ? b.mid : null
}
function secondsLeftOf(nowMs: number, ctx?: StrategyContext): number | null {
  const startMs = parseGammaMarketStartMs(ctx?.market)
  if (startMs === null || !Number.isFinite(nowMs)) return null
  return (startMs + WINDOW_MS - nowMs) / 1000
}
function heldQty(p: PortfolioSnapshot, assetId: string | null): number {
  if (!assetId) return 0
  const pos = p.positionsByAssetId[assetId]
  return pos && Number.isFinite(pos.qty) ? pos.qty : 0
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'ConvergenceUnderdog.v2'
  let state: StrategyState = null

  const sellAll = (
    tick: MarketTick,
    assetId: string,
    qty: number,
    nowMs: number,
    reason: string,
  ): Intent[] => {
    const bestBid = bookOf(tick, assetId)?.bestBid
    if (typeof bestBid !== 'number' || !Number.isFinite(bestBid)) return []
    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${state!.marketId}:exit:${nowMs}`,
        assetId,
        side: 'SELL',
        price: safeProbabilityPrice(bestBid - cfg.slippage),
        size: qty,
        orderType: 'GTC',
        reason,
      },
    ]
  }

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const marketId = tick.snapshot.market ?? 'unknown_market'
    const nowMs = tick.snapshot.timestamp || Date.now()
    if (state && state.marketId !== marketId) state = null
    if (!state) {
      const ids = resolveUpDownAssetIds(tick, ctx)
      if (!ids) return []
      state = {
        marketId,
        upAssetId: ids.upAssetId,
        downAssetId: ids.downAssetId,
        stage: 'scan',
        heldAssetId: null,
        entryClientOrderId: null,
        lastExitMs: null,
      }
    }

    if (state.stage === 'held') {
      const qty = heldQty(portfolio, state.heldAssetId)
      if (qty <= 0) return [] // not filled yet
      const mid = midOf(bookOf(tick, state.heldAssetId as string))
      if (mid !== null && mid <= cfg.stopPrice) {
        state.stage = 'closing'
        state.lastExitMs = nowMs
        return sellAll(tick, state.heldAssetId as string, qty, nowMs, 'stop_loss')
      }
      return [] // otherwise hold to resolution
    }
    if (state.stage === 'closing') {
      const qty = heldQty(portfolio, state.heldAssetId)
      if (qty <= 0) {
        state.stage = 'done'
        return []
      }
      if (state.lastExitMs !== null && nowMs - state.lastExitMs < 2000) return []
      state.lastExitMs = nowMs
      return sellAll(tick, state.heldAssetId as string, qty, nowMs, 'stop_retry')
    }
    if (state.stage !== 'scan') return []

    const secondsLeft = secondsLeftOf(nowMs, ctx)
    if (secondsLeft === null) return []
    if (secondsLeft > cfg.entryWindowSec || secondsLeft < cfg.minEntrySec) return []

    const upBook = bookOf(tick, state.upAssetId)
    const downBook = bookOf(tick, state.downAssetId)
    const upMid = midOf(upBook)
    const downMid = midOf(downBook)
    if (upMid === null || downMid === null) return []

    const dogIsUp = upMid < downMid
    const dogAssetId = dogIsUp ? state.upAssetId : state.downAssetId
    const dogMid = dogIsUp ? upMid : downMid
    const dogAsk = (dogIsUp ? upBook : downBook)?.bestAsk

    if (dogMid < cfg.minPrice || dogMid > cfg.maxPrice) return []
    if (typeof dogAsk !== 'number' || !Number.isFinite(dogAsk)) return []
    if (dogAsk > cfg.maxPrice) {
      state.stage = 'done'
      return []
    }

    const cid = `${name}:${state.marketId}:entry:${nowMs}`
    state.stage = 'held'
    state.heldAssetId = dogAssetId
    state.entryClientOrderId = cid
    return [
      {
        kind: 'place_limit',
        clientOrderId: cid,
        assetId: dogAssetId,
        side: 'BUY',
        price: safeProbabilityPrice(dogAsk + cfg.slippage),
        size: cfg.size,
        orderType: 'FOK',
        reason: 'buy_underdog',
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev: AccountEvent): Intent[] => {
    if (!state) return []
    if (
      state.stage === 'held' &&
      state.entryClientOrderId &&
      ev.kind === 'order_done' &&
      ev.clientOrderId === state.entryClientOrderId &&
      ev.reason !== 'filled'
    ) {
      // entry FOK didn't fill -> rescan
      state.stage = 'scan'
      state.heldAssetId = null
      state.entryClientOrderId = null
    }
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
