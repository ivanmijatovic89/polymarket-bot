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
 * ConvergenceUnderdogRecorder.v1 — measure the REAL underdog trade, gated post-hoc by imbalance.
 *
 * The vol-recorder run found that the favorite's order-book imbalance (`favImb3`) predicts the
 * favorite's calibration robustly (ask-heavy favorite → favorite overpriced → underdog underpriced).
 * But that run bought the FAVORITE, so it could not measure the real cost of trading the UNDERDOG.
 *
 * This strategy ALWAYS buys the late-window UNDERDOG (lower-mid token) and holds to resolution, so
 * each market's row carries the REAL underdog net P&L (underdog bought at its own ask+slippage,
 * redeemed $1/$0). It records the favorite's book imbalance per market, so post-hoc we can gate on
 * `favImb3` (ask-heavy bucket) and split train/test to see whether fading via the underdog is
 * actually net-profitable after the underdog's true entry cost — no approximation.
 *
 * Order-book only; no external feeds.
 */

export const ConfigSchema = z.strictObject({
  /** Min favorite mid to require a clear favorite (so there is a real underdog). */
  favoriteThreshold: z.coerce.number().finite().min(0.5).max(0.98).default(0.55),
  /** Skip when the favorite is pricier than this (underdog too deep / illiquid). */
  maxFavPrice: z.coerce.number().finite().min(0.6).max(0.999).default(0.97),
  /** Top N cumulative levels used to compute the favorite book imbalance. */
  depthLevels: z.coerce.number().int().min(1).max(10).default(3),
  entryWindowSec: z.coerce.number().finite().min(10).max(600).default(120),
  minEntrySec: z.coerce.number().finite().min(2).max(300).default(15),
  lookbackSec: z.coerce.number().finite().min(10).max(600).default(180),
  size: z.coerce.number().finite().positive().max(10000).default(25),
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'ConvergenceUnderdogRecorder.v1',
  title: 'Convergence Underdog Recorder v1',
  description:
    'Always buys the late-window underdog (hold to resolution) and records the favorite book ' +
    'imbalance per market, to test post-hoc whether the imbalance gate makes fading net-profitable.',
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
  history: Array<{ ms: number; upMid: number }>
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

function stdOf(xs: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const v = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n
  return Math.sqrt(v)
}

function round(x: number, d = 6): number {
  const f = 10 ** d
  return Math.round(x * f) / f
}

function cumDepth(arr: number[] | undefined, n: number): number {
  if (!arr || arr.length === 0) return 0
  const i = Math.min(n, arr.length) - 1
  const v = arr[i]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function imbalanceOf(book: OrderBookSnapshot | undefined, depthLevels: number): number {
  if (!book) return 0
  const bid = cumDepth(book.bidsDepthByLevel, depthLevels)
  const ask = cumDepth(book.asksDepthByLevel, depthLevels)
  const tot = bid + ask
  return tot > 0 ? (bid - ask) / tot : 0
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'ConvergenceUnderdogRecorder.v1'
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
        history: [],
      }
    }

    const upMidNow = midOf(bookOf(tick, state.upAssetId))
    if (upMidNow !== null) {
      state.history.push({ ms: nowMs, upMid: upMidNow })
      const cutoff = nowMs - cfg.lookbackSec * 1000
      while (state.history.length > 0 && (state.history[0]?.ms ?? 0) < cutoff) {
        state.history.shift()
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

    const favIsUp = upMid >= downMid
    const favMid = favIsUp ? upMid : downMid
    const favBook = favIsUp ? upBook : downBook
    // Underdog = the OTHER (lower-mid) token.
    const dogAssetId = favIsUp ? state.downAssetId : state.upAssetId
    const dogBook = favIsUp ? downBook : upBook
    const dogMid = favIsUp ? downMid : upMid
    const dogAsk = dogBook?.bestAsk

    if (favMid < cfg.favoriteThreshold) return []
    if (favMid > cfg.maxFavPrice) {
      state.stage = 'done'
      return []
    }
    if (typeof dogAsk !== 'number' || !Number.isFinite(dogAsk)) return []

    const favImb3 = imbalanceOf(favBook, cfg.depthLevels)
    const w60 = state.history.filter((h) => h.ms >= nowMs - 60_000).map((h) => h.upMid)
    const volStd60 = stdOf(w60)

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
        reason: 'underdog_recorder_buy_underdog',
        meta: {
          favMid: round(favMid),
          dogMid: round(dogMid),
          dogEntry: round(entryPrice),
          favImb3: round(favImb3),
          volStd60: round(volStd60),
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
