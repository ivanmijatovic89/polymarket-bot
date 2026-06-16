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
 * BuyUpFavorite.v1 — UP-side twin of BuyDownFavorite.v1 (the control for the asymmetry test).
 *
 * Buys UP when UP is the favorite (upMid >= favThreshold) and holds to resolution. If this is
 * symmetric with the DOWN version, there is no real UP/DOWN edge (both just lose to fees). If it
 * differs markedly, there is a genuine asymmetry (e.g. a retail long-bias) to chase.
 *
 * Mechanism (order-book only): in the entry window, at the first tick where upMid >= favThreshold,
 * buy UP (taker FOK) and hold to resolution. One trade per market.
 */

export const ConfigSchema = z.strictObject({
  favThreshold: z.coerce.number().finite().min(0.5).max(0.98).default(0.6),
  maxPrice: z.coerce.number().finite().min(0.6).max(0.999).default(0.97),
  entryWindowSec: z.coerce.number().finite().min(10).max(895).default(840),
  minEntrySec: z.coerce.number().finite().min(2).max(890).default(120),
  size: z.coerce.number().finite().positive().max(10000).default(25),
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'BuyUpFavorite.v1',
  title: 'Buy Up Favorite v1',
  description:
    'Buys UP when UP is the favorite (upMid >= favThreshold) and holds to resolution. ' +
    'UP-side control for the DOWN-favorite asymmetry test.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

const WINDOW_MS = 15 * 60 * 1000

type Stage = 'scan' | 'held' | 'done'
type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  stage: Stage
  entryClientOrderId: string | null
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
function round(x: number, d = 6): number {
  const f = 10 ** d
  return Math.round(x * f) / f
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'BuyUpFavorite.v1'
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
      state = {
        marketId,
        upAssetId: ids.upAssetId,
        downAssetId: ids.downAssetId,
        stage: 'scan',
        entryClientOrderId: null,
      }
    }
    if (state.stage !== 'scan') return []

    const secondsLeft = secondsLeftOf(nowMs, ctx)
    if (secondsLeft === null) return []
    if (secondsLeft > cfg.entryWindowSec || secondsLeft < cfg.minEntrySec) return []

    const upBook = bookOf(tick, state.upAssetId)
    const downMid = midOf(bookOf(tick, state.downAssetId))
    const upMid = midOf(upBook)
    const upAsk = upBook?.bestAsk
    if (downMid === null || upMid === null) return []
    if (upMid < cfg.favThreshold) return [] // UP not (yet) the favorite
    if (typeof upAsk !== 'number' || !Number.isFinite(upAsk)) return []
    if (upAsk > cfg.maxPrice) {
      state.stage = 'done'
      return []
    }

    const cid = `${name}:${marketId}:${nowMs}`
    state.stage = 'held'
    state.entryClientOrderId = cid
    return [
      {
        kind: 'place_limit',
        clientOrderId: cid,
        assetId: state.upAssetId,
        side: 'BUY',
        price: safeProbabilityPrice(upAsk + cfg.slippage),
        size: cfg.size,
        orderType: 'FOK',
        reason: 'buy_up_favorite',
        meta: {
          upMid: round(upMid),
          downMid: round(downMid),
          secondsLeft: Math.round(secondsLeft),
        },
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
      state.stage = 'scan'
      state.entryClientOrderId = null
    }
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
