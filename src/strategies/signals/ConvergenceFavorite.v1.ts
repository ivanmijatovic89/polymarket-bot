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
 * ConvergenceFavorite.v1 — buy the late-window favorite, hold to resolution.
 *
 * Family: convergence-near-expiry (see research/families/convergence-near-expiry/family.md).
 *
 * Hypothesis: late in a 15m up/down market the price is the crowd's probability. If late-window
 * favorites are *miscalibrated* (a token priced P wins more than P% of the time), buying the
 * favorite late and holding to resolution is +EV. This is a structurally fatter payoff than the
 * shelved micro-timing families (full convergence to $1, not a few cents), so it can clear fees.
 *
 * Mechanism (order-book only — no external feeds):
 *  - In the entry window (minEntrySec <= secondsLeft <= entryWindowSec) pick the FAVORITE
 *    (higher-mid token).
 *  - Enter (taker FOK) iff favMid >= favoriteThreshold AND favAsk <= maxPrice.
 *  - HOLD TO RESOLUTION — no take-profit / stop. The backtest redeems the share at $1 (win) or
 *    $0 (lose) at market end. One trade per market.
 *
 * The `favoriteThreshold` sweep IS the experiment: it traces the late-window calibration curve.
 *
 * LIVE CAVEAT: holding to resolution + redeem is fine; no in-window sell, so no MINED concern.
 */

export const ConfigSchema = z.strictObject({
  /** Min favorite mid price to enter (the calibration probe). */
  favoriteThreshold: z.coerce.number().finite().min(0.5).max(0.98).default(0.8),
  /** Skip favorites pricier than this (no juice left). */
  maxPrice: z.coerce.number().finite().min(0.6).max(0.999).default(0.97),
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
  id: 'ConvergenceFavorite.v1',
  title: 'Convergence Favorite v1',
  description:
    'Buys the late-window favorite (higher-priced side) when its price is in a band, and holds to ' +
    'resolution. Order-book only; tests late-window favorite calibration.',
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
  const name = 'ConvergenceFavorite.v1'
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
    if (secondsLeft === null) return [] // strategy needs the clock
    if (secondsLeft > cfg.entryWindowSec || secondsLeft < cfg.minEntrySec) return []

    const upBook = bookOf(tick, state.upAssetId)
    const downBook = bookOf(tick, state.downAssetId)
    const upMid = midOf(upBook)
    const downMid = midOf(downBook)
    if (upMid === null || downMid === null) return []

    // Favorite = higher-mid token.
    const favIsUp = upMid >= downMid
    const favAssetId = favIsUp ? state.upAssetId : state.downAssetId
    const favMid = favIsUp ? upMid : downMid
    const favBook = favIsUp ? upBook : downBook
    const favAsk = favBook?.bestAsk

    if (favMid < cfg.favoriteThreshold) return [] // no clear favorite yet
    if (typeof favAsk !== 'number' || !Number.isFinite(favAsk)) return []
    if (favAsk > cfg.maxPrice) {
      // Too expensive to have juice — skip this market entirely.
      state.stage = 'done'
      return []
    }

    const entryPrice = safeProbabilityPrice(favAsk + cfg.slippage)
    const cid = `${name}:${state.marketId}:entry:${nowMs}`
    state.stage = 'held'
    state.entryClientOrderId = cid

    return [
      {
        kind: 'place_limit',
        clientOrderId: cid,
        assetId: favAssetId,
        side: 'BUY',
        price: entryPrice,
        size: cfg.size,
        orderType: 'FOK',
        reason: favIsUp
          ? 'buy_favorite_up_hold_to_resolution'
          : 'buy_favorite_down_hold_to_resolution',
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev: AccountEvent): Intent[] => {
    if (!state) return []
    // Entry FOK that did not fill (thin book) -> back to scanning; may retry while still in window.
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
