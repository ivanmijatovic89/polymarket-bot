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
 * ConvergenceUnderdog.v1 — buy the late-window UNDERDOG, hold to resolution.
 *
 * Family: convergence-near-expiry. The mirror of ConvergenceFavorite.v1.
 *
 * Why: the favorite band sweep (convfav-band-01..05) showed late-window favorites are systematically
 * OVER-priced (win% < price in every band, by ~2–5¢). The complement: the UNDERDOG (cheap side) is
 * UNDER-priced. Buying the underdog and holding to resolution computes to +4–5¢/share (mid) in the
 * moderate-underdog band (~0.20–0.40). This is the classic favorite-longshot bias, inverted.
 *
 * Mechanism (order-book only):
 *  - In the entry window (minEntrySec <= secondsLeft <= entryWindowSec) pick the UNDERDOG
 *    (lower-mid token).
 *  - Enter (taker FOK) iff minPrice <= underdogMid <= maxPrice AND underdogAsk <= maxPrice.
 *  - HOLD TO RESOLUTION. Share redeems $1 (underdog wins) / $0 (loses). One trade per market.
 *
 * Pre-mortem: the ~2–5¢ mid edge must survive buying at ask+slippage(+fee); high variance
 * (rare big wins). Watch GROSS net of real entry cost across the price-band sweep.
 */

export const ConfigSchema = z.strictObject({
  /** Min underdog mid price to enter (avoid no-liquidity deep longshots). */
  minPrice: z.coerce.number().finite().min(0.01).max(0.5).default(0.15),
  /** Max underdog mid/ask price to enter. */
  maxPrice: z.coerce.number().finite().min(0.05).max(0.5).default(0.45),
  /** Start looking to enter when secondsLeft <= this. */
  entryWindowSec: z.coerce.number().finite().min(10).max(600).default(120),
  /** Stop entering this close to expiry (need time to fill). */
  minEntrySec: z.coerce.number().finite().min(2).max(300).default(15),
  /** Order size (shares). */
  size: z.coerce.number().finite().positive().max(10000).default(25),
  /** Marketable slippage budget (price ticks) for taker entry. */
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'ConvergenceUnderdog.v1',
  title: 'Convergence Underdog v1',
  description:
    'Buys the late-window underdog (cheaper side) when its price is in a band, holds to resolution. ' +
    'Mirror of ConvergenceFavorite.v1 — tests favorite-longshot bias (underdog underpricing).',
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

function bookOf(tick: MarketTick, assetId: string): OrderBookSnapshot | undefined {
  return tick.snapshot.byAssetId[assetId]
}

function midOf(book: OrderBookSnapshot | undefined): number | null {
  if (!book) return null
  return typeof book.mid === 'number' && Number.isFinite(book.mid) ? book.mid : null
}

function secondsLeftOf(nowMs: number, ctx?: StrategyContext): number | null {
  const startMs = parseGammaMarketStartMs(ctx?.market)
  if (startMs === null || !Number.isFinite(nowMs)) return null
  return (startMs + WINDOW_MS - nowMs) / 1000
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'ConvergenceUnderdog.v1'
  let state: StrategyState = null

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio
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
    const downBook = bookOf(tick, state.downAssetId)
    const upMid = midOf(upBook)
    const downMid = midOf(downBook)
    if (upMid === null || downMid === null) return []

    // Underdog = lower-mid token.
    const dogIsUp = upMid < downMid
    const dogAssetId = dogIsUp ? state.upAssetId : state.downAssetId
    const dogMid = dogIsUp ? upMid : downMid
    const dogBook = dogIsUp ? upBook : downBook
    const dogAsk = dogBook?.bestAsk

    if (dogMid < cfg.minPrice || dogMid > cfg.maxPrice) return []
    if (typeof dogAsk !== 'number' || !Number.isFinite(dogAsk)) return []
    if (dogAsk > cfg.maxPrice) {
      state.stage = 'done'
      return []
    }

    const entryPrice = safeProbabilityPrice(dogAsk + cfg.slippage)
    const cid = `${name}:${state.marketId}:entry:${nowMs}`
    state.stage = 'held'
    state.entryClientOrderId = cid

    return [
      {
        kind: 'place_limit',
        clientOrderId: cid,
        assetId: dogAssetId,
        side: 'BUY',
        price: entryPrice,
        size: cfg.size,
        orderType: 'FOK',
        reason: dogIsUp
          ? 'buy_underdog_up_hold_to_resolution'
          : 'buy_underdog_down_hold_to_resolution',
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
