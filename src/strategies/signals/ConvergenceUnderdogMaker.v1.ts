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
 * ConvergenceUnderdogMaker.v1 — maker-entry underdog, hold to resolution.
 *
 * The taker underdog (ConvergenceUnderdogRecorder.v1) gated by favImb3 was a real but un-tradeable
 * signal: ask-heavy favorites are ~2.5c overpriced, but the underdog's ~3-4c taker entry cost eats it
 * (best bucket still -$0.26/mkt). The only lever left is to enter CHEAPER.
 *
 * This strategy RESTS a maker BUY just inside the underdog's spread (underdogAsk - makerOffset) with a
 * cancel-on-timeout, instead of crossing it. A fill captures the spread (pays ~bid rather than ask+slip),
 * which could turn the +2.5c edge net-positive. Honest risk: maker fills are adversely selected — you
 * fill when the underdog drifts cheaper (favorite strengthening), i.e. when it is MORE likely to lose.
 *
 * It records favImb3 per (filled) market so the imbalance gate is applied post-hoc, identically to the
 * taker run, for an apples-to-apples maker-vs-taker comparison.
 *
 * Order-book only; no external feeds.
 */

export const ConfigSchema = z.strictObject({
  favoriteThreshold: z.coerce.number().finite().min(0.5).max(0.98).default(0.55),
  maxFavPrice: z.coerce.number().finite().min(0.6).max(0.999).default(0.97),
  depthLevels: z.coerce.number().int().min(1).max(10).default(3),
  entryWindowSec: z.coerce.number().finite().min(10).max(600).default(120),
  minEntrySec: z.coerce.number().finite().min(2).max(300).default(15),
  /** Rest the maker buy this far below the underdog ask (price units). 0.01 == 1 tick inside. */
  makerOffset: z.coerce.number().finite().min(0).max(0.1).default(0.01),
  /** Cancel an unfilled resting entry after this many seconds, then skip the market. */
  entryTimeoutSec: z.coerce.number().finite().min(1).max(300).default(30),
  size: z.coerce.number().finite().positive().max(10000).default(25),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'ConvergenceUnderdogMaker.v1',
  title: 'Convergence Underdog Maker v1',
  description:
    'Rests a maker BUY just inside the late-window underdog spread (cancel-on-timeout), holds to ' +
    'resolution. Records favImb3. Maker-entry fee/spread-cut variant of the underdog fade.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

const WINDOW_MS = 15 * 60 * 1000

type Stage = 'scan' | 'entering' | 'held' | 'done'

type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  stage: Stage
  dogAssetId: string | null
  entryClientOrderId: string | null
  entryPlacedMs: number | null
  cancelRequested: boolean
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

function heldQty(portfolio: PortfolioSnapshot, assetId: string | null): number {
  if (!assetId) return 0
  const pos = portfolio.positionsByAssetId[assetId]
  return pos && Number.isFinite(pos.qty) ? pos.qty : 0
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'ConvergenceUnderdogMaker.v1'
  let state: StrategyState = null

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
        dogAssetId: null,
        entryClientOrderId: null,
        entryPlacedMs: null,
        cancelRequested: false,
      }
    }

    if (state.stage === 'entering') {
      // Filled -> hold to resolution.
      if (heldQty(portfolio, state.dogAssetId) > 0) {
        state.stage = 'held'
        return []
      }
      // Cancel-on-timeout, then onAccountEvent('order_done') moves us to done.
      if (
        !state.cancelRequested &&
        state.entryPlacedMs !== null &&
        nowMs - state.entryPlacedMs >= cfg.entryTimeoutSec * 1000 &&
        state.entryClientOrderId
      ) {
        state.cancelRequested = true
        return [
          {
            kind: 'cancel_order',
            clientOrderId: state.entryClientOrderId,
            reason: 'entry_timeout',
          },
        ]
      }
      return []
    }
    if (state.stage !== 'scan') return [] // held / done

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
    const entryPrice = safeProbabilityPrice(dogAsk - cfg.makerOffset)
    const cid = `${name}:${state.marketId}:entry:${nowMs}`
    state.stage = 'entering'
    state.dogAssetId = dogAssetId
    state.entryClientOrderId = cid
    state.entryPlacedMs = nowMs
    state.cancelRequested = false

    return [
      {
        kind: 'place_limit',
        clientOrderId: cid,
        assetId: dogAssetId,
        side: 'BUY',
        price: entryPrice,
        size: cfg.size,
        orderType: 'GTC',
        reason: 'maker_underdog_entry',
        meta: {
          favMid: round(favMid),
          dogMid: round(dogMid),
          dogEntry: round(entryPrice),
          favImb3: round(favImb3),
          secondsLeft: Math.round(secondsLeft),
        },
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev: AccountEvent): Intent[] => {
    if (!state) return []
    if (
      state.stage === 'entering' &&
      state.entryClientOrderId &&
      ev.kind === 'order_done' &&
      ev.clientOrderId === state.entryClientOrderId
    ) {
      // Filled -> hold to resolution; otherwise (cancel/expire/kill) skip the market.
      state.stage = ev.reason === 'filled' ? 'held' : 'done'
    }
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
